import type { Edge } from '@xyflow/react'
import { validateGraph } from './engine'
import { getBodyTargets } from './run_flow'
import { snakeCase } from 'lodash'
import { checkReferences } from './references'
import { getNodeDetails } from './nodes'
import { isValidExpression } from './code_runner'
import { replaceDynamicValueWithValueRef } from './logics'
import { findModel, PROVIDERS, ProviderId } from './openai/models'
import type { AppNode } from './store'

/**
 * The pre-run check: what would make the flow fail or behave unexpectedly, found while editing
 * instead of in the middle of a run. Errors stop Run; warnings are shown but the flow still runs.
 */

export type FlowProblem = {
    /** The step the problem is on (none for problems with the flow as a whole). */
    nodeId?: string
    message: string
    severity: 'error' | 'warning'
}

export type CheckContext = {
    /** Whether the user can call this provider (has a key, a server address, or sample answers are on). */
    canUse: (provider: ProviderId) => boolean
    /** Ids of the saved flows (for Sub-flow). */
    savedFlowIds?: string[]
}

type Data = Record<string, unknown>
const text = (value: unknown) => typeof value == 'string' ? value.trim() : ''
const validExpression = (value: string) => isValidExpression(replaceDynamicValueWithValueRef(value))
const providerName = (id: ProviderId) => PROVIDERS.find(p => p.id == id)?.label || id

/** The providers a step calls. */
function providersOf(node: AppNode): ProviderId[] {
    const data = node.data as Data
    const chosen = (data.provider as ProviderId) || findModel(data.model as string)?.provider
    switch (node.type) {
        case 'prompt':
        case 'llm_router':
        case 'web_search':
            return [chosen || 'openai']
        case 'image_generation':
        case 'transcription':
        case 'semantic_search':
            return ['openai']
        case 'model_compare': {
            const models = (data.models as { provider: ProviderId }[] | undefined)?.length
                ? (data.models as { provider: ProviderId }[])
                : [{ provider: 'openai' as ProviderId }, { provider: 'anthropic' as ProviderId }]
            return Array.from(new Set(models.map(m => m.provider)))
        }
        default:
            return []
    }
}

