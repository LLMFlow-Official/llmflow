import Anthropic from "@anthropic-ai/sdk";
import { extractJson } from "../text_utils";
import { ProviderHttpError } from "./http";
import { ChatRequest, ChatResult, Provider } from "./types";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam

/** Models with Anthropic's server-side refusal fallback (on by default: a declined request is retried on a fallback model). */
const FALLBACK_MODELS = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5']
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const MCP_BETA = 'mcp-client-2025-11-20'
/** Default output limit when streaming (the API needs one). */
const DEFAULT_MAX_TOKENS = 64_000
/** Server tools can pause a long turn; it is resumed this many times at most. */
const MAX_CONTINUATIONS = 4

function imageBlock(url: string): BetaContentBlockParam {
    const data = /^data:(image\/[\w.+-]+);base64,([\s\S]*)$/.exec(url)
    if (data) {
        return {
            type: 'image',
            source: { type: 'base64', media_type: data[1] as 'image/png', data: data[2] },
        }
    }
    return { type: 'image', source: { type: 'url', url } }
}

/** Builds the Messages API request (exported for tests). */
export function buildAnthropicParams(request: ChatRequest): BetaParams & Record<string, unknown> {
    const messages: BetaMessageParam[] = request.messages
        .filter(m => m.content?.trim())
        .map(m => ({ role: m.role == 'assistant' ? 'assistant' : 'user', content: m.content! }))

    let system = request.systemPrompt?.trim() || undefined
    // The Messages API needs at least one message: a node with only a system prompt sends it as the message.
    if (!messages.some(m => m.role == 'user') && system && !request.images?.length) {
        messages.unshift({ role: 'user', content: system })
        system = undefined
    }

    const images = (request.images || []).map(x => x.trim()).filter(Boolean)
    if (images.length) {
        const last = messages.at(-1)
        const blocks = images.map(imageBlock)
        if (last?.role == 'user') {
            last.content = [...blocks, { type: 'text', text: last.content as string }]
        } else {
            messages.push({ role: 'user', content: blocks })
        }
    }
    if (!messages.length) throw new Error("Add a system prompt or at least one user prompt")

    if (request.responseFormat == 'json_object') {
        // Claude has no "any JSON" mode; ask for it and read it leniently afterwards.
        system = `${system ? `${system}\n\n` : ''}Respond with only a single JSON object, with no other text.`
    }

    const outputConfig: Record<string, unknown> = {}
    if (request.reasoningEffort && request.reasoningEffort != 'none' && request.reasoningEffort != 'minimal') outputConfig.effort = request.reasoningEffort
    if (request.responseFormat == 'json_schema') {
        if (!request.responseSchema?.schema) throw new Error("Output structure is required")
        outputConfig.format = { type: 'json_schema', schema: request.responseSchema.schema }
    }

    const tools: Record<string, unknown>[] = []
    const t = request.tools || {}
    if (t.webSearch) {
        const domains = (t.webSearch.allowedDomains || []).map(x => x.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)
        tools.push({ type: 'web_search_20260209', name: 'web_search', ...(domains.length ? { allowed_domains: domains } : {}) })
    }
    if (t.webFetch) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch' })
    // The web tools already use code execution internally; declaring it again confuses the model.
    if (t.codeExecution && !t.webSearch && !t.webFetch) tools.push({ type: 'code_execution_20260521', name: 'code_execution' })

    const mcpServers = (t.mcpServers || []).filter(x => x.url).map((x, i) => ({
        type: 'url', url: x.url, name: x.label || `server_${i + 1}`,
        ...(x.token ? { authorization_token: x.token } : {}),
    }))
    for (const server of mcpServers) tools.push({ type: 'mcp_toolset', mcp_server_name: server.name })

    const betas: string[] = []
    const params: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens || DEFAULT_MAX_TOKENS,
        messages,
        ...(system ? { system } : {}),
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        ...(tools.length ? { tools } : {}),
        ...(request.tier == 'fast' ? { speed: 'fast' } : {}),
    }
    if (mcpServers.length) {
        params.mcp_servers = mcpServers
        betas.push(MCP_BETA)
    }
    if (FALLBACK_MODELS.includes(request.model)) {
        params.fallbacks = 'default'
        betas.push(FALLBACK_BETA)
    }
    if (betas.length) params.betas = betas
    return params as BetaParams & Record<string, unknown>
}

