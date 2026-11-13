import { getIncomers, getOutgoers, type Edge } from '@xyflow/react'

/**
 * Which connections between steps are allowed, and why one is not, in plain words. Used by the
 * canvas handles, by "Add step" (to connect the new step automatically) and to explain a
 * connection that was refused.
 *
 * The rules follow the editor's threads: a step normally has one next step; only branching steps
 * (Decision, AI Router, Loop, Run in parallel) have several. Branches started by Run in parallel
 * come back together at Wait for all.
 */

type Step = { id: string, type?: string, data: Record<string, unknown> }

/** Step types that may have several next steps. */
export const BRANCHING_TYPES = ['multi_thread', 'decision', 'llm_router', 'loop']

const label = (node: Step) => `"${(node.data.name as string) || stepTypeName(node.type)}"`

function stepTypeName(type?: string) {
    switch (type) {
        case 'multi_thread': return 'Run in parallel'
        case 'thread_merge': return 'Wait for all'
        case 'llm_router': return 'AI Router'
        case 'ai_decisions': return 'AI Decisions'
        default: return type ? type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'step'
    }
}

/** The thread of the nearest Run in parallel step before these steps (what Wait for all joins). */
export function parallelThreadBefore(start: Step[], nodes: Step[], edges: Edge[]): unknown {
    const queue = [...start]
    const seen = new Set<string>()
    while (queue.length) {
        const node = queue.pop()!
        if (seen.has(node.id)) continue
        seen.add(node.id)
        if (node.type == 'multi_thread') return node.data.thread
        queue.push(...getIncomers(node as never, nodes as never[], edges) as Step[])
    }
    return undefined
}

function reaches(fromId: string, toId: string, edges: Edge[]) {
    const queue = [fromId]
    const seen = new Set<string>()
    while (queue.length) {
        const id = queue.pop()!
        if (id == toId) return true
        if (seen.has(id)) continue
        seen.add(id)
        for (const edge of edges) if (edge.source == id) queue.push(edge.target)
    }
    return false
}

/** Returns why the connection is not allowed, or null when it is. */
export function connectionProblem(sourceId: string, targetId: string, nodes: Step[], edges: Edge[]): string | null {
    const source = nodes.find(n => n.id == sourceId)
    const target = nodes.find(n => n.id == targetId)
    if (!source || !target) return 'One of these steps no longer exists.'
    if (source.id == target.id) return 'A step can\'t connect to itself.'
    if (target.type == 'start') return 'Nothing can lead into Start: it is where the flow begins.'
    if (edges.some(e => e.source == source.id && e.target == target.id)) return 'These steps are already connected.'
    if (reaches(target.id, source.id, edges)) return `That would loop back to an earlier step. To repeat steps, use a Loop step.`

    const branching = BRANCHING_TYPES.includes(source.type || '')
    const outgoing = getOutgoers(source as never, nodes as never[], edges)
    const incoming = getIncomers(target as never, nodes as never[], edges) as Step[]
    if (!branching && outgoing.length > 0) {
        return `${label(source)} already has a next step. Only Decision, AI Router, Loop and Run in parallel can have more than one. To do several things at once, add a Run in parallel step.`
    }
    if (branching || incoming.length == 0) return null
    if (target.type == 'thread_merge') {
        if (target.data.thread == parallelThreadBefore([source], nodes, edges)) return null
        return `${label(target)} only joins the branches of the Run in parallel step before it.`
    }
    if (source.data.thread == target.data.thread) return null
    return `${label(target)} already has a step before it. To bring branches back together, connect them to a Wait for all step.`
}
