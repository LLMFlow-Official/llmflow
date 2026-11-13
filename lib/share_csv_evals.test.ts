import { describe, expect, it } from 'vitest'
import { compressToParam, decompressParam, sanitizeForSharing } from './share'
import { csvToRecords, parseCsv, toCsv } from './csv'
import { simpleCheck } from './evals'

describe('share links', () => {
    it('round-trips text through the compressed link format', async () => {
        const text = JSON.stringify({ nodes: Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, text: 'repeat '.repeat(20) })) })
        const param = await compressToParam(text)
        expect(param).toMatch(/^[\w-]+$/)
        expect(param.length).toBeLessThan(text.length / 4)
        expect(await decompressParam(param)).toBe(text)
    })

    it('reports damaged links', async () => {
        await expect(decompressParam('not-a-real-link')).rejects.toThrow(/damaged/)
    })

    it('removes MCP tokens and secret headers', () => {
        const { nodes, removed } = sanitizeForSharing([
            { id: 'a', type: 'prompt', data: { name: 'Ask', tools: { mcpServers: [{ label: 'x', url: 'u', token: 'secret' }] } } },
            { id: 'b', type: 'http_request', data: { headers: 'Accept: json\nAuthorization: Bearer abc' } },
        ])
        expect(JSON.stringify(nodes)).not.toMatch(/secret|Bearer abc/)
        expect(nodes[1].data.headers).toBe('Accept: json\nAuthorization: <add your own>')
        expect(removed).toEqual(['MCP access token in "Ask"', 'Secret headers in "b"'])
    })
})

describe('CSV', () => {
    it('parses quotes, commas and newlines inside fields', () => {
        expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n\n3,')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere'], ['3', '']])
    })

    it('reads records by header and writes CSV back', () => {
        const { columns, records } = csvToRecords('topic,expected\ncats,meow\n')
        expect(columns).toEqual(['topic', 'expected'])
        expect(records).toEqual([{ topic: 'cats', expected: 'meow' }])
        expect(toCsv([['a', 'b,c'], ['"q"', 1]])).toBe('a,"b,c"\n"""q""",1')
    })
})

describe('simpleCheck', () => {
    it('checks contains, equals and regex, ignoring case', () => {
        expect(simpleCheck('contains', 'The answer is Paris.', 'paris')).toEqual({ passed: true })
        expect(simpleCheck('equals', ' Yes ', 'yes')).toEqual({ passed: true })
        expect(simpleCheck('regex', 'Order #1234', '#\\d{4}')).toEqual({ passed: true })
        expect(simpleCheck('regex', 'x', '(')).toMatchObject({ passed: false, detail: expect.stringMatching(/Invalid pattern/) })
        expect(simpleCheck('none', 'x', 'y')).toEqual({ passed: null })
    })
})