/** Reads text, citations, sources and usage from a finished Claude message. */
export function parseAnthropicMessage(message: BetaMessage, request: ChatRequest): ChatResult {
    if (message.stop_reason == 'refusal') {
        const details = (message as { stop_details?: { category?: string | null, explanation?: string | null } | null }).stop_details
        throw new Error(`Claude declined this request${details?.category ? ` (${details.category})` : ''}${details?.explanation ? `: ${details.explanation}` : ''}`)
    }

    let text = ''
    const citations = new Map<string, { url: string, title?: string }>()
    const sources = new Set<string>()
    for (const block of message.content) {
        if (block.type == 'text') {
            text += block.text
            for (const c of block.citations || []) {
                if ('url' in c && c.url && !citations.has(c.url)) citations.set(c.url, { url: c.url, title: (c as { title?: string | null }).title || undefined })
            }
        } else if (block.type == 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const r of block.content) if ('url' in r && r.url) sources.add(r.url)
        }
    }

    const u = message.usage
    const usage = {
        input: u.input_tokens ?? 0,
        cachedInput: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
    }

    let warning: string | undefined
    if (message.stop_reason == 'max_tokens') {
        const hint = 'Increase Max output tokens or lower the effort.'
        if (!text) throw new Error(`Claude ran out of output tokens before writing an answer. ${hint}`)
        if (request.responseFormat && request.responseFormat != 'text') throw new Error(`The JSON output was cut off at the output token limit. ${hint}`)
        warning = `Output was cut off at the output token limit. ${hint}`
    }
    if (!text) throw new Error("Claude returned no text output")
    if (request.responseFormat == 'json_object') text = JSON.stringify(extractJson(text))

    return {
        text,
        ...(warning ? { warning } : {}),
        ...(citations.size ? { citations: Array.from(citations.values()) } : {}),
        ...(sources.size ? { sources: Array.from(sources) } : {}),
        usage,
        model: message.model || request.model,
    }
}

function toProviderError(error: unknown): unknown {
    if (error instanceof Anthropic.APIError) {
        const status = typeof error.status == 'number' ? error.status : 0
        const body = error.error as { error?: { message?: string } } | undefined
        return new ProviderHttpError(`Anthropic returned ${status}: ${body?.error?.message || error.message}`, status)
    }
    return error
}

export const anthropicProvider: Provider = {
    async chat(request, { apiKey, signal, onText }) {
        // The app runs entirely in the browser and each user brings their own key, which stays in their browser.
        const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 })
        const params = buildAnthropicParams(request)
        const messages = [...(params.messages as BetaMessageParam[])]
        const total = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 }
        let content: BetaMessage['content'] = []
        let last: BetaMessage | undefined

        try {
            for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
                const stream = client.beta.messages.stream({ ...params, messages } as BetaParams, { signal })
                stream.on('text', (delta) => onText?.(delta))
                last = await stream.finalMessage()
                total.input += last.usage.input_tokens ?? 0
                total.cachedInput += last.usage.cache_read_input_tokens ?? 0
                total.cacheWrite += last.usage.cache_creation_input_tokens ?? 0
                total.output += last.usage.output_tokens ?? 0
                content = [...content, ...last.content]
                // A long server-tool turn can pause; send the partial turn back so Claude continues it.
                if (last.stop_reason != 'pause_turn') break
                messages.push({ role: 'assistant', content: last.content as BetaContentBlockParam[] })
            }
        } catch (error) {
            throw toProviderError(error)
        }

        const merged = { ...last!, content, usage: { ...last!.usage, input_tokens: total.input, cache_read_input_tokens: total.cachedInput, cache_creation_input_tokens: total.cacheWrite, output_tokens: total.output } } as BetaMessage
        return parseAnthropicMessage(merged, request)
    }
}
