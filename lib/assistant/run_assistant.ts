import type { Edge } from '@xyflow/react'
import { availableProviders, chatDirect, isTestApi } from '../providers'
import { DEFAULT_MODELS, findModel, modelsFor, ProviderId } from '../openai/models'
import type { Message } from '../openai'
import { AppNode, useFlowStore, useSettingStore } from '../store'
import { renameCurrent, restoreSavedFlow, useLibraryStore } from '../library'
import { nodeMetaDetails } from '../nodes'
import { StoppedError } from '../errors'
import { track } from '../analytics'
import { randomId } from '../utils'
import { buildSystemPrompt, buildUserMessage, describeFlow, fakeAssistantReply, normalizeFlow, parseReply, previewFlow, priorTurns, readPartialFlow } from './flow_assistant'
import { ChatMessage, chatOf, useAssistantStore } from './assistant_store'

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

/** How often the canvas follows a streaming reply (it only changes when a whole step or connection has arrived). */
const PREVIEW_EVERY_MS = 120

type FlowSnapshot = { nodes: AppNode[], edges: Edge[] }

/**
 * Shows the flow on the canvas while the reply streams in, one step at a time. The steps shown
 * before the reply is complete are not recorded in undo history; finish() puts the final flow (or
 * the flow as it was) in place as a single change.
 */
function livePreview(flowId: string, original: FlowSnapshot, options: { knownTypes: string[], savedFlowIds: string[] }, onChange?: () => void) {
    const temporal = useFlowStore.temporal.getState()
    let shown = false
    let base: FlowSnapshot = original
    let lastKey = ''
    let lastAt = 0
    const isOpen = () => useLibraryStore.getState().currentId == flowId

    const preview = {
        get shown() { return shown },
        /** Updates the canvas from the reply received so far. */
        update(text: string, force = false) {
            if (!isOpen()) return
            const now = Date.now()
            if (!force && now - lastAt < PREVIEW_EVERY_MS) return
            lastAt = now
            const partial = readPartialFlow(text)
            if (!partial?.nodes.length) return
            const key = `${partial.nodes.length}/${partial.edges.length}/${partial.nodesDone}`
            if (key == lastKey) return
            lastKey = key
            if (!shown) { temporal.pause(); shown = true }
            const flow = previewFlow(partial, base, options)
            useFlowStore.setState({ nodes: flow.nodes as AppNode[], edges: flow.edges as Edge[] })
            const count = partial.nodes.filter(n => n.type != 'start').length
            useAssistantStore.setState({ status: partial.nodesDone ? 'Connecting the steps' : `Adding steps (${count})` })
            onChange?.()
        },
        /** A fix round streams the whole flow again; it builds on what is on the canvas now. */
        nextRound() {
            if (shown && isOpen()) base = { nodes: useFlowStore.getState().nodes, edges: useFlowStore.getState().edges }
            lastKey = ''
        },
        /** Ends the preview: shows the final flow, or puts the flow back as it was. */
        finish(final?: FlowSnapshot) {
            if (!shown) {
                if (final) useFlowStore.setState(final)
                return
            }
            shown = false
            if (isOpen()) useFlowStore.setState({ nodes: original.nodes, edges: original.edges })
            temporal.resume()
            if (final) useFlowStore.setState(final)
        },
    }
    return preview
}

/** Plays a complete reply as if it were streaming, so the canvas fills step by step with sample answers too. */
async function playBack(text: string, signal: AbortSignal, onText: (delta: string) => void) {
    const chunk = Math.max(24, Math.ceil(text.length / 40))
    for (let i = 0; i < text.length; i += chunk) {
        if (signal.aborted) throw new StoppedError()
        onText(text.slice(i, i + chunk))
        await new Promise(r => setTimeout(r, 30))
    }
}

/**
 * Sends one request to the assistant. The flow it returns appears on the canvas step by step while
 * the reply streams in, and is applied as one change when the reply is complete. Replies that are
 * not valid JSON, or flows with problems, are sent back once for an automatic fix.
 * `onCanvasChange` is called whenever the canvas changes (to keep the flow in view).
 */
