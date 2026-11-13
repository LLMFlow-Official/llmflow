import type Decimal from "decimal.js-light";
import type { JsonSchemaFormat, Message, ResponseFormat } from "../openai";
import type { NormalizedUsage, ProcessingTier, ProviderId, ReasoningEffort } from "../openai/models";

export type McpServer = { label: string, url: string, token?: string }

/** Built-in tools a prompt can use. Which ones work depends on the provider (see PROVIDER_TOOLS). */
export type ToolOptions = {
    webSearch?: { contextSize?: 'low' | 'medium' | 'high', allowedDomains?: string[] }
    webFetch?: boolean
    codeExecution?: boolean
    mcpServers?: McpServer[]
}

export type ChatRequest = {
    provider: ProviderId
    model: string
    systemPrompt?: string
    messages: Message[]
    /** https URLs or data:image/... URLs, sent with the last user message. */
    images?: string[]
    responseFormat?: ResponseFormat
    responseSchema?: JsonSchemaFormat
    reasoningEffort?: ReasoningEffort
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    tools?: ToolOptions
    tier?: ProcessingTier
}

export type ChatResult = {
    text: string
    /** Set when the output was cut off but some text was produced. */
    warning?: string
    citations?: { url: string, title?: string }[]
    sources?: string[]
    usage: NormalizedUsage
    /** The model that produced the answer (can differ, e.g. after a Claude refusal fallback). */
    model: string
}

export type ChatCallOptions = {
    apiKey: string
    baseUrl?: string
    signal?: AbortSignal
    /** Called with each new piece of text as it streams in. */
    onText?: (delta: string) => void
}

export type Provider = {
    chat: (request: ChatRequest, options: ChatCallOptions) => Promise<ChatResult>
}

export type ChatRun = ChatResult & { cost: Decimal | null, startTime: number, endTime: number }

/** Which built-in tools each provider supports in this app. */
export const PROVIDER_TOOLS: Record<ProviderId, (keyof ToolOptions)[]> = {
    openai: ['webSearch', 'codeExecution', 'mcpServers'],
    anthropic: ['webSearch', 'webFetch', 'codeExecution', 'mcpServers'],
    google: ['webSearch'],
    compatible: [],
}
