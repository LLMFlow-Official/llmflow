import Decimal from "decimal.js-light";

/**
 * OpenAI model registry.
 *
 * Prices are USD per 1M tokens, copied from https://developers.openai.com/api/docs/pricing
 * on 2026-11-13. Re-check that page when updating this file.
 */

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type TokenPrices = {
    input: number
    cachedInput: number
    output: number
}

export type ModelInfo = {
    id: string
    label: string
    description?: string
    group: 'GPT-6' | 'GPT-5' | 'GPT-4.1' | 'Deprecated'
    prices: TokenPrices
    /** Prices that apply when a request has more than LONG_CONTEXT_THRESHOLD input tokens. */
    longContextPrices?: TokenPrices
    contextWindow?: number
    maxOutputTokens?: number
    /**
     * Reasoning effort values the model accepts. Undefined means the model does not reason
     * and the `reasoning` parameter must not be sent.
     */
    reasoningEfforts?: ReasoningEffort[]
    /** Model still works but OpenAI has announced a shutdown. */
    deprecated?: { shutdownDate: string, replacement: string }
}

export const LONG_CONTEXT_THRESHOLD = 272_000

export const DEFAULT_MODEL_ID = 'gpt-6.1-sol'

const GPT6_EFFORTS_NO_NONE: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const GPT6_EFFORTS: ReasoningEffort[] = ['none', ...GPT6_EFFORTS_NO_NONE]
// Not confirmed per model on OpenAI's pages; "Model default" is always available in the UI.
const GPT5_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh']

