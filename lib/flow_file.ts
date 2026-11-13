/**
 * The .flow file format: reading (with validation and migration from older files) and writing.
 *
 * Version 1 (before November 2026): `{ nodes, edges }` with no version field.
 * Version 2: `{ app: "llmflow", version: 2, name?, nodes, edges }`.
 */

export const FLOW_FILE_VERSION = 2

type Position = { x: number, y: number }

export type FlowNode = {
    id: string
    type: string
    position: Position
    data: Record<string, unknown> & { thread: string }
    [key: string]: unknown
}

export type FlowEdge = {
    id: string
    source: string
    target: string
    [key: string]: unknown
}

export type FlowFile = {
    app: 'llmflow'
    version: number
    name?: string
    nodes: FlowNode[]
    edges: FlowEdge[]
}

export type ParsedFlow = {
    name?: string
    nodes: FlowNode[]
    edges: FlowEdge[]
    /** Problems that were fixed automatically, e.g. connections to missing nodes. */
    warnings: string[]
}

/** Node types that run code or contact other servers when the flow is played. */
export const RISKY_NODE_TYPES: Record<string, string> = {
    code: 'runs JavaScript',
    http_request: 'calls a URL',
    decision: 'runs JavaScript conditions',
    set_state: 'runs a JavaScript expression',
    assert: 'runs a JavaScript condition',
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value == 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number => typeof value == 'number' && Number.isFinite(value)

/** Keys React Flow adds while editing that should not be saved. */
const TRANSIENT_NODE_KEYS = ['selected', 'dragging', 'resizing']
const TRANSIENT_EDGE_KEYS = ['selected']

function clean<T extends object>(item: T, keys: string[]): T {
    const copy = { ...item } as Record<string, unknown>
    for (const key of keys) delete copy[key]
    return copy as T
}

export function serializeFlow(nodes: object[], edges: object[], name?: string): string {
    const file: FlowFile = {
        app: 'llmflow',
        version: FLOW_FILE_VERSION,
        ...(name ? { name } : {}),
        nodes: nodes.map(x => clean(x, TRANSIENT_NODE_KEYS)) as FlowNode[],
        edges: edges.map(x => clean(x, TRANSIENT_EDGE_KEYS)) as FlowEdge[],
    }
    return JSON.stringify(file, null, 2)
}

/**
 * Reads a flow from file text or an already parsed object. Throws an Error with a readable message
 * when the flow cannot be used. `knownTypes` is the list of node types this version of the app has.
 */
export function parseFlow(input: string | unknown, knownTypes: string[]): ParsedFlow {
    let raw: unknown = input
    if (typeof input == 'string') {
        try {
            raw = JSON.parse(input)
        } catch {
            throw new Error("This file is not a valid flow (it is not JSON)")
        }
    }
    if (!isObject(raw)) throw new Error("This file is not a valid flow")

    const version = raw.version === undefined ? 1 : raw.version
    if (!isFiniteNumber(version)) throw new Error("This file has an invalid version")
    if (version > FLOW_FILE_VERSION) throw new Error("This flow was made with a newer version of LLM Flow. Update the app to open it.")
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error("This file is not a valid flow (nodes or edges are missing)")

    const warnings: string[] = []
    const nodes: FlowNode[] = []
    const ids = new Set<string>()

    raw.nodes.forEach((node: unknown, index: number) => {
        if (!isObject(node)) throw new Error(`Node ${index + 1} is not valid`)
        if (typeof node.id != 'string' || !node.id) throw new Error(`Node ${index + 1} has no id`)
        if (ids.has(node.id)) throw new Error(`Two nodes have the same id "${node.id}"`)
        if (typeof node.type != 'string' || !knownTypes.includes(node.type)) {
            throw new Error(`Node "${node.id}" has an unknown type "${String(node.type)}"`)
        }
        const position = isObject(node.position) && isFiniteNumber(node.position.x) && isFiniteNumber(node.position.y)
            ? { x: node.position.x, y: node.position.y }
            : (warnings.push(`Node "${node.id}" had no position and was placed at the top left`), { x: 0, y: 0 })
        const data = isObject(node.data) ? node.data : {}
        ids.add(node.id)
        nodes.push({
            ...clean(node, TRANSIENT_NODE_KEYS),
            id: node.id,
            type: node.type,
            position,
            data: { ...data, thread: typeof data.thread == 'string' && data.thread ? data.thread : 'main' },
        })
    })

    const starts = nodes.filter(x => x.type == 'start')
    if (starts.length != 1) throw new Error(starts.length ? "A flow can only have one Start node" : "This flow has no Start node")

    const edges: FlowEdge[] = []
    const edgeIds = new Set<string>()
    raw.edges.forEach((edge: unknown, index: number) => {
        if (!isObject(edge) || typeof edge.source != 'string' || typeof edge.target != 'string') {
            warnings.push(`Connection ${index + 1} was not valid and was removed`)
            return
        }
        if (!ids.has(edge.source) || !ids.has(edge.target)) {
            warnings.push(`A connection to a missing node was removed`)
            return
        }
        let id = typeof edge.id == 'string' && edge.id ? edge.id : `edge_${index}`
        while (edgeIds.has(id)) id = `${id}_dup`
        edgeIds.add(id)
        edges.push({ ...clean(edge, TRANSIENT_EDGE_KEYS), id, source: edge.source, target: edge.target })
    })

    return {
        ...(typeof raw.name == 'string' && raw.name ? { name: raw.name } : {}),
        nodes,
        edges,
        warnings,
    }
}

/** Nodes that run code or contact other servers, for a confirmation before opening a flow. */
export function riskyNodes(nodes: FlowNode[]): { id: string, name: string, reason: string }[] {
    return nodes
        .filter(x => x.type in RISKY_NODE_TYPES)
        .map(x => ({ id: x.id, name: (x.data.name as string) || x.type, reason: RISKY_NODE_TYPES[x.type] }))
}
