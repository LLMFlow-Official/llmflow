import type { Edge } from '@xyflow/react'
import { allReachable, EngineNode, ProcessFn, runFlow, validateGraph } from './engine'
import { AppContext, Controller, getNodeDetails, NodeType } from './nodes'
import { AppNode, FinalOutput, NodeLogs, useFlowStore, useRuntimeStore, waitWhileRunning } from './store'
import { saveRun, useLibraryStore } from './library'
import { track } from './analytics'

export type RunSummary = {
    status: 'completed' | 'failed' | 'stopped'
    startedAt: number
    endedAt: number
    cost: number
    costIncomplete: boolean
    inTokens: number
    outTokens: number
    logs: NodeLogs[]
    finalOutputs: FinalOutput[]
    context: AppContext
    errors: { nodeId: string, message: string }[]
}

export const getBodyTargets = (node: EngineNode) => getNodeDetails(node.type as NodeType).bodyTargets?.(node as AppNode) || []
const getProcess = (type: string) => getNodeDetails(type as NodeType).process as unknown as ProcessFn

/** Returns the nodes with the Start node's input values replaced (used by test cases and sub-flows). */
export function withStartValues(nodes: AppNode[], values?: Record<string, unknown>): AppNode[] {
    if (!values) return nodes
    return nodes.map(node => node.type != 'start' ? node : {
        ...node,
        data: { ...node.data, propertyValues: { ...((node.data as { propertyValues?: object }).propertyValues || {}), ...values } },
    })
}

/** Names of the Start node's inputs. */
export function startInputs(nodes: AppNode[]): string[] {
    const start = nodes.find(x => x.type == 'start')
    return ((start?.data as { properties?: { name: string }[] } | undefined)?.properties || []).map(x => x.name)
}

let running = false

/**
 * Runs a flow in the editor: node states on the canvas, the runtime log, the run totals and (by
 * default) the run history. Uses the open flow unless nodes and edges are given.
 * Returns null when the flow cannot start.
 */
export async function runInEditor(options: {
    nodes?: AppNode[]
    edges?: Edge[]
    startValues?: Record<string, unknown>
    notify: (title: string, description?: string) => void
    saveHistory?: boolean
}): Promise<RunSummary | null> {
    if (running || useRuntimeStore.getState().isRunning) return null
    const flow = useFlowStore.getState()
    const nodes = withStartValues(options.nodes || flow.nodes, options.startValues)
    const edges = options.edges || flow.edges
    const startNode = nodes.find(node => node.type === 'start')
    if (!startNode) return null

    const problem = validateGraph(startNode.id, nodes, edges, getBodyTargets)
    if (problem) {
        options.notify("This flow can't run", problem)
        return null
    }

    running = true
    const runtime = useRuntimeStore.getState()
    track('started')
    runtime.start()
    const waiting = new Set(allReachable(startNode.id, nodes, edges))
    runtime.setNodeState(Object.fromEntries(nodes.map(x => [x.id, waiting.has(x.id) ? 'waiting' : 'idle'])))

    const errors: RunSummary['errors'] = []
    const controller: Controller = {
        log: runtime.log,
        increaseInToken: runtime.increaseInToken,
        increaseOutToken: runtime.increaseOutToken,
        increaseAmount: runtime.increaseAmount,
    }
    const context: AppContext = {}

    try {
        await runFlow(startNode.id, context, nodes, edges, {
            getProcess,
            getBodyTargets,
            setNodeState: runtime.setNodeStateFromNodeId,
            isRunning: () => useRuntimeStore.getState().isRunning,
            controller,
            wait: waitWhileRunning,
            onNodeError: (node, error) => {
                console.error(error)
                errors.push({ nodeId: node.id, message: error.message })
                // Only the node type: error messages can contain prompt text or model output.
                track('flow_error', { nodeType: node.type })
                controller.log({ id: node.id, nodeType: node.type as NodeType, type: 'error', title: error.message })
                options.notify(`Something went wrong on ${(node.data.name as string) || getNodeDetails(node.type as NodeType).name}`, error.message)
            },
        })
    } finally {
        running = false
    }

    const stoppedByUser = !useRuntimeStore.getState().isRunning
    useRuntimeStore.getState().stop()
    track('ended')
    setTimeout(() => {
        if (useRuntimeStore.getState().isRunning) return
        useRuntimeStore.getState().setNodeState(Object.fromEntries(useFlowStore.getState().nodes.map(x => [x.id, 'idle'])))
    }, 3000)

    const state = useRuntimeStore.getState()
    const summary: RunSummary = {
        status: stoppedByUser ? 'stopped' : errors.length ? 'failed' : 'completed',
        startedAt: state.startTime || Date.now(),
        endedAt: state.endTime || Date.now(),
        cost: state.amount,
        costIncomplete: state.costIncomplete,
        inTokens: state.inToken,
        outTokens: state.outToken,
        logs: state.logs,
        finalOutputs: state.finalOutputs,
        context,
        errors,
    }

    const flowId = useLibraryStore.getState().currentId
    if (options.saveHistory !== false && flowId) {
        const start = nodes.find(x => x.type == 'start')
        saveRun({
            flowId,
            startedAt: summary.startedAt,
            durationMs: summary.endedAt - summary.startedAt,
            status: summary.status,
            cost: summary.cost,
            costIncomplete: summary.costIncomplete,
            inTokens: summary.inTokens,
            outTokens: summary.outTokens,
            finalOutputs: summary.finalOutputs,
            logs: summary.logs,
            startValues: (start?.data as { propertyValues?: Record<string, unknown> } | undefined)?.propertyValues,
        }).then(() => useLibraryStore.setState(s => ({ historyRevision: (s.historyRevision || 0) + 1 }))).catch(console.error)
    }
    return summary
}

