type LayoutNode = { id: string, type?: string, position: { x: number, y: number }, measured?: { width?: number, height?: number } }
type LayoutEdge = { source: string, target: string }

const RANK_GAP = 110
const NODE_GAP = 50
const DEFAULT_WIDTH = 170
const DEFAULT_HEIGHT = 50

/**
 * Arranges nodes top to bottom in layers: each node sits one layer below its lowest parent, nodes in
 * a layer are ordered by their parents' positions to reduce crossings, and layers are centred.
 * Returns new node objects; nodes that are not connected keep their layer from the start node's
 * point of view (layer 0 if they have no parents).
 */
export function autoLayout<T extends LayoutNode>(nodes: T[], edges: LayoutEdge[]): T[] {
    const ids = new Set(nodes.map(x => x.id))
    const valid = edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source != e.target)

    // Find connections that loop back (depth-first from Start) and leave them out of the layering.
    const out = new Map<string, LayoutEdge[]>(nodes.map(x => [x.id, []]))
    for (const e of valid) out.get(e.source)!.push(e)
    const state = new Map<string, 'visiting' | 'done'>()
    const back = new Set<LayoutEdge>()
    const visit = (id: string) => {
        state.set(id, 'visiting')
        for (const e of out.get(id)!) {
            const s = state.get(e.target)
            if (s == 'visiting') back.add(e)
            else if (!s) visit(e.target)
        }
        state.set(id, 'done')
    }
    const roots = [...nodes].sort((a, b) => (a.type == 'start' ? -1 : b.type == 'start' ? 1 : 0))
    for (const node of roots) if (!state.has(node.id)) visit(node.id)

    const parents = new Map<string, string[]>(nodes.map(x => [x.id, []]))
    for (const e of valid) if (!back.has(e)) parents.get(e.target)!.push(e.source)

    // Longest-path layering on what is now acyclic.
    const rank = new Map<string, number>()
    const rankOf = (id: string): number => {
        if (rank.has(id)) return rank.get(id)!
        const ps = parents.get(id)!
        const r = ps.length ? Math.max(...ps.map(rankOf)) + 1 : 0
        rank.set(id, r)
        return r
    }
    for (const node of nodes) rankOf(node.id)

    const layers: string[][] = []
    // Start first, then the original left-to-right order, so a re-layout is stable.
    const ordered = [...nodes].sort((a, b) => (a.type == 'start' ? -1 : b.type == 'start' ? 1 : a.position.x - b.position.x))
    for (const node of ordered) (layers[rank.get(node.id)!] ||= []).push(node.id)

    const order = new Map<string, number>()
    layers.forEach((layer, r) => {
        if (r > 0) {
            const score = (id: string) => {
                const ps = parents.get(id)!.filter(p => order.has(p))
                return ps.length ? ps.reduce((sum, p) => sum + order.get(p)!, 0) / ps.length : Infinity
            }
            layer.sort((a, b) => score(a) - score(b))
        }
        layer.forEach((id, i) => order.set(id, i))
    })

    const byId = new Map(nodes.map(x => [x.id, x]))
    const width = (id: string) => byId.get(id)?.measured?.width || DEFAULT_WIDTH
    const height = (id: string) => byId.get(id)?.measured?.height || DEFAULT_HEIGHT
    const positions = new Map<string, { x: number, y: number }>()
    let y = 0
    for (const layer of layers) {
        if (!layer) continue
        const total = layer.reduce((sum, id) => sum + width(id), 0) + NODE_GAP * (layer.length - 1)
        let x = -total / 2
        for (const id of layer) {
            positions.set(id, { x: Math.round(x), y: Math.round(y) })
            x += width(id) + NODE_GAP
        }
        y += Math.max(...layer.map(height)) + RANK_GAP
    }

    return nodes.map(node => ({ ...node, position: positions.get(node.id) || node.position }))
}
