import axios, { AxiosError, AxiosResponse } from "axios";
import Decimal from "decimal.js-light";
import { ReasoningEffort, supportsSampling, Usage } from "./models";

export * from "./models";

export type Message = {
    role: 'system' | 'user' | 'assistant',
    content?: string
}

export type ResponseFormat = 'text' | 'json_object' | 'json_schema'

export type JsonSchemaFormat = {
    name: string
    description?: string
    strict?: boolean
    schema: object
}

export type InputContentPart =
    | { type: 'input_text', text: string }
    | { type: 'input_image', image_url: string, detail: 'auto' | 'low' | 'high' }

export type WebSearchTool = {
    type: 'web_search'
    search_context_size?: 'low' | 'medium' | 'high'
    filters?: { allowed_domains: string[] }
}

/** Request body for POST /v1/responses (only the fields this app uses). */
export type ResponsesPayload = {
    model: string
    input: { role: 'developer' | 'user' | 'assistant', content: string | InputContentPart[] }[]
    store: false
    tools?: (WebSearchTool | Record<string, unknown>)[]
    include?: string[]
    text?: { format: { type: 'json_object' } | ({ type: 'json_schema' } & JsonSchemaFormat) }
    reasoning?: { effort: ReasoningEffort }
    max_output_tokens?: number
    temperature?: number
    top_p?: number
}

export type UrlCitation = { type: 'url_citation', url: string, title?: string, start_index?: number, end_index?: number }

type OutputContentPart =
    | { type: 'output_text', text: string, annotations?: (UrlCitation | { type: string })[] }
    | { type: 'refusal', refusal: string }
    | { type: string, [key: string]: unknown }

type OutputItem =
    | { type: 'message', role: 'assistant', phase?: 'commentary' | 'final_answer' | null, content: OutputContentPart[] }
    | { type: string, [key: string]: unknown }

/** Response object from POST /v1/responses (only the fields this app reads). */
export type ResponseObject = {
    id: string
    object: 'response'
    model: string
    status: 'completed' | 'incomplete' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | string
    error?: { code?: string, message: string } | null
    incomplete_details?: { reason?: string } | null
    output: OutputItem[]
    usage: Usage
}

export type BuildPayloadOptions = {
    model: string
    systemPrompt?: string
    messages: Message[]
    responseFormat?: ResponseFormat
    responseSchema?: JsonSchemaFormat
    reasoningEffort?: ReasoningEffort
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    /** Image inputs: https URLs or data:image/... URLs. Attached to the last user message. */
    images?: string[]
    webSearch?: {
        contextSize?: 'low' | 'medium' | 'high'
        allowedDomains?: string[]
    }
}

const imageUrlPattern = /^(https?:\/\/\S+|data:image\/[\w.+-]+;base64,)/

/**
 * Builds a Responses API request. The system prompt is sent as a `developer` message so that a
 * node with only a system prompt still has non-empty `input`. Temperature and top P are sent only
 * when the user set them and the model accepts them.
 */
export function buildResponsesPayload(o: BuildPayloadOptions): ResponsesPayload {
    const input: ResponsesPayload['input'] = []
    if (o.systemPrompt?.trim()) input.push({ role: 'developer', content: o.systemPrompt })
    for (const m of o.messages) {
        if (!m.content?.trim()) continue
        input.push({ role: m.role === 'system' ? 'developer' : m.role, content: m.content })
    }
    const images = (o.images || []).map(x => x.trim()).filter(Boolean)
    for (const image of images) {
        if (!imageUrlPattern.test(image)) {
            throw new Error(`Image input must be an http(s) URL or an image data URL, got: ${image.length > 60 ? `${image.slice(0, 60)}…` : image}`)
        }
    }
    if (images.length) {
        const imageParts: InputContentPart[] = images.map(image_url => ({ type: 'input_image', image_url, detail: 'auto' }))
        const last = input.at(-1)
        if (last?.role === 'user' && typeof last.content === 'string') {
            last.content = [{ type: 'input_text', text: last.content }, ...imageParts]
        } else {
            input.push({ role: 'user', content: imageParts })
        }
    }

    if (input.length === 0) throw new Error("Add a system prompt or at least one user prompt")

    const payload: ResponsesPayload = { model: o.model, input, store: false }

    if (o.webSearch) {
        const domains = (o.webSearch.allowedDomains || []).map(x => x.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)
        payload.tools = [{
            type: 'web_search',
            ...(o.webSearch.contextSize ? { search_context_size: o.webSearch.contextSize } : {}),
            ...(domains.length ? { filters: { allowed_domains: domains } } : {}),
        }]
        payload.include = ['web_search_call.action.sources']
    }

    if (o.responseFormat === 'json_object') {
        payload.text = { format: { type: 'json_object' } }
    } else if (o.responseFormat === 'json_schema') {
        if (!o.responseSchema?.name || !o.responseSchema.schema) throw new Error("Output structure is required")
        const { name, description, strict, schema } = o.responseSchema
        payload.text = {
            format: {
                type: 'json_schema',
                name,
                schema,
                ...(strict !== undefined ? { strict } : {}),
                ...(description ? { description } : {}),
            }
        }
    }

    if (o.reasoningEffort) payload.reasoning = { effort: o.reasoningEffort }
    if (o.maxOutputTokens) payload.max_output_tokens = o.maxOutputTokens

    if (supportsSampling(o.model, o.reasoningEffort)) {
        if (o.temperature !== undefined) payload.temperature = o.temperature
        if (o.topP !== undefined) payload.top_p = o.topP
    }

    return payload
}

