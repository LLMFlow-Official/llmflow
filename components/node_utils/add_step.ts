import type { Edge } from "@xyflow/react";
import { AppNode, useFlowStore } from "@/lib/store";
import { connectionProblem } from "@/lib/connections";
import { NodeType } from "@/lib/nodes";
import { randomId } from "@/lib/utils";
import { track } from "@/lib/analytics";

/** A short, readable id for a new step: "prompt_1", "prompt_2"… (references use ids, e.g. {prompt_2.answer}). */
export function nextStepId(type: string, nodes: { id: string }[]): string {
    const used = new Set(nodes.map(n => n.id))
    for (let n = 1; ; n++) if (!used.has(`${type}_${n}`)) return `${type}_${n}`
}

/** The step a new step goes after: the selected one, else the lowest step with nothing after it. */
export function anchorStep(nodes: AppNode[], edges: Edge[]): AppNode | undefined {
    const selected = nodes.filter(n => n.selected)
    if (selected.length == 1) return selected[0]
    const ends = nodes.filter(n => !edges.some(e => e.source == n.id))
    const pool = ends.length ? ends : nodes
    return [...pool].sort((a, b) => (b.position.y - a.position.y) || (b.position.x - a.position.x))[0]
}

/** A free spot below a step, moving right until it does not cover another step. */
export function spotBelow(anchor: AppNode | undefined, nodes: AppNode[]): { x: number, y: number } {
    if (!anchor) return { x: 0, y: 0 }
    const height = anchor.measured?.height ?? 60
    const spot = { x: anchor.position.x, y: anchor.position.y + height + 90 }
    while (nodes.some(n => Math.abs(n.position.x - spot.x) < 200 && Math.abs(n.position.y - spot.y) < 70)) spot.x += 240
    return spot
}

/**
 * Adds a step, connects it after `from` when the rules allow it, and selects it (which opens its
 * settings). Returns the new step's id.
 */
export function addStep(type: NodeType, options: { from?: string, position?: { x: number, y: number } } = {}): string {
    const { nodes, edges, onNodesChange, onConnect } = useFlowStore.getState()
    const from = options.from ? nodes.find(n => n.id == options.from) : anchorStep(nodes, edges)
    const id = nextStepId(type, nodes)
    const node = {
        id,
        type,
        position: options.position ?? spotBelow(from, nodes),
        data: { thread: randomId() },
    } as AppNode
    useFlowStore.getState().pushNode(node)

    let connected = false
    if (from && connectionProblem(from.id, id, [...nodes, node], edges) == null) {
        onConnect({ source: from.id, target: id, sourceHandle: null, targetHandle: null })
        connected = true
    }
    const current = useFlowStore.getState().nodes
    onNodesChange(current.map(n => ({ type: 'select' as const, id: n.id, selected: n.id == id })))
    track('node_created', { type, connected })
    return id
}
