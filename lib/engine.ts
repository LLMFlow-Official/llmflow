import type { AppContext, Controller, NodeState } from './nodes'
import { isStopped } from './errors'

/**
 * Flow execution engine.
 *
 * Every connection (edge) ends up "active" (its source ran and chose it) or "dead" (its source was
 * skipped, failed, or chose another branch). A node runs once all of its incoming connections are
 * decided and at least one is active; if all are dead it is skipped. This gives:
 * - branches not taken by Decision / LLM Router are marked "skipped" instead of waiting forever,
 * - Thread Merge (or any node with several inputs) runs once, after all its inputs are done,
 * - loops run their body through `controller.runBranch`, isolated from the rest of the flow.
 */

export type EngineNode = { id: string, type: string, data: Record<string, unknown> }
export type EngineEdge = { id: string, source: string, target: string }

export type OnErrorSettings = {
    /** Extra attempts after the first failure (0-5). */
    retries?: number
    /** Seconds to wait between attempts. */
    retry_delay?: number
    /** Keep going: the node's `error` output is set and its next node still runs. */
    continue?: boolean
}

export type EngineController = Controller & {
    /**
     * Runs the nodes reachable from `entryIds` (a loop body) with the given context and resolves
     * when they are all done. Throws if a node in the branch fails.
     */
    runBranch: (entryIds: string[], context: AppContext) => Promise<void>
}

export type ProcessFn<N extends EngineNode = EngineNode> = (context: AppContext, node: N, nextNodes: N[], controller: EngineController) => Promise<N[]>

export type EngineHooks<N extends EngineNode = EngineNode> = {
    getProcess: (type: string) => ProcessFn<N>
    /** Targets a node runs itself as a loop body (not part of the normal flow). */
    getBodyTargets?: (node: N) => string[]
    setNodeState: (id: string, state: NodeState) => void
    isRunning: () => boolean
    controller: Controller
    /** Called when a node fails for good (after retries), before its downstream nodes are skipped. */
    onNodeError?: (node: N, error: Error) => void
    /** Waits between retry attempts; resolves false if the run was stopped. */
    wait?: (ms: number) => Promise<boolean>
}

export class BranchError extends Error {
    constructor(public node: EngineNode, public cause: Error) {
        super(cause.message)
    }
}

const defaultWait = (ms: number) => new Promise<boolean>(resolve => setTimeout(() => resolve(true), ms))

/** Nodes reachable from `entryIds`, without entering loop bodies. */
export function reachable<N extends EngineNode>(entryIds: string[], nodes: N[], edges: EngineEdge[], getBodyTargets?: (node: N) => string[]): Set<string> {
    const byId = new Map(nodes.map(x => [x.id, x]))
    const seen = new Set<string>()
    const stack = [...entryIds]
    while (stack.length) {
        const id = stack.pop()!
        if (seen.has(id) || !byId.has(id)) continue
        seen.add(id)
        const body = new Set(getBodyTargets?.(byId.get(id)!) || [])
        for (const edge of edges) {
            if (edge.source == id && !body.has(edge.target)) stack.push(edge.target)
        }
    }
    return seen
}

/**
 * Checks that the flow can run: no cycles (outside the Loop node's body connection) and no node
 * that belongs to a loop body and is also reachable from outside it. Returns an error message or null.
 */
