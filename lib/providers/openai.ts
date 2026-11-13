import { buildResponsesPayload, parseResponse, ResponseObject, ResponsesPayload } from "../openai";
import { normalizeOpenAiUsage } from "../openai/models";
import { providerFetch, ProviderHttpError } from "./http";
import { readSse } from "./sse";
import { ChatRequest, Provider } from "./types";

const BASE_URL = 'https://api.openai.com/v1'

/** Builds the Responses API body for a chat request, including built-in tools and the processing tier. */
export function buildOpenAiBody(request: ChatRequest): ResponsesPayload & Record<string, unknown> {
    const tools = request.tools || {}
    const payload: ResponsesPayload & Record<string, unknown> = buildResponsesPayload({
        model: request.model,
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        images: request.images,
        responseFormat: request.responseFormat,
        responseSchema: request.responseSchema,
        reasoningEffort: request.reasoningEffort,
        maxOutputTokens: request.maxOutputTokens,
        temperature: request.temperature,
        topP: request.topP,
        webSearch: tools.webSearch,
    })

    const extraTools: Record<string, unknown>[] = []
    if (tools.codeExecution) extraTools.push({ type: 'code_interpreter', container: { type: 'auto' } })
    for (const server of tools.mcpServers || []) {
        if (!server.url) continue
        extraTools.push({
            type: 'mcp',
            server_label: server.label || 'server',
            server_url: server.url,
            // Flows run unattended, so tool calls cannot wait for an approval.
            require_approval: 'never',
            ...(server.token ? { authorization: server.token } : {}),
        })
    }
    if (extraTools.length) payload.tools = [...(payload.tools || []), ...extraTools] as ResponsesPayload['tools']
    if (request.tier == 'flex') payload.service_tier = 'flex'
    return payload
}

export const openAiProvider: Provider = {
    async chat(request, { apiKey, signal, onText }) {
        const body = { ...buildOpenAiBody(request), stream: true }
        const response = await providerFetch(`${BASE_URL}/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal,
        }, 'OpenAI')

        let final: ResponseObject | undefined
        for await (const { data } of readSse(response.body!)) {
            if (data == '[DONE]') break
            const event = JSON.parse(data) as { type: string, delta?: string, response?: ResponseObject, message?: string, error?: { message?: string } }
            if (event.type == 'response.output_text.delta' && event.delta) onText?.(event.delta)
            else if (event.type == 'response.completed' || event.type == 'response.incomplete' || event.type == 'response.failed') final = event.response
            else if (event.type == 'error') throw new ProviderHttpError(`OpenAI: ${event.message || event.error?.message || 'stream error'}`, 500)
        }
        if (!final) throw new ProviderHttpError('OpenAI ended the stream without a response', 502)

        const parsed = parseResponse(final, request.responseFormat || 'text')
        return { ...parsed, usage: normalizeOpenAiUsage(final.usage), model: final.model || request.model }
    }
}
