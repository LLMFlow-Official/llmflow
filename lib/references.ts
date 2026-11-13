import { getIncomers, type Edge } from '@xyflow/react'
import { getNodeDetails } from './nodes'
import type { AppNode } from './store'

export type ReferenceOption = {
    /** What gets inserted between the braces, e.g. "prompt_x.assistant_raw_output". */
    path: string
    /** e.g. "Summarize · Assistant Raw Output". */
    label: string
    description?: string
}

/** The values a node can use: outputs of every node before it, as {node.output} references. */
export function referenceOptions(baseNodeId: string, nodes: AppNode[], edges: Edge[]): ReferenceOption[] {
    const base = nodes.find(x => x.id == baseNodeId)
    if (!base) return []

    const seen = new Set<string>()
    const ancestors: AppNode[] = []
    const stack = getIncomers(base, nodes, edges)
    while (stack.length) {
        const node = stack.pop() as AppNode
        if (seen.has(node.id) || node.id == baseNodeId) continue
        seen.add(node.id)
        ancestors.push(node)
        stack.push(...getIncomers(node, nodes, edges))
    }
    // Loop nodes are ancestors of their body steps; their item/index are useful there too.
    const options: ReferenceOption[] = []
    for (const node of ancestors) {
        const details = getNodeDetails(node.type)
        if (!details.outputs) continue
        const outputs = details.outputs(node, {})
        if ((node.data as { on_error?: { continue?: boolean } }).on_error?.continue) outputs.error = { title: 'Error' }
        const prefix = details.valueIdentifier?.(node) || node.id
        const nodeName = (node.data.name as string) || details.name
        for (const [key, output] of Object.entries(outputs)) {
            options.push({ path: `${prefix}.${key}`, label: `${nodeName} · ${output.title}`, description: output.description })
        }
    }
    return options
}

/** The reference being typed just before the cursor, e.g. "{prompt_x.ass" gives "prompt_x.ass". */
export function typedReference(textBeforeCursor: string): string | null {
    const match = /\{([\w$.-]*)$/.exec(textBeforeCursor)
    return match ? match[1] : null
}

/** Options matching what has been typed, best first. */
export function filterReferences(options: ReferenceOption[], query: string, limit = 8): ReferenceOption[] {
    const q = query.toLowerCase()
    if (!q) return options.slice(0, limit)
    return options
        .map(o => ({ o, score: o.path.toLowerCase().startsWith(q) ? 0 : o.path.toLowerCase().includes(q) ? 1 : o.label.toLowerCase().includes(q) ? 2 : 3 }))
        .filter(x => x.score < 3)
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map(x => x.o)
}
