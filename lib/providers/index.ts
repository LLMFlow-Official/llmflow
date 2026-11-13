import Decimal from "decimal.js-light";
import type { Controller } from "../nodes";
import { createStopSignal, sampleAnswersOn, useRuntimeStore, useSettingStore } from "../store";
import { StoppedError } from "../errors";
import { costOf, getModelStatus, PROVIDERS, ProviderId, totalInput } from "../openai/models";
import { ProviderHttpError } from "./http";
import { openAiProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { compatibleProvider } from "./compatible";
import { ChatRequest, ChatResult, ChatRun, Provider } from "./types";

export * from "./types";

const providers: Record<ProviderId, Provider> = {
    openai: openAiProvider,
    anthropic: anthropicProvider,
    google: googleProvider,
    compatible: compatibleProvider,
}

export const providerLabel = (id: ProviderId) => PROVIDERS.find(x => x.id == id)?.label || id

/** Test API mode: returns the node's test output, streamed in a few pieces, with small fixed usage. */
export function fakeProvider(output: string): Provider {
    return {
        async chat(request, { signal, onText }): Promise<ChatResult> {
            const pieces = output.match(/[\s\S]{1,12}/g) || ['']
            for (const piece of pieces) {
                if (signal?.aborted) throw new StoppedError()
                await new Promise(r => setTimeout(r, Math.min(1000 / pieces.length, 80)))
                onText?.(piece)
            }
            return { text: output, usage: { input: 10, cachedInput: 0, cacheWrite: 0, output: 10, reasoning: 5 }, model: request.model }
        }
    }
}

/** Returns the API key for a provider, or throws a message that says where to add it. */
export function getProviderKey(provider: ProviderId): string {
    const key = useSettingStore.getState().apiKeys[provider]
    if (!key && provider != 'compatible') {
        throw Error(`Add your ${providerLabel(provider)} API key in Settings, or turn on Sample answers there to try the flow without one`)
    }
    return key || ''
}

export function isTestApi(): boolean {
    return sampleAnswersOn(useSettingStore.getState())
}

/** Fails early with a clear message when a node uses a model that has been shut down. */
export function assertModelAvailable(model: string) {
    const status = getModelStatus(model)
    if (status.kind == 'retired') {
        throw Error(`${model} was shut down on ${status.shutdownDate}. Choose another model in this node's settings${status.replacement ? ` (the provider suggests ${status.replacement})` : ''}.`)
    }
}

/* ---------------- Parallel request limit ---------------- */

let active = 0
const queue: (() => void)[] = []

/** Waits for a free slot (see Settings, "AI requests at the same time"). */
export function acquireSlot(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
        const grant = () => {
            active++
            let released = false
            resolve(() => {
                if (released) return
                released = true
                active--
                const next = queue.shift()
                if (next) next()
            })
        }
        const max = Math.max(useSettingStore.getState().maxParallelRequests || 4, 1)
        if (active < max) return grant()
        const waiter = () => {
            signal.removeEventListener('abort', onAbort)
            grant()
        }
        const onAbort = () => {
            const index = queue.indexOf(waiter)
            if (index != -1) queue.splice(index, 1)
            reject(new StoppedError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        queue.push(waiter)
    })
}

/* ---------------- Running a request ---------------- */

const MAX_RETRIES = 2

function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
        const onAbort = () => { clearTimeout(timer); reject(new StoppedError()) }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

/** Streams text into the runtime store for the log panel, at most every 80 ms. */
function streamingWriter(nodeId: string) {
    let buffer = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
        timer = undefined
        if (buffer) useRuntimeStore.getState().appendStreaming(nodeId, buffer)
        buffer = ''
    }
    return {
        write: (text: string) => {
            buffer += text
            if (!timer) timer = setTimeout(flush, 80)
        },
        reset: () => {
            if (timer) clearTimeout(timer)
            timer = undefined
            buffer = ''
            useRuntimeStore.getState().clearStreaming(nodeId)
        },
    }
}

/**
 * Runs one AI request for a node: Test API, keys, parallel limit, stop and timeout, retries for
 * rate limits and server errors (only before any text has arrived), live text, and run totals.
 */