export function validateGraph<N extends EngineNode>(startId: string, nodes: N[], edges: EngineEdge[], getBodyTargets?: (node: N) => string[]): string | null {
    const byId = new Map(nodes.map(x => [x.id, x]))

    const checkScope = (entryIds: string[], label: string): string | null => {
        const scope = reachable(entryIds, nodes, edges, getBodyTargets)

        // Cycle detection inside the scope (body edges are not followed).
        const state = new Map<string, 'visiting' | 'done'>()
        const visit = (id: string): string | null => {
            if (state.get(id) == 'done') return null
            if (state.get(id) == 'visiting') return id
            state.set(id, 'visiting')
            const node = byId.get(id)!
            const body = new Set(getBodyTargets?.(node) || [])
            for (const edge of edges) {
                if (edge.source != id || body.has(edge.target) || !scope.has(edge.target)) continue
                const found = visit(edge.target)
                if (found) return found
            }
            state.set(id, 'done')
            return null
        }
        for (const id of entryIds) {
            const cycleAt = visit(id)
            if (cycleAt) {
                const name = (byId.get(cycleAt)?.data.name as string) || cycleAt
                return `The flow loops back to "${name}"${label}. Use a Loop node to repeat steps.`
            }
        }

        // Loop bodies must be separate from the rest of their scope, then are checked themselves.
        for (const id of Array.from(scope)) {
            const node = byId.get(id)!
            const targets = getBodyTargets?.(node) || []
            if (!targets.length) continue
            const body = reachable(targets, nodes, edges, getBodyTargets)
            const overlap = Array.from(body).find(x => scope.has(x))
            if (overlap) {
                const name = (byId.get(overlap)?.data.name as string) || overlap
                return `"${name}" is inside the loop "${(node.data.name as string) || node.id}" but is also connected from outside it.`
            }
            const inner = checkScope(targets, ` inside the loop "${(node.data.name as string) || node.id}"`)
            if (inner) return inner
        }
        return null
    }

    if (!byId.has(startId)) return "The flow has no Start node"
    return checkScope([startId], '')
}

type Status = 'pending' | 'running' | 'done' | 'skipped'

class Run<N extends EngineNode> {
    private status = new Map<string, Status>()
    private edgeState = new Map<string, 'active' | 'dead'>()
    private scope: Set<string>
    private byId: Map<string, N>
    private failures: BranchError[] = []

    constructor(
        private entryIds: string[],
        private context: AppContext,
        private nodes: N[],
        private edges: EngineEdge[],
        private hooks: EngineHooks<N>,
        /** Inside a loop body, a failure stops the whole branch. */
        private failFast: boolean,
    ) {
        this.byId = new Map(nodes.map(x => [x.id, x]))
        this.scope = reachable(entryIds, nodes, edges, hooks.getBodyTargets)
        for (const id of Array.from(this.scope)) this.status.set(id, 'pending')
    }

    nodeIds() {
        return Array.from(this.scope)
    }

    private incoming(id: string) {
        return this.edges.filter(e => e.target == id && this.scope.has(e.source))
    }

    private outgoing(node: N) {
        const body = new Set(this.hooks.getBodyTargets?.(node) || [])
        return this.edges.filter(e => e.source == node.id && this.scope.has(e.target) && !body.has(e.target))
    }

    async start() {
        await Promise.all(this.entryIds.map(id => this.visit(id, true)))
        if (this.failFast && this.failures.length) throw this.failures[0]
    }

