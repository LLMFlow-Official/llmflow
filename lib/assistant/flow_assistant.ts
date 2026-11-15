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
            nodes: flow.nodes.filter(isObject).map(toSpecNode),
            edges: flow.edges.filter(isObject).map(toSpecEdge),
        },
    }
}

const toSpecNode = (n: Record<string, unknown>): SpecNode => ({ id: String(n.id ?? ''), type: String(n.type ?? ''), data: isObject(n.data) ? n.data : {} })
const toSpecEdge = (e: Record<string, unknown>): SpecEdge => ({ source: String(e.source ?? ''), target: String(e.target ?? '') })

/** The part of a flow that has fully arrived while the reply is still streaming. */
export type PartialFlow = { nodes: SpecNode[], edges: SpecEdge[], /** The nodes list is complete. */ nodesDone: boolean }

/**
 * Reads the nodes and edges that have arrived so far in a reply that is still streaming. Only
 * complete nodes and edges are returned. Undefined until the reply's "flow" has started.
 */
export function readPartialFlow(text: string): PartialFlow | undefined {
    type Frame = { kind: '{' | '[', key: string | null, start: number, expectKey: boolean, pendingKey: string | null, currentKey: string | null }
    const begin = text.indexOf('{')
    if (begin < 0) return undefined
    const stack: Frame[] = []
    const out: PartialFlow = { nodes: [], edges: [], nodesDone: false }
    let sawFlow = false
    // Depth 0 is the reply, 1 the flow, 2 its nodes/edges lists, 3 one node or edge.
    const inFlow = () => stack.length >= 2 && stack[1].key == 'flow' && stack[1].kind == '{'
    for (let i = begin; i < text.length; i++) {
        const c = text[i]
        const top = stack[stack.length - 1]
        if (c == '"') {
            let j = i + 1
            while (j < text.length && text[j] != '"') j += text[j] == '\\' ? 2 : 1
            if (j >= text.length) break
            if (top?.kind == '{' && top.expectKey) {
                try { top.pendingKey = JSON.parse(text.slice(i, j + 1)) } catch { top.pendingKey = null }
            }
            i = j
        } else if (c == '{' || c == '[') {
            const key = top?.kind == '{' ? top.currentKey : null
            stack.push({ kind: c, key, start: i, expectKey: c == '{', pendingKey: null, currentKey: null })
            if (stack.length == 2 && key == 'flow' && c == '{') sawFlow = true
        } else if (c == '}' || c == ']') {
            const frame = stack.pop()
            if (!frame || !stack.length) break
            const parent = stack[stack.length - 1]
            if (stack.length == 3 && inFlow() && parent.kind == '[' && frame.kind == '{' && (parent.key == 'nodes' || parent.key == 'edges')) {
                try {
                    const value = JSON.parse(text.slice(frame.start, i + 1))
                    if (parent.key == 'nodes') out.nodes.push(toSpecNode(value))
                    else out.edges.push(toSpecEdge(value))
                } catch { /* not a usable item; the final reply decides */ }
            }
            if (stack.length == 2 && inFlow() && frame.kind == '[' && frame.key == 'nodes') out.nodesDone = true
        } else if (c == ':' && top?.kind == '{') {
            top.currentKey = top.pendingKey
            top.expectKey = false
        } else if (c == ',' && top?.kind == '{') {
            top.expectKey = true
        }
    }
    return sawFlow ? out : undefined
}

/**
 * The canvas while a reply streams in: the steps that have arrived so far, the earlier steps the
 * reply has not repeated yet (the reply always lists the whole flow), and the connections known so
 * far. New steps are laid out as they come; a step with no connection yet is placed under the
 * step it references (or the one before it), so the layout grows instead of jumping.
 */
export function previewFlow(partial: PartialFlow, base: { nodes: CanvasNode[], edges: { source: string, target: string }[] }, options: { knownTypes: string[], savedFlowIds: string[] }): { nodes: CanvasNode[], edges: CanvasEdge[] } {
    const streamed = new Set(partial.nodes.map(n => n.id))
    const hasStart = partial.nodes.some(n => n.type == 'start')
    const kept = partial.nodesDone ? [] : base.nodes.filter(n => !streamed.has(n.id) && !(hasStart && n.type == 'start'))
    const nodes: SpecNode[] = [...partial.nodes, ...kept.map(n => ({ id: n.id, type: n.type, data: publicData(n.data) }))]
    const ids = new Set(nodes.map(n => n.id))
    const edges = [...partial.edges, ...base.edges.filter(e => ids.has(e.source) && ids.has(e.target))]
    const result = normalizeFlow({ nodes, edges }, base, options)
    const shown = result.edges.map(e => ({ ...e, id: `edge_${e.source}_${e.target}` }))
    if (!result.changes.added.length) return { nodes: result.nodes, edges: shown }

    const order = result.nodes.map(n => n.id)
    const hasParent = new Set(shown.map(e => e.target))
    const layoutEdges: { source: string, target: string }[] = [...shown]
    result.nodes.forEach((node, i) => {
        if (node.type == 'start' || hasParent.has(node.id)) return
        // Prefer the latest earlier step it references; steps kept from before come last in the list, so any is fine.
        const refs = Array.from(JSON.stringify(node.data).matchAll(/\{([a-z_][a-z0-9_]*)\./g), m => order.indexOf(m[1])).filter(r => r >= 0 && r != i)
        const earlier = refs.filter(r => r < i)
        const parent = earlier.length ? order[Math.max(...earlier)] : refs.length ? order[refs[0]] : order[i - 1]
        if (parent) layoutEdges.push({ source: parent, target: node.id })
    })
    return { nodes: autoLayout(result.nodes, layoutEdges), edges: shown }
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
