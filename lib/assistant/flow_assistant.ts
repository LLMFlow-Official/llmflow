import { extractJson } from '../text_utils'
import { autoLayout } from '../layout'
import { validateGraph } from '../engine'
import { EXAMPLE_FLOW, NODE_GUIDE, OUTPUT_RULES } from './catalog'
import type { Message } from '../openai'
import type { ChatMessage } from './assistant_store'

/**
 * The flow-building assistant: the prompt sent to the model, reading its reply, and turning the
 * flow it proposes into a valid flow for the canvas (ids, references, labels, threads, layout).
 */

export type SpecNode = { id: string, type: string, data?: Record<string, unknown> }
export type SpecEdge = { source: string, target: string }
export type FlowSpec = { name?: string, nodes: SpecNode[], edges: SpecEdge[] }
export type AssistantReply = { reply: string, flow?: FlowSpec }

type CanvasNode = { id: string, type: string, position: { x: number, y: number }, data: Record<string, unknown> }
type CanvasEdge = { id: string, source: string, target: string, label?: string, animated?: boolean }

/** Data fields the editor manages itself; never shown to or taken from the model. */
const INTERNAL_KEYS = ['thread', 'parentId', 'state']
/** Node types that may have several outgoing connections. */
const MULTI_OUT = ['decision', 'llm_router', 'loop', 'multi_thread']

const randomHex = () => Math.random().toString(16).slice(2, 6).padEnd(4, '0')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v == 'object' && v !== null && !Array.isArray(v)

function publicData(data: Record<string, unknown> = {}) {
    const copy = { ...data }
    for (const key of INTERNAL_KEYS) delete copy[key]
    return copy
}

/** The current flow as compact JSON for the model (no positions or editor-only fields). */
export function describeFlow(name: string, nodes: CanvasNode[], edges: { source: string, target: string }[]): string {
    return JSON.stringify({
        name,
        nodes: nodes.map(n => ({ id: n.id, type: n.type, data: publicData(n.data) })),
        edges: edges.map(e => ({ source: e.source, target: e.target })),
    })
}

export function buildSystemPrompt(options: {
    models: { provider: string, id: string, label: string }[]
    defaultModel: { provider: string, model: string }
    savedFlows: { id: string, name: string }[]
}): string {
    const models = options.models.map(m => `- ${m.provider}: ${m.id} (${m.label})`).join('\n')
    const flows = options.savedFlows.length
        ? options.savedFlows.map(f => `- ${f.id}: ${f.name}`).join('\n')
        : '(none)'
    return [
        'You design and edit flows for LLM Flow, a visual tool for building AI workflows. The user describes what they want in plain language; you return the flow.',
        NODE_GUIDE,
        `# Models\nUse provider "${options.defaultModel.provider}" with model "${options.defaultModel.model}" for AI nodes unless the user asks for something else. The user has keys for these:\n${models}`,
        `# Saved flows (for sub_flow)\n${flows}`,
        OUTPUT_RULES,
        EXAMPLE_FLOW,
    ].join('\n\n')
}

/** The user's message plus the flow as it is now (the user may have edited it by hand). */
export function buildUserMessage(text: string, currentFlow: string): string {
    return `Current flow:\n${currentFlow}\n\nRequest:\n${text}`
}

