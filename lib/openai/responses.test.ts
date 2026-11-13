import { describe, expect, it } from 'vitest'
import { buildResponsesPayload, imageResponseToUrl, imageUsageToCost, parseJsonOutput, parseResponse, ResponseObject } from './index'

const baseUsage = { input_tokens: 10, output_tokens: 10, total_tokens: 20 }

const responseWith = (overrides: Partial<ResponseObject>): ResponseObject => ({
    id: 'resp_1',
    object: 'response',
    model: 'gpt-6-luna',
    status: 'completed',
    output: [],
    usage: baseUsage,
    ...overrides,
})

const message = (...content: ({ type: 'output_text', text: string } | { type: 'refusal', refusal: string })[]) => ({
    type: 'message' as const, role: 'assistant' as const, content,
})

describe('buildResponsesPayload', () => {
    it('sends the system prompt as a developer message and disables storage', () => {
        const payload = buildResponsesPayload({
            model: 'gpt-6.1-sol',
            systemPrompt: 'Be brief',
            messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
        })
        expect(payload).toEqual({
            model: 'gpt-6.1-sol',
            store: false,
            input: [
                { role: 'developer', content: 'Be brief' },
                { role: 'user', content: 'Hi' },
                { role: 'assistant', content: 'Hello' },
            ],
        })
    })

    it('accepts a node with only a system prompt', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'Write a haiku', messages: [] })
        expect(payload.input).toEqual([{ role: 'developer', content: 'Write a haiku' }])
    })

    it('accepts a node with no system prompt and skips empty messages', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6-luna', messages: [{ role: 'user', content: '' }, { role: 'user', content: 'Hi' }] })
        expect(payload.input).toEqual([{ role: 'user', content: 'Hi' }])
    })

    it('rejects a node with nothing to send', () => {
        expect(() => buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: '  ', messages: [] })).toThrow(/system prompt or at least one user prompt/)
    })

    it('omits text.format for text output', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'x', messages: [], responseFormat: 'text' })
        expect(payload.text).toBeUndefined()
    })

    it('maps json_object', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'Reply in JSON', messages: [], responseFormat: 'json_object', responseSchema: { name: 'stale', schema: {} } })
        expect(payload.text).toEqual({ format: { type: 'json_object' } })
    })

    it('flattens a json_schema into text.format', () => {
        const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }
        const payload = buildResponsesPayload({
            model: 'gpt-6-luna', systemPrompt: 'x', messages: [],
            responseFormat: 'json_schema', responseSchema: { name: 'answer', strict: true, schema },
        })
        expect(payload.text).toEqual({ format: { type: 'json_schema', name: 'answer', strict: true, schema } })
    })

    it('requires a schema for json_schema', () => {
        expect(() => buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'x', messages: [], responseFormat: 'json_schema' })).toThrow(/Output structure/)
    })

    it('sends reasoning effort and max output tokens', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6.1-sol', systemPrompt: 'x', messages: [], reasoningEffort: 'high', maxOutputTokens: 2000 })
        expect(payload.reasoning).toEqual({ effort: 'high' })
        expect(payload.max_output_tokens).toBe(2000)
    })

    it('sends temperature 0 instead of turning it into 1', () => {
        const payload = buildResponsesPayload({ model: 'gpt-4.1', systemPrompt: 'x', messages: [], temperature: 0, topP: 0 })
        expect(payload.temperature).toBe(0)
        expect(payload.top_p).toBe(0)
    })

    it('does not send temperature unless it was set', () => {
        const payload = buildResponsesPayload({ model: 'gpt-4.1', systemPrompt: 'x', messages: [] })
        expect('temperature' in payload).toBe(false)
        expect('top_p' in payload).toBe(false)
    })

    it('drops temperature for reasoning models unless effort is none', () => {
        const reasoning = buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'x', messages: [], temperature: 0.2 })
        expect(reasoning.temperature).toBeUndefined()
        const none = buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'x', messages: [], temperature: 0.2, reasoningEffort: 'none' })
        expect(none.temperature).toBe(0.2)
    })
})

