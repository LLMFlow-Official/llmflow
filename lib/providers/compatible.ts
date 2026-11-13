import { providerFetch, ProviderHttpError } from "./http";
import { readSse } from "./sse";
import { ChatRequest, Provider } from "./types";

type ChatContent = string | ({ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } })[]

/** Chat Completions body for OpenAI-compatible servers such as Ollama, OpenRouter, Groq or Azure (exported for tests). */
export function buildCompatibleBody(request: ChatRequest) {
    const messages: { role: string, content: ChatContent }[] = []
    if (request.systemPrompt?.trim()) messages.push({ role: 'system', content: request.systemPrompt })
    for (const m of request.messages) if (m.content?.trim()) messages.push({ role: m.role, content: m.content })

    const images = (request.images || []).map(x => x.trim()).filter(Boolean)
    if (images.length) {
        const parts = images.map(url => ({ type: 'image_url' as const, image_url: { url } }))
        const last = messages.at(-1)
        if (last?.role == 'user' && typeof last.content == 'string') last.content = [{ type: 'text', text: last.content }, ...parts]
        else messages.push({ role: 'user', content: parts })
    }
    if (!messages.length) throw new Error("Add a system prompt or at least one user prompt")

    let responseFormat: Record<string, unknown> | undefined
    if (request.responseFormat == 'json_object') responseFormat = { type: 'json_object' }
    if (request.responseFormat == 'json_schema') {
        if (!request.responseSchema?.schema) throw new Error("Output structure is required")
        const { name, schema, strict } = request.responseSchema
        responseFormat = { type: 'json_schema', json_schema: { name: name || 'output', schema, ...(strict !== undefined ? { strict } : {}) } }
    }

    return {
        model: request.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { top_p: request.topP } : {}),
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
    }
}

export const compatibleProvider: Provider = {
    async chat(request, { apiKey, baseUrl, signal, onText }) {
        if (!baseUrl) throw new Error("Set the OpenAI-compatible server address in Settings")
        if (!request.model) throw new Error("Enter the model ID your server uses")
        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
        const response = await providerFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify(buildCompatibleBody(request)),
            signal,
        }, 'the server')

        let text = ''
        let finish: string | undefined
        let usage = { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } }
        let model = request.model
        for await (const { data } of readSse(response.body!)) {
            if (data.trim() == '[DONE]') break
            const chunk = JSON.parse(data)
            if (chunk.error) throw new ProviderHttpError(`Server: ${chunk.error.message || JSON.stringify(chunk.error)}`, 500)
            const choice = chunk.choices?.[0]
            const delta = choice?.delta?.content
            if (delta) {
                text += delta
                onText?.(delta)
            }
            if (choice?.finish_reason) finish = choice.finish_reason
            if (chunk.usage) usage = chunk.usage
            if (chunk.model) model = chunk.model
        }

        let warning: string | undefined
        if (finish == 'length') {
            if (!text || (request.responseFormat && request.responseFormat != 'text')) throw new Error("The output was cut off at the output token limit. Increase Max output tokens.")
            warning = 'Output was cut off at the output token limit. Increase Max output tokens.'
        }
        if (finish == 'content_filter') throw new Error("The server's content filter stopped the answer")
        if (!text) throw new Error("The server returned no text output")

        const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
        return {
            text,
            ...(warning ? { warning } : {}),
            usage: { input: (usage.prompt_tokens ?? 0) - cached, cachedInput: cached, cacheWrite: 0, output: usage.completion_tokens ?? 0 },
            model,
        }
    }
}
