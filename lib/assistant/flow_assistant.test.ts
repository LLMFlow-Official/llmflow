import { describe, expect, it } from 'vitest'
import { assignThreads, buildSystemPrompt, describeFlow, fakeAssistantReply, normalizeFlow, parseReply, priorTurns } from './flow_assistant'
import { EXAMPLE_FLOW } from './catalog'

const types = ['start', 'prompt', 'llm_router', 'decision', 'loop', 'final_output', 'multi_thread', 'thread_merge', 'sub_flow', 'text_template']
const opts = { knownTypes: types, savedFlowIds: ['flow_saved'] }
const empty = { nodes: [], edges: [] }

describe('parseReply', () => {
    it('reads a message with a flow, even around extra text', () => {
        const reply = parseReply('Sure!\n```json\n{"reply": "Done", "flow": {"nodes": [{"id": "start", "type": "start"}], "edges": []}}\n```')
        expect(reply.reply).toBe('Done')
        expect(reply.flow?.nodes).toEqual([{ id: 'start', type: 'start', data: {} }])
    })

    it('accepts a message without a flow and rejects empty or broken replies', () => {
        expect(parseReply('{"reply": "Which provider do you use?"}')).toEqual({ reply: 'Which provider do you use?' })
        expect(() => parseReply('{}')).toThrow(/neither a message nor a flow/)
        expect(() => parseReply('{"reply": "x", "flow": {"nodes": 1}}')).toThrow(/no nodes or edges/)
        expect(() => parseReply('no json')).toThrow()
    })
})

describe('normalizeFlow', () => {
    it('accepts the example in the prompt without issues and labels the router branches', () => {
        const { flow } = parseReply(EXAMPLE_FLOW.slice(EXAMPLE_FLOW.indexOf('{')))
        const result = normalizeFlow(flow!, empty, opts)
        expect(result.issues).toEqual([])
        expect(result.edges.find(e => e.target == 'prompt_c3d1')?.label).toBe('negative')
        expect(result.changes.added).toHaveLength(6)
        expect(result.nodes.every(n => typeof n.data.thread == 'string')).toBe(true)
    })

    it('renames badly formed ids everywhere they are used', () => {
        const result = normalizeFlow({
            nodes: [
                { id: 'begin', type: 'start', data: {} },
                { id: 'Summary Step', type: 'prompt', data: { prompts: [{ role: 'user', content: '{begin.text}' }] } },
                { id: 'out', type: 'final_output', data: { value: '{Summary Step.assistant_raw_output}' } },
            ],
            edges: [{ source: 'begin', target: 'Summary Step' }, { source: 'Summary Step', target: 'out' }],
        }, empty, opts)
        const prompt = result.nodes.find(n => n.type == 'prompt')!
        const final = result.nodes.find(n => n.type == 'final_output')!
        expect(prompt.id).toMatch(/^prompt_[0-9a-f]{4}$/)
        expect(final.data.value).toBe(`{${prompt.id}.assistant_raw_output}`)
        expect(JSON.stringify(prompt.data)).toContain('{start.text}')
        expect(result.edges.map(e => [e.source, e.target])).toEqual([['start', prompt.id], [prompt.id, final.id]])
        expect(result.issues).toEqual([])
    })

    it('reports branching from a normal node, missing routes, bad references and cycles', () => {
        const result = normalizeFlow({
            nodes: [
                { id: 'start', type: 'start' },
                { id: 'prompt_aaaa', type: 'prompt', data: { name: 'Ask' } },
                { id: 'llm_router_bbbb', type: 'llm_router', data: { routes: {} } },
                { id: 'final_output_cccc', type: 'final_output', data: { value: '{ghost_1234.x}' } },
                { id: 'final_output_dddd', type: 'final_output' },
            ],
            edges: [
                { source: 'start', target: 'prompt_aaaa' },
                { source: 'prompt_aaaa', target: 'final_output_cccc' },
                { source: 'prompt_aaaa', target: 'llm_router_bbbb' },
                { source: 'llm_router_bbbb', target: 'final_output_dddd' },
                { source: 'final_output_dddd', target: 'prompt_aaaa' },
            ],
        }, empty, opts)
        expect(result.issues.join('\n')).toMatch(/"Ask" \(prompt\) has 2 outgoing edges/)
        expect(result.issues.join('\n')).toMatch(/no route name/)
        expect(result.issues.join('\n')).toMatch(/\{ghost_1234\.x\} points at "ghost_1234"/)
        expect(result.issues.join('\n')).toMatch(/loops back/)
    })

    it('checks loop routes and saved flows, and drops unknown node types', () => {
        const result = normalizeFlow({
            nodes: [
                { id: 'start', type: 'start' },
                { id: 'loop_aaaa', type: 'loop', data: { routes: {} } },
                { id: 'sub_flow_bbbb', type: 'sub_flow', data: { flow_id: 'missing' } },
                { id: 'magic_cccc', type: 'magic' },
            ],
            edges: [{ source: 'start', target: 'loop_aaaa' }, { source: 'loop_aaaa', target: 'sub_flow_bbbb' }],
        }, empty, opts)
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.stringMatching(/unknown type "magic"/),
            expect.stringMatching(/must mark its edge to "sub_flow_bbbb"/),
            expect.stringMatching(/no "each" step/),
            expect.stringMatching(/saved flow ids/),
        ]))
    })

    it('keeps positions when only settings change, and reports what changed', () => {
        const existing = {
            nodes: [
                { id: 'start', type: 'start', position: { x: 5, y: 6 }, data: { thread: 'main' } },
                { id: 'prompt_aaaa', type: 'prompt', position: { x: 50, y: 60 }, data: { thread: 'main', system_prompt: 'old' } },
            ],
            edges: [{ source: 'start', target: 'prompt_aaaa' }],
        }
        const result = normalizeFlow({
            nodes: [{ id: 'start', type: 'start', data: {} }, { id: 'prompt_aaaa', type: 'prompt', data: { system_prompt: 'new' } }],
            edges: [{ source: 'start', target: 'prompt_aaaa' }],
        }, existing, opts)
        expect(result.relaidOut).toBe(false)
        expect(result.nodes.find(n => n.id == 'prompt_aaaa')?.position).toEqual({ x: 50, y: 60 })
        expect(result.changes).toEqual({ added: [], removed: [], changed: ['prompt_aaaa'] })
    })

    it('adds a start node when the reply leaves it out', () => {
        const result = normalizeFlow({ nodes: [{ id: 'final_output_aaaa', type: 'final_output', data: {} }], edges: [{ source: 'start', target: 'final_output_aaaa' }] }, empty, opts)
        expect(result.nodes[0]).toMatchObject({ id: 'start', type: 'start' })
        expect(result.issues).toEqual([])
    })
})

