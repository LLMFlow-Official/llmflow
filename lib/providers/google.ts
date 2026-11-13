import { extractJson } from "../text_utils";
import { providerFetch, ProviderHttpError } from "./http";
import { readSse } from "./sse";
import { ChatRequest, ChatResult, Provider } from "./types";

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

type Part = { text?: string, thought?: boolean, inlineData?: { mimeType: string, data: string } }

type GeminiChunk = {
    candidates?: {
        content?: { parts?: Part[] }
        finishReason?: string
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string, title?: string } }[] }
    }[]
    promptFeedback?: { blockReason?: string }
    usageMetadata?: {
        promptTokenCount?: number
        cachedContentTokenCount?: number
        candidatesTokenCount?: number
        thoughtsTokenCount?: number
    }
    modelVersion?: string
    error?: { message?: string }
}

const BLOCKED = ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']

/** Gemini needs image bytes inline, so https images are downloaded in the browser first. */
async function toInlineImage(url: string, signal?: AbortSignal): Promise<Part> {
    const data = /^data:(image\/[\w.+-]+);base64,([\s\S]*)$/.exec(url)
    if (data) return { inlineData: { mimeType: data[1], data: data[2] } }
    let response: Response
    try {
        response = await fetch(url, { signal })
    } catch {
        throw new Error(`Could not download the image ${url} for Gemini (the site may block browser downloads). Use an image from an Image Generation node or a data URL instead.`)
    }
    if (!response.ok) throw new Error(`Could not download the image ${url} (${response.status})`)
    const blob = await response.blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)))
    return { inlineData: { mimeType: blob.type || 'image/png', data: btoa(binary) } }
}

/** Builds the generateContent body (exported for tests). Images must already be inline parts. */
export function buildGeminiBody(request: ChatRequest, imageParts: Part[] = []) {
    const contents = request.messages
        .filter(m => m.content?.trim())
        .map(m => ({ role: m.role == 'assistant' ? 'model' : 'user', parts: [{ text: m.content! }] as Part[] }))
    if (imageParts.length) {
        const last = contents.at(-1)
        if (last?.role == 'user') last.parts.push(...imageParts)
        else contents.push({ role: 'user', parts: imageParts })
    }
    let system = request.systemPrompt?.trim() || undefined
    if (!contents.length) {
        if (!system) throw new Error("Add a system prompt or at least one user prompt")
        contents.push({ role: 'user', parts: [{ text: system }] })
        system = undefined
    }

    const generationConfig: Record<string, unknown> = {}
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature
    if (request.topP !== undefined) generationConfig.topP = request.topP
    if (request.maxOutputTokens) generationConfig.maxOutputTokens = request.maxOutputTokens
    if (request.responseFormat == 'json_object' || request.responseFormat == 'json_schema') generationConfig.responseMimeType = 'application/json'
    if (request.responseFormat == 'json_schema') {
        if (!request.responseSchema?.schema) throw new Error("Output structure is required")
        generationConfig.responseJsonSchema = request.responseSchema.schema
    }

    return {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
        ...(request.tools?.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    }
}

/** Combines streamed chunks into a result (exported for tests). */
export function parseGeminiChunks(chunks: GeminiChunk[], request: ChatRequest): ChatResult {
    let text = ''
    let finishReason: string | undefined
    let usage: GeminiChunk['usageMetadata'] = {}
    let model = request.model
    const citations = new Map<string, { url: string, title?: string }>()

    for (const chunk of chunks) {
        if (chunk.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${chunk.promptFeedback.blockReason})`)
        const candidate = chunk.candidates?.[0]
        for (const part of candidate?.content?.parts || []) if (part.text && !part.thought) text += part.text
        if (candidate?.finishReason) finishReason = candidate.finishReason
        for (const g of candidate?.groundingMetadata?.groundingChunks || []) {
            if (g.web?.uri && !citations.has(g.web.uri)) citations.set(g.web.uri, { url: g.web.uri, title: g.web.title })
        }
        if (chunk.usageMetadata) usage = chunk.usageMetadata
        if (chunk.modelVersion) model = chunk.modelVersion
    }

    if (finishReason && BLOCKED.includes(finishReason)) throw new Error(`Gemini stopped the answer (${finishReason})`)
    let warning: string | undefined
    if (finishReason == 'MAX_TOKENS') {
        const hint = 'Increase Max output tokens.'
        if (!text) throw new Error(`Gemini ran out of output tokens before writing an answer (thinking also uses them). ${hint}`)
        if (request.responseFormat && request.responseFormat != 'text') throw new Error(`The JSON output was cut off at the output token limit. ${hint}`)
        warning = `Output was cut off at the output token limit. ${hint}`
    }
    if (!text) throw new Error("Gemini returned no text output")
    if (request.responseFormat == 'json_object') text = JSON.stringify(extractJson(text))

    const cached = usage?.cachedContentTokenCount ?? 0
    const reasoning = usage?.thoughtsTokenCount ?? 0
    return {
        text,
        ...(warning ? { warning } : {}),
        ...(citations.size ? { citations: Array.from(citations.values()) } : {}),
        usage: {
            input: Math.max((usage?.promptTokenCount ?? 0) - cached, 0),
            cachedInput: cached,
            cacheWrite: 0,
            // Thinking tokens are billed as output.
            output: (usage?.candidatesTokenCount ?? 0) + reasoning,
            ...(reasoning ? { reasoning } : {}),
        },
        // Report the requested id so the price list matches; modelVersion can carry a dated suffix.
        model: model.startsWith(request.model) ? request.model : model,
    }
}

export const googleProvider: Provider = {
    async chat(request, { apiKey, signal, onText }) {
        const images = await Promise.all((request.images || []).map(x => x.trim()).filter(Boolean).map(x => toInlineImage(x, signal)))
        const body = buildGeminiBody(request, images)
        const response = await providerFetch(`${BASE_URL}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal,
        }, 'Google')

        const chunks: GeminiChunk[] = []
        for await (const { data } of readSse(response.body!)) {
            const chunk = JSON.parse(data) as GeminiChunk
            if (chunk.error) throw new ProviderHttpError(`Google: ${chunk.error.message}`, 500)
            chunks.push(chunk)
            for (const part of chunk.candidates?.[0]?.content?.parts || []) if (part.text && !part.thought) onText?.(part.text)
        }
        return parseGeminiChunks(chunks, request)
    }
}
