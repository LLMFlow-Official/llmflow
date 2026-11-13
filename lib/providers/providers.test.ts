import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { buildOpenAiBody } from './openai'
import { buildAnthropicParams, parseAnthropicMessage } from './anthropic'
import { buildGeminiBody, parseGeminiChunks } from './google'
import { buildCompatibleBody } from './compatible'
import { parseEvent, readSse } from './sse'
import { ChatRequest } from './types'
import { costOf, pricesAt, findModel } from '../openai/models'

const base = (patch: Partial<ChatRequest> = {}): ChatRequest => ({
    provider: 'openai', model: 'gpt-6.1-sol', systemPrompt: 'Be brief', messages: [{ role: 'user', content: 'Hi' }], ...patch,
})

describe('OpenAI request', () => {
    it('adds code interpreter, MCP servers without approval, and Flex', () => {
        const body = buildOpenAiBody(base({ tools: { codeExecution: true, mcpServers: [{ label: 'docs', url: 'https://x.dev/mcp', token: 't' }, { label: 'empty', url: '' }] }, tier: 'flex' }))
        expect(body.tools).toEqual([
            { type: 'code_interpreter', container: { type: 'auto' } },
            { type: 'mcp', server_label: 'docs', server_url: 'https://x.dev/mcp', require_approval: 'never', authorization: 't' },
        ])
        expect(body.service_tier).toBe('flex')
        expect(body.store).toBe(false)
    })
})

describe('Anthropic request', () => {
    const claude = (patch: Partial<ChatRequest> = {}) => buildAnthropicParams(base({ provider: 'anthropic', model: 'claude-opus-5-5', ...patch }))

    it('sends the system prompt, effort, and turns on refusal fallback for supported models', () => {
        const params = claude({ reasoningEffort: 'high' })
        expect(params).toMatchObject({ model: 'claude-opus-5-5', system: 'Be brief', max_tokens: 64000, output_config: { effort: 'high' }, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] })
        expect(params.messages).toEqual([{ role: 'user', content: 'Hi' }])
    })

    it('does not use fallback on Haiku and never sends temperature', () => {
        const params = claude({ model: 'claude-haiku-5-5', temperature: 0.3 })
        expect('fallbacks' in params).toBe(false)
        expect('temperature' in params).toBe(false)
    })

    it('moves a system-only prompt into the message', () => {
        const params = claude({ messages: [] })
        expect(params.messages).toEqual([{ role: 'user', content: 'Be brief' }])
        expect('system' in params).toBe(false)
    })

    it('uses output_config.format for JSON schemas and puts images before the text', () => {
        const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
        const params = claude({ responseFormat: 'json_schema', responseSchema: { name: 'x', schema }, images: ['data:image/png;base64,AAAA', 'https://e.com/a.jpg'] })
        expect(params.output_config).toEqual({ format: { type: 'json_schema', schema } })
        expect(params.messages[0].content).toEqual([
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'image', source: { type: 'url', url: 'https://e.com/a.jpg' } },
            { type: 'text', text: 'Hi' },
        ])
    })

    it('adds server tools, MCP servers with their beta, and fast mode', () => {
        const params = claude({ tier: 'fast', tools: { webSearch: { allowedDomains: ['https://a.com/x'] }, codeExecution: true, mcpServers: [{ label: 'docs', url: 'https://x.dev/mcp' }] } })
        expect(params.tools).toEqual([
            { type: 'web_search_20260209', name: 'web_search', allowed_domains: ['a.com'] },
            { type: 'mcp_toolset', mcp_server_name: 'docs' },
        ])
        expect(params.mcp_servers).toEqual([{ type: 'url', url: 'https://x.dev/mcp', name: 'docs' }])
        expect(params.betas).toEqual(['mcp-client-2025-11-20', 'server-side-fallback-2026-07-01'])
        expect(params.speed).toBe('fast')
    })

    it('adds code execution on its own when no web tool is on', () => {
        expect(claude({ tools: { codeExecution: true } }).tools).toEqual([{ type: 'code_execution_20260521', name: 'code_execution' }])
    })
})