export type ParsedResponse = {
    text: string
    /** Set when the response hit max_output_tokens but still produced some text. */
    warning?: string
    /** Web pages cited in the answer (web search), de-duplicated by URL. */
    citations?: { url: string, title?: string }[]
    /** Every URL the web search looked at, when the API returns them. */
    sources?: string[]
}

function collectCitations(parts: OutputContentPart[]) {
    const seen = new Map<string, { url: string, title?: string }>()
    for (const part of parts) {
        if (part.type !== 'output_text') continue
        for (const a of ((part as { annotations?: { type: string }[] }).annotations || [])) {
            if (a.type !== 'url_citation') continue
            const c = a as UrlCitation
            if (c.url && !seen.has(c.url)) seen.set(c.url, { url: c.url, title: c.title })
        }
    }
    return Array.from(seen.values())
}

function collectSources(output: OutputItem[]) {
    const urls = new Set<string>()
    for (const item of output) {
        if (item.type !== 'web_search_call') continue
        const sources = (item as { action?: { sources?: { url?: string }[] } }).action?.sources || []
        for (const s of sources) if (s?.url) urls.add(s.url)
    }
    return Array.from(urls)
}

/**
 * Extracts the assistant text from a Responses API result and turns refusals, failures and
 * truncated or empty output into errors with a readable message.
 */
export function parseResponse(response: ResponseObject, responseFormat: ResponseFormat = 'text'): ParsedResponse {
    if (response.status === 'failed') {
        throw new Error(response.error?.message || "The model request failed")
    }

    const messages = response.output.filter(x => x.type === 'message') as Extract<OutputItem, { type: 'message' }>[]
    const finalMessages = messages.filter(x => x.phase === 'final_answer')
    const message = (finalMessages.length ? finalMessages : messages).at(-1)
    const parts = message?.content ?? []

    const refusal = parts.find(x => x.type === 'refusal') as { refusal: string } | undefined
    if (refusal) throw new Error(`The model refused: ${refusal.refusal}`)

    const text = parts
        .filter(x => x.type === 'output_text')
        .map(x => (x as { text: string }).text)
        .join('')

    if (response.status === 'incomplete') {
        const reason = response.incomplete_details?.reason
        if (reason === 'max_output_tokens') {
            const reasoningTokens = response.usage?.output_tokens_details?.reasoning_tokens
            const hint = "Increase Max output tokens or lower the reasoning effort."
            if (!text) {
                throw new Error(`The model ran out of output tokens before writing an answer${reasoningTokens ? ` (${reasoningTokens} tokens went to reasoning)` : ''}. ${hint}`)
            }
            if (responseFormat !== 'text') {
                throw new Error(`The JSON output was cut off at the output token limit. ${hint}`)
            }
            return { text, warning: `Output was cut off at the output token limit. ${hint}` }
        }
        throw new Error(`The response is incomplete${reason ? ` (${reason})` : ''}`)
    }

    if (!text) throw new Error("The model returned no text output")

    const citations = collectCitations(parts)
    const sources = collectSources(response.output)
    return {
        text,
        ...(citations.length ? { citations } : {}),
        ...(sources.length ? { sources } : {}),
    }
}

/** Parses JSON output, with an error that says which node format was expected. */
export function parseJsonOutput(text: string): Record<string, unknown> {
    try {
        return JSON.parse(text)
    } catch {
        throw new Error(`The model output is not valid JSON: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`)
    }
}

export type ResponsesClient = {
    create: (payload: ResponsesPayload) => Promise<AxiosResponse<ResponseObject>>
}

/* ---------------- Image generation (POST /v1/images/generations) ---------------- */