/** Reads the model's JSON reply. Throws with a readable message when it is not usable. */
export function parseReply(text: string): AssistantReply {
    const value = extractJson(text)
    if (!isObject(value)) throw new Error('The assistant did not reply with a JSON object')
    const reply = typeof value.reply == 'string' ? value.reply : ''
    if (value.flow === undefined || value.flow === null) {
        if (!reply) throw new Error('The assistant replied with neither a message nor a flow')
        return { reply }
    }
    const flow = value.flow
    if (!isObject(flow) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
        throw new Error('The flow in the reply has no nodes or edges list')
    }
    return {
        reply,
        flow: {
            name: typeof flow.name == 'string' ? flow.name : undefined,
            nodes: flow.nodes.filter(isObject).map(n => ({ id: String(n.id ?? ''), type: String(n.type ?? ''), data: isObject(n.data) ? n.data : {} })),
            edges: flow.edges.filter(isObject).map(e => ({ source: String(e.source ?? ''), target: String(e.target ?? '') })),
        },
    }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type Normalized = {
    nodes: CanvasNode[]
    edges: CanvasEdge[]
    /** Problems to send back to the model for a fix. Empty when the flow is ready. */
    issues: string[]
    changes: { added: string[], removed: string[], changed: string[] }
    /** True when nodes were added or connections changed (the canvas was laid out again). */
    relaidOut: boolean
}

/**
 * Turns the model's flow into a canvas flow and lists what is wrong with it. Existing nodes keep
 * their position unless the structure changed; then the whole flow is laid out again.
 */
export function normalizeFlow(spec: FlowSpec, existing: { nodes: CanvasNode[], edges: { source: string, target: string }[] }, options: { knownTypes: string[], savedFlowIds: string[] }): Normalized {
    const issues: string[] = []
    const known = new Set(options.knownTypes)

    // Nodes: known types, one start called "start", unique and well-formed ids.
    let specNodes = spec.nodes.filter(n => {
        if (!known.has(n.type)) { issues.push(`Node "${n.id}" has an unknown type "${n.type}"`); return false }
        return true
    })
    const starts = specNodes.filter(n => n.type == 'start')
    if (starts.length > 1) issues.push('There must be exactly one start node')
    if (!starts.length) {
        const oldStart = existing.nodes.find(n => n.type == 'start')
        specNodes = [{ id: 'start', type: 'start', data: oldStart ? publicData(oldStart.data) : {} }, ...specNodes]
    }

    // Ids must look like "<type>_<hex>" (other nodes reference them in {id.output}); badly formed ids
    // get a new one and every mention is renamed. A repeated id is reported, not renamed, because
    // references to it are ambiguous.
    const idMap = new Map<string, string>()
    const used = new Set<string>()
    const finalIds: string[] = []
    for (const node of specNodes) {
        let id = node.type == 'start' ? 'start' : node.id
        if (node.type != 'start' && used.has(id)) {
            issues.push(`Two nodes have the id "${id}"; give each node its own id`)
            do { id = `${node.type}_${randomHex()}` } while (used.has(id))
        } else if (node.type != 'start' && !new RegExp(`^${escapeRegExp(node.type)}_[a-z0-9]{3,12}$`).test(id)) {
            do { id = `${node.type}_${randomHex()}` } while (used.has(id))
            if (node.id) idMap.set(node.id, id)
        } else if (node.type == 'start' && node.id && node.id != 'start') {
            idMap.set(node.id, 'start')
        }
        used.add(id)
        finalIds.push(id)
    }

    // Rename ids everywhere they appear: references, decision/route/loop keys, edges.
    const rename = (text: string) => {
        let out = text
        for (const [from, to] of Array.from(idMap.entries())) {
            if (!from) continue
            out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(from)}(?![A-Za-z0-9_])`, 'g'), to)
        }
        return out
    }
    const nodes = specNodes.map((n, i) => ({
        id: finalIds[i],
        type: n.type,
        data: publicData(JSON.parse(rename(JSON.stringify(n.data || {})))),
    }))
    const ids = new Set(nodes.map(n => n.id))
    const byId = new Map(nodes.map(n => [n.id, n]))

    // Edges: existing endpoints, no duplicates or self-loops.
    const seen = new Set<string>()
    const edges: CanvasEdge[] = []
    for (const e of spec.edges) {
        const source = idMap.get(e.source) ?? e.source
        const target = idMap.get(e.target) ?? e.target
        if (!ids.has(source) || !ids.has(target)) { issues.push(`An edge connects "${e.source}" to "${e.target}", but one of them does not exist`); continue }
        if (source == target || seen.has(`${source}>${target}`)) continue
        seen.add(`${source}>${target}`)
        edges.push({ id: `edge_${randomHex()}${randomHex()}`, source, target })
    }

    const outgoing = (id: string) => edges.filter(e => e.source == id).map(e => e.target)
    for (const node of nodes) {
        const targets = outgoing(node.id)
        const name = (node.data.name as string) || node.id
        if (targets.length > 1 && !MULTI_OUT.includes(node.type)) {
            issues.push(`"${name}" (${node.type}) has ${targets.length} outgoing edges; only decision, llm_router, loop and multi_thread may branch`)
        }
        if (node.type == 'decision') {
            const decisions = isObject(node.data.decisions) ? node.data.decisions : {}
            for (const t of targets) if (!isObject(decisions[t]) || !(decisions[t] as Record<string, unknown>).condition) issues.push(`Decision "${name}" has no condition for its branch to "${t}"`)
            for (const key of Object.keys(decisions)) if (!targets.includes(key)) issues.push(`Decision "${name}" has a condition for "${key}", which it is not connected to`)
        }
        if (node.type == 'llm_router') {
            const routes = isObject(node.data.routes) ? node.data.routes : {}
            const names = targets.map(t => isObject(routes[t]) ? String((routes[t] as Record<string, unknown>).name || '') : '')
            targets.forEach((t, i) => { if (!names[i]) issues.push(`LLM Router "${name}" has no route name for its branch to "${t}"`) })
            if (new Set(names.filter(Boolean)).size != names.filter(Boolean).length) issues.push(`LLM Router "${name}" uses the same route name twice`)
        }
        if (node.type == 'loop') {
            const routes = isObject(node.data.routes) ? node.data.routes : {}
            for (const t of targets) if (routes[t] != 'each' && routes[t] != 'done') issues.push(`Loop "${name}" must mark its edge to "${t}" as "each" or "done"`)
            if (!targets.some(t => routes[t] == 'each')) issues.push(`Loop "${name}" has no "each" step`)
        }
        if (node.type == 'sub_flow' && !options.savedFlowIds.includes(String(node.data.flow_id || ''))) {
            issues.push(`Sub-flow "${name}" must use one of the saved flow ids`)
        }
    }

    // References must point at nodes in the flow.
    const text = JSON.stringify(nodes.map(n => n.data))
    for (const match of Array.from(text.matchAll(/\{([a-z_][a-z0-9_]*)\.[^{}"]+\}/g))) {
        const root = match[1]
        if (root != 'state' && !ids.has(root)) issues.push(`The reference ${match[0]} points at "${root}", which is not a node in the flow`)
    }

    const bodyTargets = (n: { type: string, data: Record<string, unknown> }) => n.type == 'loop' && isObject(n.data.routes)
        ? Object.entries(n.data.routes).filter(([, r]) => r == 'each').map(([t]) => t)
        : []
    const graphProblem = validateGraph('start', nodes, edges, bodyTargets)
    if (graphProblem) issues.push(graphProblem)

    // Connection labels, as the editor would set them.
    for (const edge of edges) {
        const source = byId.get(edge.source)!
        const d = source.data
        if (source.type == 'decision' && isObject(d.decisions) && isObject(d.decisions[edge.target])) edge.label = String((d.decisions[edge.target] as Record<string, unknown>).name || '')
        if (source.type == 'llm_router' && isObject(d.routes) && isObject(d.routes[edge.target])) edge.label = String((d.routes[edge.target] as Record<string, unknown>).name || '')
        if (source.type == 'loop' && isObject(d.routes)) edge.label = d.routes[edge.target] == 'each' ? 'Each item' : d.routes[edge.target] == 'done' ? 'After loop' : undefined
        edge.animated = false
    }

    assignThreads(nodes, edges)

    // Changes compared with the flow before.
    const before = new Map(existing.nodes.map(n => [n.id, n]))
    const added = nodes.filter(n => !before.has(n.id)).map(n => n.id)
    const removed = existing.nodes.filter(n => !ids.has(n.id)).map(n => n.id)
    const changed = nodes.filter(n => before.has(n.id) && (before.get(n.id)!.type != n.type || JSON.stringify(publicData(before.get(n.id)!.data)) != JSON.stringify(publicData(n.data)))).map(n => n.id)
    const edgeKey = (list: { source: string, target: string }[]) => list.map(e => `${e.source}>${e.target}`).sort().join('|')
    const relaidOut = added.length > 0 || removed.length > 0 || edgeKey(existing.edges) != edgeKey(edges)

    const positioned = nodes.map(n => ({ ...n, position: before.get(n.id) && 'position' in before.get(n.id)! ? before.get(n.id)!.position : { x: 0, y: 0 } }))
    return {
        nodes: relaidOut ? autoLayout(positioned, edges) : positioned,
        edges,
        issues: Array.from(new Set(issues)),
        changes: { added, removed, changed },
        relaidOut,
    }
}

/**
 * Sets each node's thread the way the editor does when connecting by hand: branches of a Multi
 * Thread get their own thread, a Thread Merge joins its Multi Thread's thread, everything else
 * follows its parent. The editor uses threads to decide which connections are allowed.
 */
export function assignThreads(nodes: { id: string, type: string, data: Record<string, unknown> }[], edges: { source: string, target: string }[]) {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const thread = new Map<string, string>([['start', 'main']])
    const parent = new Map<string, string>()
    const queue = ['start']
    const multiAncestorThread = (id: string): string | undefined => {
        const seen = new Set<string>()
        const stack = [id]
        while (stack.length) {
            const current = stack.pop()!
            if (seen.has(current)) continue
            seen.add(current)
            if (byId.get(current)?.type == 'multi_thread') return thread.get(current)
            stack.push(...edges.filter(e => e.target == current).map(e => e.source))
        }
        return undefined
    }
    while (queue.length) {
        const id = queue.shift()!
        for (const e of edges.filter(x => x.source == id)) {
            if (thread.has(e.target)) continue
            const source = byId.get(id)!
            const target = byId.get(e.target)!
            const t = source.type == 'multi_thread'
                ? `${randomHex()}${randomHex()}`
                : target.type == 'thread_merge'
                    ? multiAncestorThread(id) ?? thread.get(id)!
                    : thread.get(id)!
            thread.set(e.target, t)
            parent.set(e.target, id)
            queue.push(e.target)
        }
    }
    for (const n of nodes) {
        n.data.thread = thread.get(n.id) ?? `${randomHex()}${randomHex()}`
        if (parent.has(n.id)) n.data.parentId = parent.get(n.id)
    }
}

/** Test API stand-in: a small working flow built around the request, so the feature can be tried without a key. */
export function fakeAssistantReply(request: string, provider: string, model: string): string {
    const topic = request.trim().slice(0, 120)
    return JSON.stringify({
        reply: 'Sample answers are on, so here is a simple example flow (an input, one AI step and a result). With an API key, the assistant designs the flow you describe.',
        flow: {
            name: topic.slice(0, 40) || 'Example flow',
            nodes: [
                { id: 'start', type: 'start', data: { properties: [{ name: 'input', type: 'textarea' }], propertyValues: { input: topic } } },
                { id: 'prompt_7e57', type: 'prompt', data: { name: 'AI step', provider, model, system_prompt: `Help with this task: ${topic}`, prompts: [{ role: 'user', content: '{start.input}' }], test_output: '(Test answer)' } },
                { id: 'final_output_7e58', type: 'final_output', data: { name: 'Result', value: '{prompt_7e57.assistant_raw_output}' } },
            ],
            edges: [{ source: 'start', target: 'prompt_7e57' }, { source: 'prompt_7e57', target: 'final_output_7e58' }],
        },
    })
}

/** Earlier turns sent with each request (the current flow is always sent in full). */
const HISTORY_TURNS = 8

/** Earlier turns as alternating user/assistant messages, starting with the user (some providers require both). */
export function priorTurns(messages: Pick<ChatMessage, 'role' | 'text'>[]): Message[] {
    const turns: Message[] = []
    for (const m of messages.filter(m => m.role != 'error').slice(-HISTORY_TURNS)) {
        const role = m.role == 'user' ? 'user' : 'assistant'
        const last = turns[turns.length - 1]
        if (!turns.length && role == 'assistant') continue
        if (last?.role == role) last.content = `${last.content}\n\n${m.text}`
        else turns.push({ role, content: m.text })
    }
    // The new request is a user message, so the history must end with the assistant.
    if (turns[turns.length - 1]?.role == 'user') turns.push({ role: 'assistant', content: '(No reply.)' })
    return turns
}