describe('Anthropic response', () => {
    const message = (patch: Record<string, unknown>) => ({
        id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
        content: [], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
        ...patch,
    }) as unknown as Anthropic.Beta.Messages.BetaMessage
    const req = base({ provider: 'anthropic', model: 'claude-opus-5-5' })

    it('reads text, citations and usage', () => {
        const result = parseAnthropicMessage(message({
            content: [
                { type: 'text', text: 'Paris ', citations: [{ type: 'web_search_result_location', url: 'https://w.org', title: 'Wiki', cited_text: 'x' }] },
                { type: 'text', text: 'is the capital.', citations: null },
            ]
        }), req)
        expect(result).toMatchObject({ text: 'Paris is the capital.', citations: [{ url: 'https://w.org', title: 'Wiki' }], usage: { input: 100, cachedInput: 50, cacheWrite: 10, output: 20 } })
    })

    it('explains refusals and truncation', () => {
        expect(() => parseAnthropicMessage(message({ stop_reason: 'refusal', stop_details: { category: 'cyber', explanation: 'no' } }), req)).toThrow('Claude declined this request (cyber): no')
        expect(() => parseAnthropicMessage(message({ stop_reason: 'max_tokens', content: [] }), req)).toThrow(/ran out of output tokens/)
        expect(parseAnthropicMessage(message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Part' }] }), req).warning).toMatch(/cut off/)
    })

    it('reads JSON leniently in JSON object mode', () => {
        const result = parseAnthropicMessage(message({ content: [{ type: 'text', text: 'Here: {"a": 1}' }] }), { ...req, responseFormat: 'json_object' })
        expect(result.text).toBe('{"a":1}')
    })
})

describe('Gemini', () => {
    it('builds contents, system instruction, JSON schema and search', () => {
        const schema = { type: 'object' }
        const body = buildGeminiBody(base({ provider: 'google', model: 'gemini-4-hydrogen', temperature: 0, responseFormat: 'json_schema', responseSchema: { name: 'x', schema }, tools: { webSearch: {} } }), [{ inlineData: { mimeType: 'image/png', data: 'AA' } }])
        expect(body).toEqual({
            contents: [{ role: 'user', parts: [{ text: 'Hi' }, { inlineData: { mimeType: 'image/png', data: 'AA' } }] }],
            systemInstruction: { parts: [{ text: 'Be brief' }] },
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: schema },
            tools: [{ googleSearch: {} }],
        })
    })

    it('joins streamed text without thoughts and counts thinking as output', () => {
        const result = parseGeminiChunks([
            { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Hel' }] } }] },
            { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP', groundingMetadata: { groundingChunks: [{ web: { uri: 'https://g.com', title: 'G' } }] } }], usageMetadata: { promptTokenCount: 30, cachedContentTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 }, modelVersion: 'gemini-4-hydrogen-001' },
        ], base({ provider: 'google', model: 'gemini-4-hydrogen' }))
        expect(result).toEqual({ text: 'Hello', citations: [{ url: 'https://g.com', title: 'G' }], usage: { input: 20, cachedInput: 10, cacheWrite: 0, output: 12, reasoning: 7 }, model: 'gemini-4-hydrogen' })
    })

    it('reports blocked answers', () => {
        expect(() => parseGeminiChunks([{ promptFeedback: { blockReason: 'SAFETY' } }], base())).toThrow(/blocked the prompt/)
        expect(() => parseGeminiChunks([{ candidates: [{ finishReason: 'SAFETY' }] }], base())).toThrow(/stopped the answer/)
    })
})

describe('OpenAI-compatible request', () => {
    it('uses Chat Completions with usage in the stream', () => {
        const body = buildCompatibleBody(base({ provider: 'compatible', model: 'llama3.3', temperature: 0.2, responseFormat: 'json_schema', responseSchema: { name: 'out', schema: { type: 'object' }, strict: true } }))
        expect(body).toEqual({
            model: 'llama3.3',
            messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi' }],
            stream: true,
            stream_options: { include_usage: true },
            temperature: 0.2,
            response_format: { type: 'json_schema', json_schema: { name: 'out', schema: { type: 'object' }, strict: true } },
        })
    })
})

describe('SSE reading', () => {
    it('parses events split across chunks', async () => {
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('event: a\ndata: {"x":'))
                controller.enqueue(encoder.encode('1}\n\ndata: second\r\n\r\ndata: last'))
                controller.close()
            }
        })
        const events = []
        for await (const event of readSse(body)) events.push(event)
        expect(events).toEqual([{ event: 'a', data: '{"x":1}' }, { event: undefined, data: 'second' }, { event: undefined, data: 'last' }])
        expect(parseEvent(': comment only')).toBeNull()
    })
})

describe('costs across providers', () => {
    const usage = { input: 1_000, cachedInput: 2_000, cacheWrite: 4_000, output: 500 }

    it('prices Claude cache reads and writes', () => {
        // Opus 5.5: $4 in, $0.20 cache read, $5 cache write (1.25x), $20 out per 1M
        expect(costOf(usage, 'claude-opus-5-5')?.toNumber()).toBeCloseTo((1000 * 4 + 2000 * 0.2 + 4000 * 5 + 500 * 20) / 1e6, 12)
    })

    it('applies Flex and fast multipliers', () => {
        const standard = costOf(usage, 'gpt-6.1-sol')!.toNumber()
        expect(costOf(usage, 'gpt-6.1-sol', { tier: 'flex' })!.toNumber()).toBeCloseTo(standard / 2, 12)
        expect(costOf(usage, 'claude-opus-5-5', { tier: 'fast' })!.toNumber()).toBeCloseTo(costOf(usage, 'claude-opus-5-5')!.toNumber() * 2, 12)
    })

    it('uses scheduled price changes by date', () => {
        const carbon = findModel('gemini-4-carbon')!
        expect(pricesAt(carbon, new Date('2026-11-30T12:00:00Z')).input).toBe(2)
        expect(pricesAt(carbon, new Date('2026-12-01T00:00:00Z')).input).toBe(4)
    })

    it("uses Haiku's long-prompt prices above 100K input tokens", () => {
        expect(costOf({ input: 150_000, cachedInput: 0, cacheWrite: 0, output: 0 }, 'claude-haiku-5-5')?.toNumber()).toBeCloseTo(150_000 * 0.5 / 1e6, 12)
    })
})
