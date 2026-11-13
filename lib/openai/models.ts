import Decimal from "decimal.js-light";

/**
 * Model registry for every provider.
 *
 * Prices are USD per 1M tokens, read on 2026-11-13 from:
 * - OpenAI: https://developers.openai.com/api/docs/pricing
 * - Anthropic: the Claude API reference (models table and prompt-caching economics)
 * - Google: https://aistudio.google.com/docs/pricing
 * Re-check those pages when updating this file.
 */

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'compatible'

export const PROVIDERS: { id: ProviderId, label: string, keyPlaceholder: string }[] = [
    { id: 'openai', label: 'OpenAI', keyPlaceholder: 'sk-…' },
    { id: 'anthropic', label: 'Anthropic (Claude)', keyPlaceholder: 'sk-ant-…' },
    { id: 'google', label: 'Google (Gemini)', keyPlaceholder: 'AIza…' },
    { id: 'compatible', label: 'OpenAI-compatible server', keyPlaceholder: 'Optional' },
]

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ProcessingTier = 'standard' | 'flex' | 'fast'

export type TokenPrices = {
    input: number
    cachedInput: number
    output: number
    /** Price of writing input to the prompt cache (Anthropic: 1.25x input for the 5-minute cache). */
    cacheWrite?: number
}

export type ModelInfo = {
    id: string
    provider: ProviderId
    label: string
    description?: string
    group: string
    prices: TokenPrices
    /** Prices above `longContextThreshold` input tokens. */
    longContextPrices?: TokenPrices
    longContextThreshold?: number
    /** Scheduled price changes, oldest first. Each applies from its date (UTC). */
    priceChanges?: { from: string, prices: TokenPrices }[]
    contextWindow?: number
    maxOutputTokens?: number
    /** Reasoning effort values the model accepts. Undefined: no effort setting. */
    reasoningEfforts?: ReasoningEffort[]
    /** When temperature / top P are accepted. Default: always without efforts, only at "none" with them. */
    sampling?: 'always' | 'effort_none' | 'never'
    /** Extra processing tiers (Standard is always available). */
    tiers?: ProcessingTier[]
    /** Model still works but the provider has announced a shutdown. */
    deprecated?: { shutdownDate: string, replacement: string }
}

export const LONG_CONTEXT_THRESHOLD = 272_000

export const DEFAULT_MODEL_ID = 'gpt-6.1-sol'

export const DEFAULT_MODELS: Record<ProviderId, string> = {
    openai: DEFAULT_MODEL_ID,
    anthropic: 'claude-opus-5-5',
    google: 'gemini-4-hydrogen',
    compatible: '',
}

/** Price multipliers for processing tiers (OpenAI Flex is half price; Claude fast mode is double). */
export const TIER_MULTIPLIER: Record<ProcessingTier, number> = { standard: 1, flex: 0.5, fast: 2 }

const GPT6_EFFORTS_NO_NONE: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const GPT6_EFFORTS: ReasoningEffort[] = ['none', ...GPT6_EFFORTS_NO_NONE]
// Not confirmed per model on OpenAI's pages; "Model default" is always available in the UI.
const GPT5_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh']
const CLAUDE_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const claudePrices = (input: number, cachedInput: number, output: number): TokenPrices =>
    ({ input, cachedInput, output, cacheWrite: input * 1.25 })