export type ImageModelInfo = {
    id: string
    label: string
    description?: string
    /** USD per 1M tokens. Undefined when OpenAI's page gives no per-token price for the model. */
    prices?: { textInput: number, imageInput: number, imageOutput: number }
}

// From https://developers.openai.com/api/docs/guides/image-generation (read 2026-11-13).
export const imageModels: ImageModelInfo[] = [
    {
        id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', description: 'Fast, everyday generation',
        prices: { textInput: 5, imageInput: 8, imageOutput: 30 },
    },
    {
        id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', description: 'Best when precise detail matters',
        prices: { textInput: 5, imageInput: 8, imageOutput: 30 },
    },
    { id: 'gpt-image-2', label: 'GPT Image 2', description: 'Previous generation' },
]

export const DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2.5-flare'

export type ImagePayload = {
    model: string
    prompt: string
    n: 1
    size?: string
    quality?: 'low' | 'medium' | 'high' | 'auto'
    output_format?: 'png' | 'jpeg' | 'webp'
    background?: 'transparent' | 'opaque' | 'auto'
}

export type ImageUsage = {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    input_tokens_details?: { text_tokens?: number, image_tokens?: number }
}

export type ImageResponse = {
    created: number
    data: { b64_json?: string, url?: string, revised_prompt?: string }[]
    usage?: ImageUsage
}

/** Cost of one image request, or null when the model's token prices or the usage are not known. */
export function imageUsageToCost(usage: ImageUsage | undefined, modelId: string): Decimal | null {
    const prices = imageModels.find(x => x.id === modelId)?.prices
    if (!prices || !usage || usage.input_tokens === undefined || usage.output_tokens === undefined) return null
    const imageIn = usage.input_tokens_details?.image_tokens ?? 0
    const textIn = usage.input_tokens_details?.text_tokens ?? usage.input_tokens - imageIn
    return new Decimal(textIn).mul(prices.textInput)
        .add(new Decimal(imageIn).mul(prices.imageInput))
        .add(new Decimal(usage.output_tokens).mul(prices.imageOutput))
        .div(1_000_000)
}

/** Turns the first image of an image response into a data URL (or returns its hosted URL). */
export function imageResponseToUrl(response: ImageResponse, format: string = 'png'): string {
    const first = response.data?.[0]
    if (first?.b64_json) return `data:image/${format};base64,${first.b64_json}`
    if (first?.url) return first.url
    throw new Error("The image API returned no image")
}

export function OpenAiFaker(output?: string): ResponsesClient {
    return {
        create: (payload) => new Promise<AxiosResponse<ResponseObject>>((resolve) => {
            setTimeout(() => {
                resolve({
                    data: {
                        id: 'fake-id',
                        object: 'response',
                        model: payload.model,
                        status: 'completed',
                        output: [{
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: output || '' }]
                        }],
                        usage: {
                            input_tokens: 10,
                            input_tokens_details: { cached_tokens: 0 },
                            output_tokens: 10,
                            output_tokens_details: { reasoning_tokens: 5 },
                            total_tokens: 20
                        }
                    },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: {},
                    request: {}
                } as AxiosResponse<ResponseObject>)
            }, 1000);
        })
    }
}

function createAxios(token: string) {
    return axios.create({
        baseURL: 'https://api.openai.com/v1',
        headers: {
            "Content-Type": 'application/json',
            "Authorization": `Bearer ${token}`
        }
    })
}

export function OpenAi(token: string): ResponsesClient & {
    generateImage: (payload: ImagePayload, signal?: AbortSignal) => Promise<AxiosResponse<ImageResponse>>
} {
    const client = createAxios(token)
    return {
        create: (payload) => client.post<ResponseObject, AxiosResponse<ResponseObject>>('/responses', payload),
        generateImage: (payload, signal) => client.post<ImageResponse, AxiosResponse<ImageResponse>>('/images/generations', payload, { signal })
    }
}

/** Text-generation model IDs available to this key, from GET /v1/models. */
export async function listAccountModels(token: string): Promise<string[]> {
    const response = await createAxios(token).get<{ data: { id: string }[] }>('/models')
    return response.data.data
        .map(x => x.id)
        .filter(id => /^(gpt-|o\d|chatgpt-|chat-latest)/.test(id))
        .filter(id => !/(audio|realtime|transcribe|tts|image|embedding|search|moderation)/.test(id))
        .sort()
}

/** Turns an axios error from OpenAI into an Error carrying OpenAI's message. */
export function toOpenAiError(error: unknown): Error {
    if (error instanceof AxiosError && error.response?.data?.error?.message) {
        return new Error(error.response.data.error.message)
    }
    return error instanceof Error ? error : new Error(String(error))
}
