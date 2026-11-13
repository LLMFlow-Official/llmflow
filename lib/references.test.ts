import { describe, expect, it } from 'vitest'
import { checkReferences, referenceOptions, stepsUsing } from './references'
import type { AppNode } from './store'

const step = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { thread: 'main', ...data } }) as AppNode
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

const nodes = [
    step('start', 'start', { properties: [{ name: 'Topic', type: 'text' }], propertyValues: {} }),
    step('prompt_1', 'prompt', { name: 'Summarize' }),
    step('prompt_2', 'prompt', { name: 'Tweets', prompts: [{ role: 'user', content: '{prompt_1.assistant_raw_output}' }] }),
    step('final_output_1', 'final_output'),
]
const edges = [edge('start', 'prompt_1'), edge('prompt_1', 'prompt_2'), edge('prompt_2', 'final_output_1')]

describe('references', () => {
    it('names references in plain words and flags the ones that will be empty', () => {
        const checks = checkReferences('About {start.topic}: {prompt_1.assistant_raw_output} {prompt_9.x} {final_output_1.value} {"json": 1}', 'prompt_2', nodes, edges)
        expect(checks).toEqual([
            { path: 'start.topic', label: 'Start → Topic', problem: undefined },
            { path: 'prompt_1.assistant_raw_output', label: 'Summarize → Answer', problem: undefined },
            { path: 'prompt_9.x', label: 'prompt_9.x', problem: 'unknown' },
            { path: 'final_output_1.value', label: 'Final Output → Value', problem: 'not_before' },
        ])
    })

    it('offers earlier steps, results first, with readable labels', () => {
        const options = referenceOptions('prompt_2', nodes, edges)
        expect(options.find(o => o.path == 'start.topic')?.label).toBe('Start → Topic')
        const summarize = options.filter(o => o.path.startsWith('prompt_1.'))
        expect(summarize[0]).toMatchObject({ path: 'prompt_1.assistant_raw_output', label: 'Summarize → Answer' })
    })

    it('finds the steps that use a step being deleted', () => {
        expect(stepsUsing(['prompt_1'], nodes).map(n => n.id)).toEqual(['prompt_2'])
        expect(stepsUsing(['prompt_2'], nodes)).toEqual([])
    })
})