export const models: ModelInfo[] = [
    /* ---------------- OpenAI ---------------- */
    {
        id: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra', group: 'GPT-6',
        description: 'Most capable model, for the most demanding work',
        prices: { input: 10, cachedInput: 1, output: 50 },
        longContextPrices: { input: 20, cachedInput: 2, output: 75 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS_NO_NONE, tiers: ['flex'],
    },
    {
        id: 'gpt-6.1-sol', provider: 'openai', label: 'GPT-6.1 Sol', group: 'GPT-6',
        description: 'Near-Astra performance at a lower cost',
        prices: { input: 2, cachedInput: 0.10, output: 10 },
        longContextPrices: { input: 4, cachedInput: 0.20, output: 15 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS_NO_NONE, tiers: ['flex'],
    },
    {
        id: 'gpt-6.1-terra', provider: 'openai', label: 'GPT-6.1 Terra', group: 'GPT-6',
        description: 'Fast and efficient, good at natural writing',
        prices: { input: 1, cachedInput: 0.05, output: 5 },
        longContextPrices: { input: 2, cachedInput: 0.10, output: 7.5 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna', group: 'GPT-6',
        description: 'Most efficient, for focused high-volume tasks',
        prices: { input: 0.10, cachedInput: 0.01, output: 0.50 },
        longContextPrices: { input: 0.20, cachedInput: 0.02, output: 0.75 },
        contextWindow: 1_050_000, maxOutputTokens: 128_000,
        reasoningEfforts: GPT6_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-6-sol', provider: 'openai', label: 'GPT-6 Sol', group: 'GPT-6',
        prices: { input: 2, cachedInput: 0.20, output: 10 },
        longContextPrices: { input: 4, cachedInput: 0.40, output: 15 },
        reasoningEfforts: GPT6_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.6-sol', provider: 'openai', label: 'GPT-5.6 Sol', group: 'GPT-5',
        prices: { input: 4, cachedInput: 0.40, output: 20 },
        longContextPrices: { input: 8, cachedInput: 0.80, output: 30 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.6-terra', provider: 'openai', label: 'GPT-5.6 Terra', group: 'GPT-5',
        prices: { input: 2, cachedInput: 0.20, output: 12 },
        longContextPrices: { input: 4, cachedInput: 0.40, output: 18 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 Luna', group: 'GPT-5',
        prices: { input: 0.20, cachedInput: 0.02, output: 1.20 },
        longContextPrices: { input: 0.40, cachedInput: 0.04, output: 1.80 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.5', provider: 'openai', label: 'GPT-5.5', group: 'GPT-5',
        prices: { input: 5, cachedInput: 0.50, output: 30 },
        longContextPrices: { input: 10, cachedInput: 1, output: 45 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.4', provider: 'openai', label: 'GPT-5.4', group: 'GPT-5',
        prices: { input: 2.5, cachedInput: 0.25, output: 15 },
        longContextPrices: { input: 5, cachedInput: 0.50, output: 22.5 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.4-mini', provider: 'openai', label: 'GPT-5.4 mini', group: 'GPT-5',
        prices: { input: 0.75, cachedInput: 0.075, output: 4.5 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-5.4-nano', provider: 'openai', label: 'GPT-5.4 nano', group: 'GPT-5',
        prices: { input: 0.20, cachedInput: 0.02, output: 1.25 },
        reasoningEfforts: GPT5_EFFORTS, tiers: ['flex'],
    },
    {
        id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', group: 'GPT-4.1',
        description: 'No reasoning; supports temperature and top P',
        prices: { input: 2, cachedInput: 0.50, output: 8 },
    },
    {
        id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini', group: 'GPT-4.1',
        description: 'No reasoning; supports temperature and top P',
        prices: { input: 0.40, cachedInput: 0.10, output: 1.60 },
    },
    {
        id: 'gpt-4o', provider: 'openai', label: 'GPT-4o', group: 'Deprecated',
        prices: { input: 2.5, cachedInput: 1.25, output: 10 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
    {
        id: 'gpt-4o-2024-08-06', provider: 'openai', label: 'gpt-4o-2024-08-06', group: 'Deprecated',
        prices: { input: 2.5, cachedInput: 1.25, output: 10 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
    {
        id: 'gpt-4o-mini', provider: 'openai', label: 'GPT-4o mini', group: 'Deprecated',
        prices: { input: 0.15, cachedInput: 0.075, output: 0.60 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },
    {
        id: 'gpt-4o-mini-2024-07-18', provider: 'openai', label: 'gpt-4o-mini-2024-07-18', group: 'Deprecated',
        prices: { input: 0.15, cachedInput: 0.075, output: 0.60 },
        deprecated: { shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' },
    },

    /* ---------------- Anthropic ---------------- */
    // Thinking is always on for these models; temperature / top P are rejected.
    {
        id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', group: 'Claude',
        description: 'Current Opus: strong reasoning and coding (default effort: medium)',
        prices: claudePrices(4, 0.20, 20),
        contextWindow: 1_000_000, maxOutputTokens: 128_000,
        reasoningEfforts: CLAUDE_EFFORTS, sampling: 'never', tiers: ['fast'],
    },
    {
        id: 'claude-fable-5-2', provider: 'anthropic', label: 'Claude Fable 5.2', group: 'Claude',
        description: "Anthropic's most capable model, for the hardest work",
        prices: claudePrices(8, 0.20, 40),
        contextWindow: 1_000_000, maxOutputTokens: 128_000,
        reasoningEfforts: CLAUDE_EFFORTS, sampling: 'never', tiers: ['fast'],
    },
    {
        id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5', group: 'Claude',
        description: 'Fast and capable for everyday work',
        prices: claudePrices(2, 0.10, 10),
        contextWindow: 1_000_000, maxOutputTokens: 128_000,
        reasoningEfforts: CLAUDE_EFFORTS, sampling: 'never',
    },
    {
        id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5', group: 'Claude',
        description: 'Fastest and cheapest Claude (default effort: medium)',
        prices: claudePrices(0.10, 0.01, 0.50),
        longContextPrices: claudePrices(0.50, 0.05, 2.50),
        longContextThreshold: 100_000,
        contextWindow: 1_000_000, maxOutputTokens: 128_000,
        reasoningEfforts: CLAUDE_EFFORTS, sampling: 'never',
    },

    /* ---------------- Google ---------------- */
    {
        id: 'gemini-4-carbon', provider: 'google', label: 'Gemini 4 Carbon', group: 'Gemini',
        description: 'Strongest Gemini reasoning model',
        prices: { input: 2, cachedInput: 0.10, output: 10 },
        priceChanges: [{ from: '2026-12-01', prices: { input: 4, cachedInput: 0.20, output: 20 } }],
        contextWindow: 1_000_000, maxOutputTokens: 65_000,
    },
    {
        id: 'gemini-4-argon', provider: 'google', label: 'Gemini 4 Argon', group: 'Gemini',
        description: 'Efficient frontier reasoning',
        prices: { input: 2, cachedInput: 0.10, output: 10 },
        priceChanges: [{ from: '2026-12-01', prices: { input: 4, cachedInput: 0.20, output: 20 } }],
        contextWindow: 1_000_000, maxOutputTokens: 65_000,
    },
    {
        id: 'gemini-4-hydrogen', provider: 'google', label: 'Gemini 4 Hydrogen', group: 'Gemini',
        description: 'Fast, for everyday work',
        prices: { input: 1.5, cachedInput: 0.075, output: 7.5 },
        contextWindow: 1_000_000, maxOutputTokens: 65_000,
    },
    {
        id: 'gemini-3.8-flash', provider: 'google', label: 'Gemini 3.8 Flash', group: 'Gemini',
        prices: { input: 0.75, cachedInput: 0.075, output: 3.75 },
        priceChanges: [{ from: '2027-01-01', prices: { input: 1.5, cachedInput: 0.15, output: 7.5 } }],
    },
    {
        id: 'gemini-3.5-flash-lite', provider: 'google', label: 'Gemini 3.5 Flash-Lite', group: 'Gemini',
        description: 'Cheapest Gemini',
        prices: { input: 0.30, cachedInput: 0.03, output: 2.5 },
    },
    {
        id: 'gemini-3.1-pro-preview', provider: 'google', label: 'Gemini 3.1 Pro (preview)', group: 'Gemini',
        prices: { input: 2, cachedInput: 0.20, output: 12 },
        longContextPrices: { input: 4, cachedInput: 0.40, output: 18 },
        longContextThreshold: 200_000,
    },
]

/**
 * Models that are already shut down, with the shutdown date and the provider's suggested replacement.
 * OpenAI: https://developers.openai.com/api/docs/deprecations (read 2026-11-13).
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

export function modelsFor(provider: ProviderId): ModelInfo[] {
    return models.filter(x => x.provider == provider)
}

/**
 * Follows the replacement chain (e.g. gpt-3.5-turbo-0613 -> gpt-3.5-turbo -> gpt-5.6-terra,
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

/** Token counts in one shape for every provider. `input` excludes cached and cache-write tokens. */
export type NormalizedUsage = {
    input: number
    cachedInput: number
    cacheWrite: number
    /** Includes reasoning tokens. */
    output: number
    reasoning?: number
}

export const totalInput = (u: NormalizedUsage) => u.input + u.cachedInput + u.cacheWrite

/** OpenAI Responses API usage. */
export type Usage = {
    input_tokens: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens: number
    output_tokens_details?: { reasoning_tokens?: number }
    total_tokens: number
}

export function normalizeOpenAiUsage(usage: Usage): NormalizedUsage {
    const cached = Math.min(usage.input_tokens_details?.cached_tokens ?? 0, usage.input_tokens)
    return {
        input: usage.input_tokens - cached,
        cachedInput: cached,
        cacheWrite: 0,
        output: usage.output_tokens,
        reasoning: usage.output_tokens_details?.reasoning_tokens,
    }
}

/** The prices that applied on a date, including scheduled changes. */
export function pricesAt(model: ModelInfo, at: Date = new Date()): TokenPrices {
    let prices = model.prices
    for (const change of model.priceChanges || []) {
        if (new Date(`${change.from}T00:00:00Z`) <= at) prices = change.prices
    }
    return prices
}

/**
 * Cost in USD of one request, or null when the model's prices are not known. Uses long-context prices
 * when the prompt is over the model's threshold, and the tier multiplier (Flex 0.5x, fast 2x).
 */
export function costOf(usage: NormalizedUsage, modelId: string, options: { tier?: ProcessingTier, at?: Date } = {}): Decimal | null {
    const model = findModel(modelId)
    if (!model) return null

    const threshold = model.longContextThreshold ?? LONG_CONTEXT_THRESHOLD
    const prices = totalInput(usage) > threshold && model.longContextPrices
        ? model.longContextPrices
        : pricesAt(model, options.at)

    return new Decimal(usage.input).mul(prices.input)
        .add(new Decimal(usage.cachedInput).mul(prices.cachedInput))
        .add(new Decimal(usage.cacheWrite).mul(prices.cacheWrite ?? prices.input))
        .add(new Decimal(usage.output).mul(prices.output))
        .mul(TIER_MULTIPLIER[options.tier || 'standard'])
        .div(1_000_000)
}

/** Cost of an OpenAI Responses API request. */
export function usageToCost(usage: Usage, modelId: string): Decimal | null {
    return costOf(normalizeOpenAiUsage(usage), modelId)
}

/** Whether temperature/top P can be sent for this model and effort. */
export function supportsSampling(modelId: string, effort?: ReasoningEffort): boolean {
    const model = findModel(modelId)
    if (!model) return true // custom model: the user decides
    const rule = model.sampling ?? (model.reasoningEfforts ? 'effort_none' : 'always')
    if (rule == 'always') return true
    if (rule == 'never') return false
    return effort === 'none'
}
