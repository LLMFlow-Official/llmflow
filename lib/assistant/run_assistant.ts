import type { Edge } from '@xyflow/react'
import { availableProviders, chatDirect, isTestApi } from '../providers'
import { DEFAULT_MODELS, findModel, modelsFor, ProviderId } from '../openai/models'
import type { Message } from '../openai'
import { AppNode, useFlowStore, useSettingStore } from '../store'
import { renameCurrent, useLibraryStore } from '../library'
import { nodeMetaDetails } from '../nodes'
import { StoppedError } from '../errors'
import { track } from '../analytics'
import { randomId } from '../utils'
import { buildSystemPrompt, buildUserMessage, describeFlow, fakeAssistantReply, normalizeFlow, parseReply, priorTurns } from './flow_assistant'
import { ChatMessage, useAssistantStore } from './assistant_store'

/** Preferred order when the user has not picked a model for the assistant. */
const PREFERRED: ProviderId[] = ['anthropic', 'openai', 'google', 'compatible']
/** Automatic fix rounds when the reply is not valid JSON or the flow has problems. */
const FIX_ROUNDS = 1

export type AssistantModel = { provider: ProviderId, model: string }

/** The model the assistant uses: the saved choice if its provider is usable, else the first usable provider's default. */
export function assistantModel(): AssistantModel | undefined {
    const settings = useSettingStore.getState()
    const usable = availableProviders()
    if (settings.assistantProvider && settings.assistantModel && usable.includes(settings.assistantProvider)) {
        return { provider: settings.assistantProvider, model: settings.assistantModel }
    }
    const provider = PREFERRED.find(p => usable.includes(p))
    if (!provider) return undefined
    const model = provider == 'compatible' ? (settings.accountModels.compatible?.[0] || '') : DEFAULT_MODELS[provider]
    return model ? { provider, model } : undefined
}

const isEmptyFlow = (nodes: AppNode[], edges: Edge[]) => nodes.length <= 1 && edges.length == 0

/**
 * Sends one request to the assistant and applies the flow it returns to the open flow. Replies
 * that are not valid JSON, or flows with problems, are sent back once for an automatic fix.
 */
export async function askAssistant(text: string, onApplied?: () => void) {
    const store = useAssistantStore.getState()
    const flowId = useLibraryStore.getState().currentId
    if (!flowId || store.busy || !text.trim()) return
    const choice = assistantModel()
    const history = priorTurns(store.chats[flowId] || [])
    store.add(flowId, { id: randomId(), role: 'user', text })

    const abort = new AbortController()
    useAssistantStore.setState({ busy: true, status: 'Designing the flow', received: 0, abort })
    track('assistant_request', { provider: choice?.provider, model: choice?.model })

    try {
        if (!choice) throw new Error('Add an API key in Settings (or turn on the Test API in Developer mode) to use the assistant')
        const { nodes, edges } = useFlowStore.getState()
        const flowName = useLibraryStore.getState().currentName
        const savedFlows = useLibraryStore.getState().flows.filter(f => f.id != flowId)
        const usable = availableProviders()
        const models = usable.flatMap(p => modelsFor(p).filter(m => m.group != 'Deprecated' && !m.deprecated).map(m => ({ provider: p, id: m.id, label: m.label })))
        const systemPrompt = buildSystemPrompt({ models, defaultModel: choice, savedFlows: savedFlows.map(f => ({ id: f.id, name: f.name })) })
        const messages: Message[] = [...history, { role: 'user', content: buildUserMessage(text, describeFlow(flowName, nodes, edges)) }]
        const knownTypes = nodeMetaDetails.map(x => x.type)
        const efforts = findModel(choice.model)?.reasoningEfforts
        let cost = 0
        let costKnown = true

        for (let round = 0; ; round++) {
            let raw: string
            if (isTestApi()) {
                await new Promise(r => setTimeout(r, 400))
                if (abort.signal.aborted) throw new StoppedError()
                raw = fakeAssistantReply(text, choice.provider, choice.model)
            } else {
                const result = await chatDirect({
                    provider: choice.provider,
                    model: choice.model,
                    systemPrompt,
                    messages,
                    responseFormat: 'json_object',
                    reasoningEffort: efforts?.includes('medium') ? 'medium' : undefined,
                    maxOutputTokens: 32_000,
                }, {
                    signal: abort.signal,
                    onText: delta => useAssistantStore.setState(s => ({ received: s.received + delta.length })),
                })
                raw = result.text
                if (result.cost) cost += result.cost.toNumber()
                else costKnown = false
            }

            let reply
            try {
                reply = parseReply(raw)
            } catch (error) {
                if (round >= FIX_ROUNDS) throw error
                messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `${(error as Error).message}. Reply again with only the JSON object described in the instructions.` })
                useAssistantStore.setState({ status: 'Reading the reply again', received: 0 })
                continue
            }

            const costText = isTestApi() ? undefined : costKnown ? `$${cost.toFixed(4)}` : undefined
            if (!reply.flow) {
                useAssistantStore.getState().add(flowId, { id: randomId(), role: 'assistant', text: reply.reply, cost: costText })
                return
            }

            const result = normalizeFlow(reply.flow, { nodes, edges }, { knownTypes, savedFlowIds: savedFlows.map(f => f.id) })
            if (result.issues.length && round < FIX_ROUNDS) {
                messages.push(
                    { role: 'assistant', content: raw },
                    { role: 'user', content: `The flow has these problems:\n${result.issues.map(i => `- ${i}`).join('\n')}\nFix them and reply with the complete corrected JSON object.` },
                )
                useAssistantStore.setState({ status: `Fixing ${result.issues.length} problem${result.issues.length == 1 ? '' : 's'}`, received: 0 })
                continue
            }

            // The user may have run the flow or switched flows while waiting.
            if (useLibraryStore.getState().currentId != flowId) throw new Error('Another flow was opened, so the change was not applied. Open the flow again and resend the request.')
            const now = useFlowStore.getState()
            const before = { nodes: now.nodes, edges: now.edges }
            const wasEmpty = isEmptyFlow(now.nodes, now.edges)
            useFlowStore.setState({ nodes: result.nodes as AppNode[], edges: result.edges as Edge[] })
            if (wasEmpty && reply.flow.name) await renameCurrent(reply.flow.name)
            useAssistantStore.getState().add(flowId, {
                id: randomId(),
                role: 'assistant',
                text: reply.reply || 'Done.',
                changes: result.changes,
                warnings: result.issues.length ? result.issues : undefined,
                cost: costText,
                before,
            })
            track('assistant_applied', { added: result.changes.added.length, removed: result.changes.removed.length, changed: result.changes.changed.length, issues: result.issues.length })
            onApplied?.()
            return
        }
    } catch (error) {
        const stopped = error instanceof StoppedError || abort.signal.aborted
        useAssistantStore.getState().add(flowId, { id: randomId(), role: 'error', text: stopped ? 'Stopped.' : (error as Error).message })
    } finally {
        useAssistantStore.setState({ busy: false, status: '', received: 0, abort: undefined })
    }
}

export function stopAssistant() {
    useAssistantStore.getState().abort?.abort()
}

/** Puts the flow back as it was before a reply's change. */
export function undoAssistantChange(flowId: string, message: ChatMessage) {
    if (!message.before || useLibraryStore.getState().currentId != flowId) return
    useFlowStore.setState({ nodes: message.before.nodes, edges: message.before.edges })
    useAssistantStore.getState().update(flowId, message.id, { undone: true })
    track('assistant_undo')
}