export async function runChat(request: ChatRequest, controller: Controller, options: { nodeId: string, testOutput?: string }): Promise<ChatRun> {
    const testMode = isTestApi()
    if (testMode && !options.testOutput) throw Error("Add a sample answer in this step's settings (needed while sample answers are on)")
    const apiKey = testMode ? '' : getProviderKey(request.provider)
    if (!testMode) assertModelAvailable(request.model)
    const provider = testMode ? fakeProvider(options.testOutput!) : providers[request.provider]
    const settings = useSettingStore.getState()

    const stop = createStopSignal()
    const release = await acquireSlot(stop.signal).catch((error) => { stop.dispose(); throw error })
    const writer = streamingWriter(options.nodeId)
    const startTime = Date.now()

    try {
        for (let attempt = 0; ; attempt++) {
            const timeoutMs = Math.max(settings.requestTimeoutSeconds || 600, 10) * 1000
            const attemptController = new AbortController()
            const timer = setTimeout(() => attemptController.abort(), timeoutMs)
            const onStop = () => attemptController.abort()
            stop.signal.addEventListener('abort', onStop, { once: true })
            let streamed = false
            try {
                const result = await provider.chat(request, {
                    apiKey,
                    baseUrl: settings.compatibleBaseUrl,
                    signal: attemptController.signal,
                    onText: (delta) => { streamed = true; writer.write(delta) },
                })
                const endTime = Date.now()
                const cost: Decimal | null = costOf(result.usage, result.model, { tier: request.tier })
                controller.increaseInToken(totalInput(result.usage))
                controller.increaseOutToken(result.usage.output)
                controller.increaseAmount(cost)
                return { ...result, cost, startTime, endTime }
            } catch (error) {
                if (stop.signal.aborted) throw new StoppedError()
                if (attemptController.signal.aborted) throw new Error(`The request took longer than ${timeoutMs / 1000} seconds. You can raise the limit in Settings.`)
                const retryable = error instanceof ProviderHttpError && error.retryable && !streamed && attempt < MAX_RETRIES
                if (!retryable) throw error
                const delay = (error as ProviderHttpError).retryAfterMs ?? 1000 * 2 ** attempt
                controller.log({ id: options.nodeId, type: 'warning', title: `${(error as Error).message}. Retrying in ${Math.round(delay / 1000)}s`, nodeType: 'prompt' })
                writer.reset()
                await wait(Math.min(delay, 30_000), stop.signal)
            } finally {
                clearTimeout(timer)
                stop.signal.removeEventListener('abort', onStop)
            }
        }
    } finally {
        writer.reset()
        release()
        stop.dispose()
    }
}

/**
 * One AI request outside a flow run (the flow-building assistant): its own cancel signal, the time
 * limit from Settings and retries for rate limits and server errors before any text has arrived.
 */
export async function chatDirect(request: ChatRequest, options: { signal: AbortSignal, onText?: (delta: string) => void }): Promise<ChatResult & { cost: Decimal | null }> {
    const apiKey = getProviderKey(request.provider)
    assertModelAvailable(request.model)
    const settings = useSettingStore.getState()
    const provider = providers[request.provider]

    for (let attempt = 0; ; attempt++) {
        const timeoutMs = Math.max(settings.requestTimeoutSeconds || 600, 10) * 1000
        const attemptController = new AbortController()
        const timer = setTimeout(() => attemptController.abort(), timeoutMs)
        const onAbort = () => attemptController.abort()
        options.signal.addEventListener('abort', onAbort, { once: true })
        let streamed = false
        try {
            const result = await provider.chat(request, {
                apiKey,
                baseUrl: settings.compatibleBaseUrl,
                signal: attemptController.signal,
                onText: (delta) => { streamed = true; options.onText?.(delta) },
            })
            return { ...result, cost: costOf(result.usage, result.model, { tier: request.tier }) }
        } catch (error) {
            if (options.signal.aborted) throw new StoppedError()
            if (attemptController.signal.aborted) throw new Error(`The request took longer than ${timeoutMs / 1000} seconds. You can raise the limit in Settings.`)
            const retryable = error instanceof ProviderHttpError && error.retryable && !streamed && attempt < MAX_RETRIES
            if (!retryable) throw error
            await wait(Math.min((error as ProviderHttpError).retryAfterMs ?? 1000 * 2 ** attempt, 30_000), options.signal)
        } finally {
            clearTimeout(timer)
            options.signal.removeEventListener('abort', onAbort)
        }
    }
}

/** Providers the user can use right now: those with a key (or a server address), or all in Test API mode. */
export function availableProviders(): ProviderId[] {
    const settings = useSettingStore.getState()
    if (sampleAnswersOn(settings)) return PROVIDERS.map(p => p.id)
    return PROVIDERS.map(p => p.id).filter(id => id == 'compatible' ? !!settings.compatibleBaseUrl : !!settings.apiKeys[id])
}