describe('parseResponse', () => {
    it('reads text, skipping reasoning items', () => {
        const response = responseWith({ output: [{ type: 'reasoning', summary: [] }, message({ type: 'output_text', text: 'Hello' })] })
        expect(parseResponse(response)).toEqual({ text: 'Hello' })
    })

    it('joins multiple text parts', () => {
        const response = responseWith({ output: [message({ type: 'output_text', text: 'Hel' }, { type: 'output_text', text: 'lo' })] })
        expect(parseResponse(response).text).toBe('Hello')
    })

    it('uses the final message when there are several', () => {
        const response = responseWith({ output: [message({ type: 'output_text', text: '{"a":' }), message({ type: 'output_text', text: '{"a":1}' })] })
        expect(parseResponse(response, 'json_schema').text).toBe('{"a":1}')
    })

    it('prefers the final_answer phase', () => {
        const response = responseWith({
            output: [
                { ...message({ type: 'output_text', text: 'answer' }), phase: 'final_answer' },
                { ...message({ type: 'output_text', text: 'note' }), phase: 'commentary' },
            ]
        })
        expect(parseResponse(response).text).toBe('answer')
    })

    it('turns a refusal into an error', () => {
        const response = responseWith({ output: [message({ type: 'refusal', refusal: 'I cannot help with that.' })] })
        expect(() => parseResponse(response)).toThrow('The model refused: I cannot help with that.')
    })

    it('turns a failed response into an error', () => {
        const response = responseWith({ status: 'failed', error: { message: 'Server overloaded' } })
        expect(() => parseResponse(response)).toThrow('Server overloaded')
    })

    it('explains output-token exhaustion with no visible output', () => {
        const response = responseWith({
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [{ type: 'reasoning', summary: [] }],
            usage: { ...baseUsage, output_tokens_details: { reasoning_tokens: 500 } },
        })
        expect(() => parseResponse(response)).toThrow(/ran out of output tokens.*500 tokens went to reasoning/)
    })

    it('returns truncated text with a warning', () => {
        const response = responseWith({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [message({ type: 'output_text', text: 'Partial' })] })
        expect(parseResponse(response)).toEqual({ text: 'Partial', warning: expect.stringMatching(/cut off/) })
    })

    it('rejects truncated JSON', () => {
        const response = responseWith({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [message({ type: 'output_text', text: '{"a":' })] })
        expect(() => parseResponse(response, 'json_object')).toThrow(/JSON output was cut off/)
    })

    it('reports other incomplete reasons', () => {
        const response = responseWith({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] })
        expect(() => parseResponse(response)).toThrow('The response is incomplete (content_filter)')
    })

    it('rejects empty output', () => {
        expect(() => parseResponse(responseWith({ output: [] }))).toThrow(/no text output/)
    })
})

describe('parseJsonOutput', () => {
    it('parses valid JSON', () => {
        expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 })
    })

    it('throws a readable error for invalid JSON', () => {
        expect(() => parseJsonOutput('not json')).toThrow('The model output is not valid JSON: not json')
    })
})

describe('image inputs', () => {
    it('attaches images to the last user message', () => {
        const payload = buildResponsesPayload({
            model: 'gpt-6-luna', systemPrompt: 'x',
            messages: [{ role: 'user', content: 'What is in this picture?' }],
            images: ['https://example.com/cat.png', ' ', 'data:image/png;base64,AAAA'],
        })
        expect(payload.input.at(-1)).toEqual({
            role: 'user',
            content: [
                { type: 'input_text', text: 'What is in this picture?' },
                { type: 'input_image', image_url: 'https://example.com/cat.png', detail: 'auto' },
                { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
            ],
        })
    })

    it('adds a user message when the last message is not from the user', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'Describe the image', messages: [], images: ['https://example.com/a.jpg'] })
        expect(payload.input).toEqual([
            { role: 'developer', content: 'Describe the image' },
            { role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/a.jpg', detail: 'auto' }] },
        ])
    })

    it('accepts images with no text at all', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6-luna', messages: [], images: ['https://example.com/a.jpg'] })
        expect(payload.input).toHaveLength(1)
    })

    it('rejects values that are not image URLs', () => {
        expect(() => buildResponsesPayload({ model: 'gpt-6-luna', systemPrompt: 'x', messages: [], images: ['cat.png'] })).toThrow(/http\(s\) URL or an image data URL/)
    })
})

describe('web search', () => {
    it('adds the web_search tool, domain filter and sources', () => {
        const payload = buildResponsesPayload({
            model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'news' }],
            webSearch: { contextSize: 'low', allowedDomains: ['https://openai.com/blog', 'docs.python.org', ''] },
        })
        expect(payload.tools).toEqual([{ type: 'web_search', search_context_size: 'low', filters: { allowed_domains: ['openai.com', 'docs.python.org'] } }])
        expect(payload.include).toEqual(['web_search_call.action.sources'])
    })

    it('leaves out empty options', () => {
        const payload = buildResponsesPayload({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'news' }], webSearch: {} })
        expect(payload.tools).toEqual([{ type: 'web_search' }])
    })

    it('reads citations and sources', () => {
        const response = responseWith({
            output: [
                { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://a.com' }, { type: 'url', url: 'https://b.com' }] } },
                {
                    type: 'message', role: 'assistant', content: [{
                        type: 'output_text', text: 'Answer',
                        annotations: [
                            { type: 'url_citation', url: 'https://a.com', title: 'A', start_index: 0, end_index: 6 },
                            { type: 'url_citation', url: 'https://a.com', title: 'A', start_index: 0, end_index: 6 },
                        ]
                    }]
                },
            ]
        })
        expect(parseResponse(response)).toEqual({
            text: 'Answer',
            citations: [{ url: 'https://a.com', title: 'A' }],
            sources: ['https://a.com', 'https://b.com'],
        })
    })
})

describe('image generation helpers', () => {
    it('prices GPT Image 2.5 by text input and image output tokens', () => {
        const cost = imageUsageToCost({ input_tokens: 100, output_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } }, 'gpt-image-2.5-flare')
        expect(cost?.toNumber()).toBeCloseTo((100 * 5 + 1000 * 30) / 1e6, 12)
    })

    it('returns null when prices or usage are missing', () => {
        expect(imageUsageToCost({ input_tokens: 1, output_tokens: 1 }, 'gpt-image-2')).toBeNull()
        expect(imageUsageToCost(undefined, 'gpt-image-2.5-flare')).toBeNull()
    })

    it('turns base64 into a data URL', () => {
        expect(imageResponseToUrl({ created: 0, data: [{ b64_json: 'AAAA' }] }, 'webp')).toBe('data:image/webp;base64,AAAA')
        expect(() => imageResponseToUrl({ created: 0, data: [] })).toThrow(/no image/)
    })
})
