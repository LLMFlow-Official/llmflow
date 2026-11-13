import { describe, expect, it } from 'vitest'
import { FLOW_FILE_VERSION, parseFlow, riskyNodes, serializeFlow } from './flow_file'

const types = ['start', 'prompt', 'code', 'http_request', 'decision']

const start = { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { thread: 'main' } }
const prompt = { id: 'prompt_1', type: 'prompt', position: { x: 0, y: 100 }, data: { thread: 'main', name: 'Ask' } }

describe('parseFlow', () => {
    it('reads version 1 files (no version field)', () => {
        const flow = parseFlow(JSON.stringify({ nodes: [start, prompt], edges: [{ id: 'e1', source: 'start', target: 'prompt_1' }] }), types)
        expect(flow.nodes).toHaveLength(2)
        expect(flow.edges).toEqual([{ id: 'e1', source: 'start', target: 'prompt_1' }])
        expect(flow.warnings).toEqual([])
    })

    it('round-trips through serializeFlow and drops editor-only keys', () => {
        const text = serializeFlow([{ ...start, selected: true }, prompt], [{ id: 'e1', source: 'start', target: 'prompt_1', selected: true }], 'My flow')
        expect(JSON.parse(text)).toMatchObject({ app: 'llmflow', version: FLOW_FILE_VERSION, name: 'My flow' })
        const flow = parseFlow(text, types)
        expect(flow.name).toBe('My flow')
        expect('selected' in flow.nodes[0]).toBe(false)
        expect('selected' in flow.edges[0]).toBe(false)
    })

    it('rejects files that are not flows', () => {
        expect(() => parseFlow('not json', types)).toThrow(/not JSON/)
        expect(() => parseFlow('[]', types)).toThrow(/not a valid flow/)
        expect(() => parseFlow('{"nodes": []}', types)).toThrow(/nodes or edges are missing/)
    })

    it('rejects files from a newer version', () => {
        expect(() => parseFlow({ version: FLOW_FILE_VERSION + 1, nodes: [start], edges: [] }, types)).toThrow(/newer version/)
    })

    it('rejects unknown node types, duplicate ids and a missing Start node', () => {
        expect(() => parseFlow({ nodes: [start, { ...prompt, type: 'evil' }], edges: [] }, types)).toThrow(/unknown type "evil"/)
        expect(() => parseFlow({ nodes: [start, start], edges: [] }, types)).toThrow(/same id/)
        expect(() => parseFlow({ nodes: [prompt], edges: [] }, types)).toThrow(/no Start node/)
    })

    it('repairs small problems and reports them', () => {
        const flow = parseFlow({
            nodes: [start, { id: 'prompt_1', type: 'prompt', data: null }],
            edges: [{ id: 'e1', source: 'start', target: 'gone' }, { id: 'e1', source: 'start', target: 'prompt_1' }, 'junk'],
        }, types)
        expect(flow.nodes[1]).toMatchObject({ position: { x: 0, y: 0 }, data: { thread: 'main' } })
        expect(flow.edges).toEqual([{ id: 'e1', source: 'start', target: 'prompt_1' }])
        expect(flow.warnings).toHaveLength(3)
    })
})

describe('riskyNodes', () => {
    it('lists nodes that run code or call URLs', () => {
        const flow = parseFlow({
            nodes: [start, prompt, { id: 'code_1', type: 'code', position: { x: 0, y: 0 }, data: { thread: 'main', name: 'Transform' } }, { id: 'http_1', type: 'http_request', position: { x: 0, y: 0 }, data: { thread: 'main' } }],
            edges: [],
        }, types)
        expect(riskyNodes(flow.nodes)).toEqual([
            { id: 'code_1', name: 'Transform', reason: 'runs JavaScript' },
            { id: 'http_1', name: 'http_request', reason: 'calls a URL' },
        ])
    })
})
