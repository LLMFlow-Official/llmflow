import { describe, expect, it } from 'vitest'
import { checkFlow } from './flow_check'
import type { AppNode } from './store'

const step = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { thread: 'main', ...data } }) as AppNode
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })
const everyKey = { canUse: () => true }

describe('checkFlow', () => {
    it('passes a complete flow', () => {
        const nodes = [
            step('start', 'start', { properties: [{ name: 'topic', type: 'text' }], propertyValues: { topic: 'cats' } }),
            step('prompt_1', 'prompt', { prompts: [{ role: 'user', content: 'About {start.topic}' }] }),
            step('final_output_1', 'final_output', { value: '{prompt_1.assistant_raw_output}' }),
        ]
        expect(checkFlow(nodes, [edge('start', 'prompt_1'), edge('prompt_1', 'final_output_1')], everyKey)).toEqual([])
    })

    it('finds missing settings, missing keys, broken references and steps that will not run', () => {
        const nodes = [
            step('start', 'start', { properties: [{ name: 'Topic', type: 'text' }], propertyValues: {} }),
            step('prompt_1', 'prompt', { provider: 'anthropic', name: 'Ask' }),
            step('final_output_1', 'final_output', { value: '{prompt_9.assistant_raw_output} {start.topic}' }),
            step('code_1', 'code'),
        ]
        const problems = checkFlow(nodes, [edge('start', 'prompt_1'), edge('prompt_1', 'final_output_1')], { canUse: (p) => p != 'anthropic' })
        const text = problems.map(p => `${p.severity} ${p.nodeId}: ${p.message}`)
        expect(text).toEqual(expect.arrayContaining([
            expect.stringMatching(/^error prompt_1: Write what to ask the model/),
            expect.stringMatching(/^error prompt_1: Add your Anthropic .*API key/),
            expect.stringMatching(/^error final_output_1: Uses \{prompt_9\.assistant_raw_output\}, but there is no step/),
            expect.stringMatching(/^warning code_1: .*isn't connected to Start/),
            expect.stringMatching(/^warning start: The input "Topic" is empty/),
        ]))
        expect(text.some(t => t.startsWith('error code_1'))).toBe(false)
    })

    it('checks branching steps: routes, names and conditions', () => {
        const nodes = [
            step('start', 'start'),
            step('decision_1', 'decision', { decisions: { a: { name: 'big', condition: '{start.n} >', type: 'normal' } } }),
            step('a', 'final_output', { value: 'x' }),
            step('b', 'final_output', { value: 'y' }),
        ]
        const problems = checkFlow(nodes, [edge('start', 'decision_1'), edge('decision_1', 'a'), edge('decision_1', 'b')], everyKey)
        expect(problems.map(p => p.message)).toEqual(expect.arrayContaining([
            expect.stringMatching(/not a valid expression/),
            expect.stringMatching(/Every branch needs a name and a condition/),
        ]))
    })
})
