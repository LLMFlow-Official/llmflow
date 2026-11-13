import { getIncomers, type Edge } from '@xyflow/react'
import { getNodeDetails } from './nodes'
import { referencePath, referenceRoot, valueReg } from './logics'
import type { AppNode } from './store'

export type ReferenceOption = {
    /** What gets inserted between the braces, e.g. "prompt_x.assistant_raw_output". */
    path: string
    /** e.g. "Summarize → Answer". */
    label: string
    description?: string
}

/** The steps that run before this one (and so can be referenced from it). */
export function stepsBefore(baseNodeId: string, nodes: AppNode[], edges: Edge[]): AppNode[] {
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
    return ancestors
}

function stepsAfter(baseNodeId: string, edges: Edge[]): Set<string> {
    const seen = new Set<string>()
    const stack = [baseNodeId]
    while (stack.length) {
        const id = stack.pop()!
        for (const e of edges) if (e.source == id && !seen.has(e.target)) { seen.add(e.target); stack.push(e.target) }
    }
    return seen
}

/** Outputs that describe the step itself rather than its result; listed last. */
const DETAIL_OUTPUTS = ['name', 'model_name', 'system_prompt']

function stepOutputs(node: AppNode) {
    const details = getNodeDetails(node.type)
    const outputs = details.outputs ? details.outputs(node, {}) : {}
    if ((node.data as { on_error?: { continue?: boolean } }).on_error?.continue) outputs.error = { title: 'Error' }
    return outputs
}

const stepName = (node: AppNode) => (node.data.name as string) || getNodeDetails(node.type).name
const stepPrefix = (node: AppNode) => getNodeDetails(node.type).valueIdentifier?.(node) || node.id

/** The values a node can use: outputs of every node before it, as {node.output} references. */
export function referenceOptions(baseNodeId: string, nodes: AppNode[], edges: Edge[]): ReferenceOption[] {
    // Loop nodes are ancestors of their body steps; their item/index are useful there too.
    const options: ReferenceOption[] = []
    for (const node of stepsBefore(baseNodeId, nodes, edges)) {
        const entries = Object.entries(stepOutputs(node))
        entries.sort(([a], [b]) => Number(DETAIL_OUTPUTS.includes(a)) - Number(DETAIL_OUTPUTS.includes(b)))
        for (const [key, output] of entries) {
            options.push({ path: `${stepPrefix(node)}.${key}`, label: `${stepName(node)} → ${output.title}`, description: output.description })
        }
    }
    return options
}

export type ReferenceCheck = {
    /** The text between the braces, e.g. "prompt_1.assistant_raw_output". */
    path: string
    /** A readable name, e.g. "Summarize → Answer". */
    label: string
    /** Why the reference will be empty when the flow runs. */
    problem?: 'unknown' | 'not_before'
}

/**
 * Finds the {step.output} references in a step's text and checks each one: is there such a step,
 * and does it run before this one? Braces that are not references (JSON examples) are ignored.
 */
export function checkReferences(text: string, baseNodeId: string, nodes: AppNode[], edges: Edge[]): ReferenceCheck[] {
    if (!text || !text.includes('{')) return []
    const byPrefix = new Map(nodes.map(n => [stepPrefix(n), n]))
    const before = new Set(stepsBefore(baseNodeId, nodes, edges).map(n => n.id))
    before.add(baseNodeId)
    // A Loop's own settings ("Result for each item", "Stop when") read the steps inside it.
    if (nodes.find(n => n.id == baseNodeId)?.type == 'loop') for (const id of stepsAfter(baseNodeId, edges)) before.add(id)
    const checks: ReferenceCheck[] = []
    const seen = new Set<string>()
    for (const match of Array.from(text.matchAll(new RegExp(valueReg.source, 'g')))) {
        const inner = match[1].trim()
        const parsed = referencePath.exec(inner)
        if (!parsed || seen.has(inner)) continue
        const root = parsed[1]
        const node = byPrefix.get(root)
        if (root == 'state') {
            seen.add(inner)
            checks.push({ path: inner, label: `Variable → ${inner.slice('state.'.length)}` })
        } else if (node) {
            seen.add(inner)
            const key = inner.slice(root.length + 1)
            const outputs = stepOutputs(node)
            const title = outputs[key]?.title || outputs[key.split(/[.[]/)[0]]?.title || key
            checks.push({ path: inner, label: `${stepName(node)} → ${title}`, problem: before.has(node.id) ? undefined : 'not_before' })
        } else if (referenceRoot.test(root)) {
            seen.add(inner)
            checks.push({ path: inner, label: inner, problem: 'unknown' })
        }
    }
    return checks
}

/** Steps (other than the ones being deleted) whose settings mention one of these steps. */
export function stepsUsing(ids: string[], nodes: AppNode[]): AppNode[] {
    // Set variable steps are all read as {state.<variable>}.
    const prefixes = nodes.filter(n => ids.includes(n.id)).map(n => stepPrefix(n) == 'state' ? `state.${n.data.variable}` : stepPrefix(n))
    if (!prefixes.length) return []
    const patterns = prefixes.map(p => new RegExp(`\\{\\s*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.}[]`))
    return nodes.filter(n => !ids.includes(n.id) && patterns.some(re => re.test(JSON.stringify(n.data))))
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