describe('assignThreads', () => {
    it('gives parallel branches their own threads and joins them at the merge', () => {
        const nodes = ['start', 'multi_thread_a', 'x', 'y', 'thread_merge_b'].map(id => ({ id, type: id.startsWith('multi') ? 'multi_thread' : id.startsWith('thread_merge') ? 'thread_merge' : 'step', data: {} as Record<string, unknown> }))
        assignThreads(nodes, [
            { source: 'start', target: 'multi_thread_a' }, { source: 'multi_thread_a', target: 'x' }, { source: 'multi_thread_a', target: 'y' },
            { source: 'x', target: 'thread_merge_b' }, { source: 'y', target: 'thread_merge_b' },
        ])
        const t = Object.fromEntries(nodes.map(n => [n.id, n.data.thread]))
        expect(t.start).toBe('main')
        expect(t.multi_thread_a).toBe('main')
        expect(t.x).not.toBe(t.y)
        expect(t.thread_merge_b).toBe('main')
        expect(nodes.find(n => n.id == 'x')?.data.parentId).toBe('multi_thread_a')
    })
})

describe('prompt helpers', () => {
    it('describes the flow without editor-only fields', () => {
        const text = describeFlow('F', [{ id: 'start', type: 'start', position: { x: 1, y: 2 }, data: { thread: 'main', parentId: 'x', name: 'S' } }], [])
        expect(text).toBe('{"name":"F","nodes":[{"id":"start","type":"start","data":{"name":"S"}}],"edges":[]}')
    })

    it('lists the models and saved flows in the system prompt', () => {
        const text = buildSystemPrompt({ models: [{ provider: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }], defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' }, savedFlows: [{ id: 'flow_1', name: 'Other' }] })
        expect(text).toContain('Use provider "anthropic" with model "claude-opus-5-5"')
        expect(text).toContain('- flow_1: Other')
    })

    it('makes a valid example in Test API mode', () => {
        const { flow } = parseReply(fakeAssistantReply('Translate emails', 'openai', 'gpt-6.1-sol'))
        expect(normalizeFlow(flow!, empty, opts).issues).toEqual([])
    })
})

describe('priorTurns', () => {
    it('sends alternating turns that start with the user and end with the assistant', () => {
        expect(priorTurns([
            { role: 'assistant', text: 'stray' },
            { role: 'user', text: 'a' },
            { role: 'error', text: 'boom' },
            { role: 'user', text: 'b' },
            { role: 'assistant', text: 'done' },
            { role: 'user', text: 'c' },
        ])).toEqual([
            { role: 'user', content: 'a\n\nb' },
            { role: 'assistant', content: 'done' },
            { role: 'user', content: 'c' },
            { role: 'assistant', content: '(No reply.)' },
        ])
        expect(priorTurns([])).toEqual([])
    })
})
