import { describe, expect, it } from 'vitest'
import { codeSamples, toPython } from './code_export'
import { ChatRequest } from './providers/types'

const request = (patch: Partial<ChatRequest>): ChatRequest => ({
    provider: 'openai', model: 'gpt-6.1-sol', systemPrompt: "It's {start.tone}", messages: [{ role: 'user', content: 'Hi' }], ...patch,
})

describe('toPython', () => {
    it('writes Python literals', () => {
        expect(toPython({ a: true, b: null, c: [1, 'x'], d: {} })).toBe('{\n    "a": True,\n    "b": None,\n    "c": [\n        1,\n        "x",\n    ],\n    "d": {},\n}')
    })
})

describe('codeSamples', () => {
    it('writes OpenAI Responses calls, keeping placeholders and quoting for the shell', () => {
        const [curl, ts, py] = codeSamples(request({}))
        expect(curl.code).toContain("https://api.openai.com/v1/responses")
        expect(curl.code).toContain(`It'\\''s {start.tone}`)
        expect(ts.code).toContain('client.responses.create(')
        expect(py.code).toContain('store=False,')
    })

    it('writes Claude calls with the SDK, streaming, betas and a refusal check', () => {
        const [curl, ts, py] = codeSamples(request({ provider: 'anthropic', model: 'claude-opus-5-5' }))
        expect(curl.code).toContain('-H "anthropic-beta: server-side-fallback-2026-07-01"')
        expect(curl.code).not.toContain('"betas"')
        expect(ts.code).toContain('client.beta.messages.stream(')
        expect(ts.code).toContain('.finalMessage()')
        expect(ts.code).toContain('"fallbacks": "default"')
        expect(py.code).toContain('stream.get_final_message()')
        expect(py.code).toContain('message.stop_reason == "refusal"')
    })

    it('uses the plain Messages API when no beta is needed', () => {
        const [, ts] = codeSamples(request({ provider: 'anthropic', model: 'claude-haiku-5-5' }))
        expect(ts.code).toContain('client.messages.stream(')
    })

    it('writes Gemini and compatible-server requests', () => {
        expect(codeSamples(request({ provider: 'google', model: 'gemini-4-hydrogen' }))[0].code).toContain('models/gemini-4-hydrogen:generateContent')
        const compatible = codeSamples(request({ provider: 'compatible', model: 'llama3.3' }), { baseUrl: 'http://localhost:11434/v1/' })
        expect(compatible[0].code).toContain('http://localhost:11434/v1/chat/completions')
        expect(compatible[0].code).not.toContain('stream')
    })
})