export async function askAssistant(text: string, onCanvasChange?: () => void) {
    const store = useAssistantStore.getState()
    const flowId = useLibraryStore.getState().currentId
    if (!flowId || store.busy || !text.trim()) return
    const choice = assistantModel()
    const history = priorTurns(chatOf(flowId))
    store.add(flowId, { id: randomId(), role: 'user', text })

    const abort = new AbortController()
    useAssistantStore.setState({ busy: true, status: 'Designing the flow', received: 0, abort })
    track('assistant_request', { provider: choice?.provider, model: choice?.model })

    const { nodes, edges } = useFlowStore.getState()
    const original = { nodes, edges }
    const savedFlows = useLibraryStore.getState().flows.filter(f => f.id != flowId)
    const knownTypes = nodeMetaDetails.map(x => x.type)
    const options = { knownTypes, savedFlowIds: savedFlows.map(f => f.id) }
    const preview = livePreview(flowId, original, options, onCanvasChange)

    // Opening another flow mid-reply stops the request and keeps the half-built change out of this flow.
    let switched = false
    const unsubscribe = useLibraryStore.subscribe(state => {
        if (switched || state.currentId == flowId) return
        switched = true
        abort.abort()
        if (preview.shown) {
            preview.finish()
            restoreSavedFlow(flowId, original.nodes, original.edges)
        }
    })

    try {
        if (!choice) throw new Error('Add an API key in Settings (or turn on Sample answers there) to use the assistant')
        const flowName = useLibraryStore.getState().currentName
        const usable = availableProviders()
        const models = usable.flatMap(p => modelsFor(p).filter(m => m.group != 'Deprecated' && !m.deprecated).map(m => ({ provider: p, id: m.id, label: m.label })))
        const systemPrompt = buildSystemPrompt({ models, defaultModel: choice, savedFlows: savedFlows.map(f => ({ id: f.id, name: f.name })) })
        const messages: Message[] = [...history, { role: 'user', content: buildUserMessage(text, describeFlow(flowName, nodes, edges)) }]
        const efforts = findModel(choice.model)?.reasoningEfforts
        let cost = 0
        let costKnown = true

        for (let round = 0; ; round++) {
            let streamed = ''
            const onText = (delta: string) => {
                streamed += delta
                useAssistantStore.setState(s => ({ received: s.received + delta.length }))
                preview.update(streamed)
            }
            let raw: string
            if (isTestApi()) {
                await new Promise(r => setTimeout(r, 400))
                if (abort.signal.aborted) throw new StoppedError()
                raw = fakeAssistantReply(text, choice.provider, choice.model)
                await playBack(raw, abort.signal, onText)
            } else {
                const result = await chatDirect({
                    provider: choice.provider,
                    model: choice.model,
                    systemPrompt,
                    messages,
                    responseFormat: 'json_object',
                    reasoningEffort: efforts?.includes('medium') ? 'medium' : undefined,
                    maxOutputTokens: 32_000,
                }, { signal: abort.signal, onText })
                raw = result.text
                if (result.cost) cost += result.cost.toNumber()
                else costKnown = false
            }
            if (abort.signal.aborted) throw new StoppedError()
            preview.update(raw, true)

            let reply
            try {
                reply = parseReply(raw)
            } catch (error) {
                if (round >= FIX_ROUNDS) throw error
                messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `${(error as Error).message}. Reply again with only the JSON object described in the instructions.` })
                useAssistantStore.setState({ status: 'Reading the reply again', received: 0 })
                preview.nextRound()
                continue
            }

            const costText = isTestApi() ? undefined : costKnown ? `$${cost.toFixed(4)}` : undefined
            if (!reply.flow) {
                preview.finish()
                useAssistantStore.getState().add(flowId, { id: randomId(), role: 'assistant', text: reply.reply, cost: costText })
                return
            }

            const result = normalizeFlow(reply.flow, original, options)
            if (result.issues.length && round < FIX_ROUNDS) {
                messages.push(
                    { role: 'assistant', content: raw },
                    { role: 'user', content: `The flow has these problems:\n${result.issues.map(i => `- ${i}`).join('\n')}\nFix them and reply with the complete corrected JSON object.` },
                )
                useAssistantStore.setState({ status: `Fixing ${result.issues.length} problem${result.issues.length == 1 ? '' : 's'}`, received: 0 })
                preview.nextRound()
                continue
            }

            // The user may have switched flows while waiting.
            if (switched || useLibraryStore.getState().currentId != flowId) throw new Error('Another flow was opened, so the change was not applied. Open the flow again and resend the request.')
            // Undo goes back to the flow before the request (or, without a preview, to any edits made while waiting).
            const before = preview.shown ? original : { nodes: useFlowStore.getState().nodes, edges: useFlowStore.getState().edges }
            const wasEmpty = isEmptyFlow(before.nodes, before.edges)
            preview.finish({ nodes: result.nodes as AppNode[], edges: result.edges as Edge[] })
            if (wasEmpty && reply.flow.name) await renameCurrent(reply.flow.name)
            useAssistantStore.getState().add(flowId, {
                id: randomId(),
                role: 'assistant',
                text: reply.reply || 'Done.',
                changes: result.changes,
                after: flowSignature(result.nodes as AppNode[], result.edges as Edge[]),
                warnings: result.issues.length ? result.issues : undefined,
                cost: costText,
                before,
            })
            track('assistant_applied', { added: result.changes.added.length, removed: result.changes.removed.length, changed: result.changes.changed.length, issues: result.issues.length })
            onCanvasChange?.()
            return
        }
    } catch (error) {
        preview.finish()
        const stopped = !switched && (error instanceof StoppedError || abort.signal.aborted)
        const message = switched ? 'Another flow was opened, so the change was not applied. Open the flow again and resend the request.' : (error as Error).message
        useAssistantStore.getState().add(flowId, { id: randomId(), role: 'error', text: stopped ? 'Stopped.' : message, retry: text })
    } finally {
        unsubscribe()
        useAssistantStore.setState({ busy: false, status: '', received: 0, abort: undefined })
    }
}

export function stopAssistant() {
    useAssistantStore.getState().abort?.abort()
}

/** What the flow contains (not where steps are), to notice edits made after the assistant's change. */
export function flowSignature(nodes: AppNode[], edges: Edge[]): string {
    return JSON.stringify([nodes.map(n => [n.id, n.type, n.data]), edges.map(e => [e.source, e.target])])
}

/** True when the flow was edited by hand after this reply changed it (Undo would throw those edits away). */
export function editedSince(message: ChatMessage): boolean {
    if (!message.after) return false
    const { nodes, edges } = useFlowStore.getState()
    return flowSignature(nodes, edges) != message.after
}

/** Puts the flow back as it was before a reply's change. */
export function undoAssistantChange(flowId: string, message: ChatMessage) {
    if (!message.before || useLibraryStore.getState().currentId != flowId) return
    useFlowStore.setState({ nodes: message.before.nodes, edges: message.before.edges })
    useAssistantStore.getState().update(flowId, message.id, { undone: true })
    track('assistant_undo')
}