    private async visit(id: string, isEntry = false): Promise<void> {
        if (this.status.get(id) != 'pending') return
        if (this.failFast && this.failures.length) return
        const node = this.byId.get(id)!

        if (!isEntry) {
            const incoming = this.incoming(id)
            if (incoming.some(e => !this.edgeState.has(e.id))) return // another input is still running
            if (incoming.every(e => this.edgeState.get(e.id) == 'dead')) return this.skip(node)
        }
        if (!this.hooks.isRunning()) return

        this.status.set(id, 'running')
        this.hooks.setNodeState(id, 'running')

        const outgoing = this.outgoing(node)
        const allNext = this.edges
            .filter(e => e.source == id)
            .map(e => this.byId.get(e.target))
            .filter((x): x is N => !!x)

        let chosen: N[]
        try {
            chosen = await this.runWithRetries(node, allNext)
        } catch (error) {
            if (isStopped(error)) {
                // The user stopped the flow: not a failure, nothing after this node runs.
                this.status.set(id, 'done')
                this.hooks.setNodeState(id, 'idle')
                return
            }
            const err = error instanceof Error ? error : new Error(String(error))
            const settings = (node.data.on_error || {}) as OnErrorSettings
            if (settings.continue) {
                this.context[node.id] = { ...(this.context[node.id] || {}), error: err.message }
                this.hooks.controller.log({ id: node.id, type: 'warning', title: `Failed, continuing: ${err.message}`, nodeType: node.type as never })
                this.hooks.setNodeState(id, 'failed')
                this.status.set(id, 'done')
                return this.activate(outgoing, outgoing.map(e => e.target))
            }
            this.status.set(id, 'done')
            this.hooks.setNodeState(id, 'failed')
            this.hooks.onNodeError?.(node, err)
            this.failures.push(error instanceof BranchError ? error : new BranchError(node, err))
            return this.activate(outgoing, [])
        }

        if (!this.hooks.isRunning()) {
            this.status.set(id, 'done')
            this.hooks.setNodeState(id, 'completed')
            return
        }

        this.status.set(id, 'done')
        this.hooks.setNodeState(id, 'completed')
        await this.activate(outgoing, chosen.map(x => x.id))
    }

    private async runWithRetries(node: N, nextNodes: N[]): Promise<N[]> {
        const settings = (node.data.on_error || {}) as OnErrorSettings
        const attempts = 1 + Math.min(Math.max(settings.retries || 0, 0), 5)
        const process = this.hooks.getProcess(node.type)
        const controller: EngineController = {
            ...this.hooks.controller,
            runBranch: (entryIds, context) => runBranch(entryIds, context, this.nodes, this.edges, this.hooks),
        }

        for (let attempt = 1; ; attempt++) {
            try {
                return await process(this.context, node, nextNodes, controller)
            } catch (error) {
                if (isStopped(error) || attempt >= attempts || !this.hooks.isRunning()) throw error
                const message = error instanceof Error ? error.message : String(error)
                this.hooks.controller.log({ id: node.id, type: 'warning', title: `Attempt ${attempt} failed, retrying: ${message}`, nodeType: node.type as never })
                const keepGoing = await (this.hooks.wait || defaultWait)((settings.retry_delay ?? 2) * 1000)
                if (!keepGoing) throw error
            }
        }
    }

    private async activate(outgoing: EngineEdge[], chosenIds: string[]) {
        const chosen = new Set(chosenIds)
        for (const edge of outgoing) this.edgeState.set(edge.id, chosen.has(edge.target) ? 'active' : 'dead')
        const targets = Array.from(new Set(outgoing.map(e => e.target)))
        await Promise.all(targets.map(t => this.visit(t)))
    }

    private async skip(node: N) {
        this.status.set(node.id, 'skipped')
        this.hooks.setNodeState(node.id, 'skipped')
        const outgoing = this.outgoing(node)
        await this.activate(outgoing, [])
    }
}

function runBranch<N extends EngineNode>(entryIds: string[], context: AppContext, nodes: N[], edges: EngineEdge[], hooks: EngineHooks<N>) {
    const run = new Run(entryIds, context, nodes, edges, hooks, true)
    for (const id of run.nodeIds()) hooks.setNodeState(id, 'waiting')
    return run.start()
}

/** Every node a run can touch, including loop bodies (for the initial "waiting" display). */
export function allReachable(startId: string, nodes: EngineNode[], edges: EngineEdge[]): string[] {
    return Array.from(reachable([startId], nodes, edges))
}

/** Runs the flow from the start node. Node failures are reported through hooks; this resolves when everything has finished. */
export async function runFlow<N extends EngineNode>(startId: string, context: AppContext, nodes: N[], edges: EngineEdge[], hooks: EngineHooks<N>) {
    const run = new Run([startId], context, nodes, edges, hooks, false)
    await run.start()
}