/** Settings each step needs, in the words of its settings panel. */
function stepProblems(node: AppNode, edges: Edge[], ctx: CheckContext): string[] {
    const data = node.data as Data
    const next = edges.filter(e => e.source == node.id).map(e => e.target)
    const problems: string[] = []
    switch (node.type) {
        case 'prompt': {
            const prompts = (data.prompts as { content?: string }[] | undefined) || []
            if (!text(data.system_prompt) && !prompts.some(p => text(p.content))) problems.push('Write what to ask the model (a system prompt or a user prompt).')
            break
        }
        case 'llm_router': {
            const routes = (data.routes || {}) as Record<string, { name?: string } | null>
            if (!text(data.input)) problems.push('Add the text the model should route (Input).')
            if (!next.length) problems.push('Connect the steps it can choose between.')
            const unnamed = next.filter(id => !text(routes[id]?.name))
            if (unnamed.length) problems.push('Give every connected route a name.')
            const names = next.map(id => text(routes[id]?.name)).filter(Boolean)
            const duplicate = names.find((n, i) => names.indexOf(n) != i)
            if (duplicate) problems.push(`Route names must be different ("${duplicate}" is used twice).`)
            break
        }
        case 'decision': {
            const decisions = (data.decisions || {}) as Record<string, { name?: string, condition?: string, type?: string } | null>
            if (!next.length) problems.push('Connect the steps it can choose between.')
            for (const id of next) {
                const d = decisions[id]
                if (!d || !text(d.condition)) problems.push('Every branch needs a name and a condition.')
                else if (d.type != 'else' && !validExpression(d.condition!)) problems.push(`The condition "${d.condition}" is not a valid expression.`)
            }
            break
        }
        case 'loop': {
            const routes = (data.routes || {}) as Record<string, string | null>
            if (next.some(id => !routes[id])) problems.push('Choose "Each item" or "After loop" for every connection.')
            if (!next.some(id => routes[id] == 'each')) problems.push('Connect at least one step as "Each item".')
            if ((data.mode || 'for_each') == 'for_each' && !text(data.items)) problems.push('Choose the list to go through.')
            if (data.mode == 'repeat' && text(data.until) && !validExpression(text(data.until))) problems.push('"Stop when" is not a valid expression.')
            break
        }
        case 'code':
            if (!text(data.code)) problems.push('Write the code to run.')
            break
        case 'assert':
            if (!text(data.condition)) problems.push('Write the condition to check.')
            else if (!validExpression(text(data.condition))) problems.push('The condition is not a valid expression.')
            break
        case 'set_state':
            if (!text(data.variable)) problems.push('Name the variable.')
            if (!text(data.value)) problems.push('Write the value to save.')
            else if (!validExpression(text(data.value))) problems.push('The value is not a valid expression (text needs quotes, e.g. "hello").')
            break
        case 'json_extract':
            if (!text(data.source)) problems.push('Choose the text to read JSON from.')
            break
        case 'http_request': {
            const url = text(data.url)
            if (!url) problems.push('Add the URL to call.')
            else if (!url.includes('{') && !/^https?:\/\//i.test(url)) problems.push('The URL must start with http:// or https://.')
            break
        }
        case 'web_search':
            if (!text(data.query)) problems.push('Write the question to search for.')
            if (data.provider == 'compatible') problems.push('Web search works with OpenAI, Claude or Gemini, not your own server.')
            break
        case 'image_generation':
            if (!text(data.prompt)) problems.push('Describe the image to create.')
            break
        case 'semantic_search':
            if (!text(data.query)) problems.push('Write the question to search for.')
            if (!text(data.documents)) problems.push('Choose the texts to search, e.g. the chunks from Split Text.')
            break
        case 'model_compare':
            if (!text(data.prompt)) problems.push('Write the prompt to send to every model.')
            break
        case 'sub_flow':
            if (!text(data.flow_id)) problems.push('Choose the flow to run.')
            else if (ctx.savedFlowIds && !ctx.savedFlowIds.includes(text(data.flow_id))) problems.push('The chosen flow no longer exists.')
            break
        case 'transcription':
            if (data.source == 'url' && !text(data.audio_url)) problems.push('Add the audio URL.')
            break
    }
    return problems
}

/** Every text in a step's settings, for checking references. */
function textsOf(value: unknown, out: string[] = []): string[] {
    if (typeof value == 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach(v => textsOf(v, out))
    else if (value && typeof value == 'object') Object.values(value).forEach(v => textsOf(v, out))
    return out
}

function reachableFromStart(nodes: AppNode[], edges: Edge[]): Set<string> {
    const seen = new Set<string>(['start'])
    const stack = ['start']
    while (stack.length) {
        const id = stack.pop()!
        for (const e of edges) if (e.source == id && !seen.has(e.target)) { seen.add(e.target); stack.push(e.target) }
    }
    return seen
}

export function checkFlow(nodes: AppNode[], edges: Edge[], ctx: CheckContext): FlowProblem[] {
    const problems: FlowProblem[] = []
    const start = nodes.find(n => n.type == 'start')
    if (!start) return [{ message: 'The flow has no Start step.', severity: 'error' }]

    const graph = validateGraph(start.id, nodes, edges, getBodyTargets)
    if (graph) problems.push({ message: graph, severity: 'error' })

    const reachable = reachableFromStart(nodes, edges)
    for (const node of nodes) {
        if (node.type == 'start') continue
        const name = (node.data.name as string) || getNodeDetails(node.type).name
        if (!reachable.has(node.id)) {
            problems.push({ nodeId: node.id, severity: 'warning', message: `"${name}" isn't connected to Start, so it won't run.` })
            continue
        }
        for (const message of stepProblems(node, edges, ctx)) problems.push({ nodeId: node.id, severity: 'error', message })
        for (const provider of providersOf(node)) {
            if (!ctx.canUse(provider)) problems.push({ nodeId: node.id, severity: 'error', message: provider == 'compatible' ? 'Add your server address in Settings.' : `Add your ${providerName(provider)} API key in Settings (or turn on Sample answers there to try the flow).` })
        }
        const checks = textsOf(node.data).flatMap(t => checkReferences(t, node.id, nodes, edges))
        for (const check of checks) {
            if (check.problem == 'unknown') problems.push({ nodeId: node.id, severity: 'error', message: `Uses {${check.path}}, but there is no step with that id.` })
            else if (check.problem == 'not_before') problems.push({ nodeId: node.id, severity: 'warning', message: `Uses ${check.label}, which doesn't run before this step, so it will be empty.` })
        }
    }

    // Start inputs with no value that some step uses.
    const props = (start.data.properties as { name: string }[] | undefined) || []
    const values = (start.data.propertyValues as Record<string, unknown> | undefined) || {}
    const used = new Set(textsOf(nodes.filter(n => n.id != start.id).map(n => n.data)).join('\n').match(/\{\s*start\.([\w$-]+)/g)?.map(m => m.replace(/^\{\s*start\./, '')) || [])
    for (const prop of props) {
        const key = prop.name ? snakeCase(prop.name) : ''
        if (key && used.has(key) && (values[prop.name] === undefined || values[prop.name] === '')) {
            problems.push({ nodeId: start.id, severity: 'warning', message: `The input "${prop.name}" is empty.` })
        }
    }
    return problems
}