export const models: ModelInfo[] = [
    {
        id: 'gpt-6-astra', label: 'GPT-6 Astra', group: 'GPT-6',
        description: 'Most capable model, for the most demanding work',
        prices: { input: 10, cachedInput: 1, output: 50 },
        longContextPrices: { input: 20, cachedInput: 2, output: 75 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS_NO_NONE,
    },
    {
        id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', group: 'GPT-6',
        description: 'Near-Astra performance at a lower cost',
        prices: { input: 2, cachedInput: 0.10, output: 10 },
        longContextPrices: { input: 4, cachedInput: 0.20, output: 15 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS_NO_NONE,
    },
    {
        id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', group: 'GPT-6',
        description: 'Fast and efficient, good at natural writing',
        prices: { input: 1, cachedInput: 0.05, output: 5 },
        longContextPrices: { input: 2, cachedInput: 0.10, output: 7.5 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS,
    },
    {
        id: 'gpt-6-luna', label: 'GPT-6 Luna', group: 'GPT-6',
        description: 'Most efficient, for focused high-volume tasks',
        prices: { input: 0.10, cachedInput: 0.01, output: 0.50 },
        longContextPrices: { input: 0.20, cachedInput: 0.02, output: 0.75 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS,
    },
    {
        id: 'gpt-6-sol', label: 'GPT-6 Sol', group: 'GPT-6',
        prices: { input: 2, cachedInput: 0.20, output: 10 },
        longContextPrices: { input: 4, cachedInput: 0.40, output: 15 },
        reasoningEfforts: GPT6_EFFORTS,
    },
    {
        id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', group: 'GPT-5',
        prices: { input: 4, cachedInput: 0.40, output: 20 },
        longContextPrices: { input: 8, cachedInput: 0.80, output: 30 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', group: 'GPT-5',
        prices: { input: 2, cachedInput: 0.20, output: 12 },
        longContextPrices: { input: 4, cachedInput: 0.40, output: 18 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', group: 'GPT-5',
        prices: { input: 0.20, cachedInput: 0.02, output: 1.20 },
        longContextPrices: { input: 0.40, cachedInput: 0.04, output: 1.80 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-5.5', label: 'GPT-5.5', group: 'GPT-5',
        prices: { input: 5, cachedInput: 0.50, output: 30 },
        longContextPrices: { input: 10, cachedInput: 1, output: 45 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-5.4', label: 'GPT-5.4', group: 'GPT-5',
        prices: { input: 2.5, cachedInput: 0.25, output: 15 },
        longContextPrices: { input: 5, cachedInput: 0.50, output: 22.5 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', group: 'GPT-5',
        prices: { input: 0.75, cachedInput: 0.075, output: 4.5 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', group: 'GPT-5',
        prices: { input: 0.20, cachedInput: 0.02, output: 1.25 },
        reasoningEfforts: GPT5_EFFORTS,
    },
    {
        id: 'gpt-4.1', label: 'GPT-4.1', group: 'GPT-4.1',
        description: 'No reasoning; supports temperature and top P',
        prices: { input: 2, cachedInput: 0.50, output: 8 },
    },
    {
        id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', group: 'GPT-4.1',
        description: 'No reasoning; supports temperature and top P',
        prices: { input: 0.40, cachedInput: 0.10, output: 1.60 },
    },
    {
        id: 'gpt-4o', label: 'GPT-4o', group: 'Deprecated',
        prices: { input: 2.5, cachedInput: 1.25, output: 10 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
    {
        id: 'gpt-4o-2024-08-06', label: 'gpt-4o-2024-08-06', group: 'Deprecated',
        prices: { input: 2.5, cachedInput: 1.25, output: 10 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
    {
        id: 'gpt-4o-mini', label: 'GPT-4o mini', group: 'Deprecated',
        prices: { input: 0.15, cachedInput: 0.075, output: 0.60 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
    {
        id: 'gpt-4o-mini-2024-07-18', label: 'gpt-4o-mini-2024-07-18', group: 'Deprecated',
        prices: { input: 0.15, cachedInput: 0.075, output: 0.60 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
]

/**
 * Models OpenAI has already shut down, with the shutdown date and OpenAI's suggested replacement,
 * from https://developers.openai.com/api/docs/deprecations (read 2026-11-13).
 * Flows saved with these models fail at OpenAI, so the app explains it before sending.
 */
export const retiredModels: Record<string, { shutdownDate: string, replacement: string }> = {
    'chatgpt-4o-latest': { shutdownDate: '2026-02-17', replacement: 'gpt-5.1-chat-latest' },
    'gpt-4-turbo': { shutdownDate: '2026-10-23', replacement: 'gpt-5.6-sol' },
    'gpt-4-turbo-2024-04-09': { shutdownDate: '2026-10-23', replacement: 'gpt-5.6-sol' },
    'gpt-4': { shutdownDate: '2026-10-23', replacement: 'gpt-5.6-sol' },
    'gpt-4-32k': { shutdownDate: '2025-06-06', replacement: 'gpt-4o' },
    'gpt-4-0125-preview': { shutdownDate: '2026-03-26', replacement: 'gpt-5' },
    'gpt-4-1106-preview': { shutdownDate: '2026-10-23', replacement: 'gpt-5.6-sol' },
    'gpt-4-vision-preview': { shutdownDate: '2024-12-06', replacement: 'gpt-4o' },
    'gpt-3.5-turbo': { shutdownDate: '2026-10-23', replacement: 'gpt-5.6-terra' },
    'gpt-3.5-turbo-0125': { shutdownDate: '2026-10-23', replacement: 'gpt-5.6-terra' },
    'gpt-3.5-turbo-1106': { shutdownDate: '2026-09-28', replacement: 'gpt-5.6-terra' },
    'gpt-3.5-turbo-0613': { shutdownDate: '2024-09-13', replacement: 'gpt-3.5-turbo' },
    'gpt-3.5-turbo-16k-0613': { shutdownDate: '2024-09-13', replacement: 'gpt-3.5-turbo' },
    'gpt-3.5-turbo-0301': { shutdownDate: '2024-09-13', replacement: 'gpt-3.5-turbo' },
    'gpt-3.5-turbo-instruct': { shutdownDate: '2026-09-28', replacement: 'gpt-5.6-terra' },
    'davinci-002': { shutdownDate: '2026-09-28', replacement: 'gpt-5.6-terra' },
    'babbage-002': { shutdownDate: '2026-09-28', replacement: 'gpt-5.6-terra' },
}

export function findModel(id?: string): ModelInfo | undefined {
    if (!id) return undefined
    return models.find(x => x.id === id)
}

/**
 * Follows OpenAI's replacement chain (e.g. gpt-3.5-turbo-0613 -> gpt-3.5-turbo -> gpt-5.6-terra,
 * gpt-4-32k -> gpt-4o -> gpt-6-luna) until it reaches a model that is in the registry and not deprecated.
 * Returns the last suggestion if the chain leaves the registry.
 */
export function resolveReplacement(id: string): string | undefined {
    let current = id
    for (let i = 0; i < 10; i++) {
        const next = retiredModels[current]?.replacement ?? findModel(current)?.deprecated?.replacement
        if (!next) return current === id ? undefined : current
        current = next
        const model = findModel(current)
        if (model && !model.deprecated) return current
    }
    return current
}

export type ModelStatus =
    | { kind: 'ok' }
    | { kind: 'unknown' }
    | { kind: 'deprecated', shutdownDate: string, replacement?: string }
    | { kind: 'retired', shutdownDate: string, replacement?: string }

export function getModelStatus(id: string, today: Date = new Date()): ModelStatus {
    const retired = retiredModels[id]
    if (retired) return { kind: 'retired', shutdownDate: retired.shutdownDate, replacement: resolveReplacement(id) }

    const model = findModel(id)
    if (!model) return { kind: 'unknown' }
    if (model.deprecated) {
        const kind = new Date(model.deprecated.shutdownDate) <= today ? 'retired' : 'deprecated'
        return { kind, shutdownDate: model.deprecated.shutdownDate, replacement: resolveReplacement(id) }
    }
    return { kind: 'ok' }
}

export type Usage = {
    input_tokens: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens: number
    output_tokens_details?: { reasoning_tokens?: number }
    total_tokens: number
}

/**
 * Cost in USD for one request. Cached input tokens are billed at the cached rate, the rest of
 * the input at the input rate, and output (which includes reasoning tokens) at the output rate.
 * Requests above LONG_CONTEXT_THRESHOLD input tokens use the long-context rates when the model has them.
 * Returns null when the model's prices are not known.
 */
export function usageToCost(usage: Usage, modelId: string): Decimal | null {
    const model = findModel(modelId)
    if (!model) return null

    const prices = usage.input_tokens > LONG_CONTEXT_THRESHOLD && model.longContextPrices
        ? model.longContextPrices
        : model.prices

    const cached = Math.min(usage.input_tokens_details?.cached_tokens ?? 0, usage.input_tokens)
    const uncached = usage.input_tokens - cached

    return new Decimal(uncached).mul(prices.input)
        .add(new Decimal(cached).mul(prices.cachedInput))
        .add(new Decimal(usage.output_tokens).mul(prices.output))
        .div(1_000_000)
}

/** Whether temperature/top_p can be sent. Reasoning models only accept them when effort is "none". */
export function supportsSampling(modelId: string, effort?: ReasoningEffort): boolean {
    const model = findModel(modelId)
    if (!model) return true // custom model: the user decides
    if (!model.reasoningEfforts) return true
    return effort === 'none'
}