const MAX_SUBFLOW_DEPTH = 3

/**
 * Runs another flow inside the current run (the Sub-flow node): no canvas states, its logs are
 * prefixed with the flow name, and its Final Output values are returned instead of shown.
 * `chain` lists the flows already running, to stop a flow from calling itself.
 */
export async function runNested(options: {
    flowId: string
    flowName: string
    nodes: AppNode[]
    edges: Edge[]
    startValues: Record<string, unknown>
    controller: Controller
    chain: string[]
}): Promise<FinalOutput[]> {
    if (options.chain.includes(options.flowId)) throw new Error(`"${options.flowName}" would run itself (${[...options.chain, options.flowId].length} levels deep)`)
    if (options.chain.length >= MAX_SUBFLOW_DEPTH) throw new Error(`Sub-flows can only be nested ${MAX_SUBFLOW_DEPTH} levels deep`)

    const nodes = withStartValues(options.nodes, options.startValues)
    const edges = options.edges
    const startNode = nodes.find(x => x.type == 'start')
    if (!startNode) throw new Error(`"${options.flowName}" has no Start node`)
    const problem = validateGraph(startNode.id, nodes, edges, getBodyTargets)
    if (problem) throw new Error(`"${options.flowName}" can't run: ${problem}`)

    const finals: FinalOutput[] = []
    const errors: Error[] = []
    const parent = options.controller
    const controller = {
        ...parent,
        log: (entry: NodeLogs) => parent.log({ ...entry, title: `[${options.flowName}] ${entry.title}` }),
        addFinalOutput: (output: FinalOutput) => { finals.push(output) },
        flowChain: [...options.chain, options.flowId],
    } as Controller

    await runFlow(startNode.id, {}, nodes, edges, {
        getProcess,
        getBodyTargets,
        setNodeState: () => { },
        isRunning: () => useRuntimeStore.getState().isRunning,
        controller,
        wait: waitWhileRunning,
        onNodeError: (_node, error) => { errors.push(error) },
    })
    if (errors.length) throw new Error(`"${options.flowName}" failed: ${errors[0].message}`)
    return finals
}
