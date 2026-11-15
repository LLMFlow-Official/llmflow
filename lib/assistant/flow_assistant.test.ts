import { describe, expect, it } from 'vitest'
import { assignThreads, buildSystemPrompt, describeFlow, fakeAssistantReply, normalizeFlow, parseReply, previewFlow, priorTurns, readPartialFlow } from './flow_assistant'
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

describe('readPartialFlow', () => {
    const full = fakeAssistantReply('Summarize a text', 'openai', 'gpt-6.1-sol')

    it('returns only the nodes and edges that have fully arrived', () => {
        expect(readPartialFlow(full.slice(0, full.indexOf('"flow"')))).toBeUndefined()
        const firstNodeEnd = full.indexOf('"prompt_7e57"')
        const early = readPartialFlow(full.slice(0, firstNodeEnd))!
        expect(early.nodes.map(n => n.id)).toEqual(['start'])
        expect(early.nodesDone).toBe(false)

        const midEdges = readPartialFlow(full.slice(0, full.lastIndexOf('{"source"')))!
        expect(midEdges.nodes.map(n => n.id)).toEqual(['start', 'prompt_7e57', 'final_output_7e58'])
        expect(midEdges.nodesDone).toBe(true)
        expect(midEdges.edges).toEqual([{ source: 'start', target: 'prompt_7e57' }])

        expect(readPartialFlow(full)).toEqual({ ...parseReply(full).flow, name: undefined, nodesDone: true, nodes: parseReply(full).flow!.nodes })
    })

    it('copes with braces and quotes inside strings, code fences and nested data', () => {
        const text = '```json\n{"reply": "a } \\" ] {", "flow": {"name": "x", "nodes": [{"id": "start", "type": "start", "data": {"properties": [{"name": "a"}]}}, {"id": "text_template_aaaa", "type": "text_template", "data": {"template": "{start.a} }]"}}, {"id": "fin'
        const partial = readPartialFlow(text)!
        expect(partial.nodes.map(n => n.id)).toEqual(['start', 'text_template_aaaa'])
        expect(partial.nodes[1].data).toEqual({ template: '{start.a} }]' })
        expect(partial.edges).toEqual([])
    })
})

describe('previewFlow', () => {
    const existing = {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { thread: 'main' } },
            { id: 'prompt_aaaa', type: 'prompt', position: { x: 0, y: 160 }, data: { thread: 'main', name: 'Old' } },
        ],
        edges: [{ source: 'start', target: 'prompt_aaaa' }],
    }

    it('keeps steps the reply has not repeated yet, and lays out new ones under what they use', () => {
        const flow = previewFlow({ nodes: [{ id: 'start', type: 'start', data: {} }, { id: 'final_output_bbbb', type: 'final_output', data: { value: '{prompt_aaaa.assistant_raw_output}' } }], edges: [], nodesDone: false }, existing, opts)
        expect(flow.nodes.map(n => n.id).sort()).toEqual(['final_output_bbbb', 'prompt_aaaa', 'start'])
        expect(flow.edges.map(e => [e.source, e.target])).toEqual([['start', 'prompt_aaaa']])
        const y = (id: string) => flow.nodes.find(n => n.id == id)!.position.y
        expect(y('final_output_bbbb')).toBeGreaterThan(y('prompt_aaaa'))
    })

    it('drops steps the reply left out once its node list is complete', () => {
        const flow = previewFlow({ nodes: [{ id: 'start', type: 'start', data: {} }], edges: [], nodesDone: true }, existing, opts)
        expect(flow.nodes.map(n => n.id)).toEqual(['start'])
        expect(flow.edges).toEqual([])
    })

    it('keeps positions when no step is new', () => {
        const flow = previewFlow({ nodes: [{ id: 'start', type: 'start', data: {} }, { id: 'prompt_aaaa', type: 'prompt', data: { name: 'New' } }], edges: [], nodesDone: false }, existing, opts)
        expect(flow.nodes.find(n => n.id == 'prompt_aaaa')!.position).toEqual({ x: 0, y: 160 })
        expect(flow.nodes.find(n => n.id == 'prompt_aaaa')!.data.name).toBe('New')
    })
})
