import { describe, expect, it } from 'vitest'
import { connectionProblem } from './connections'

const step = (id: string, type: string, thread = 'main', name?: string) => ({ id, type, data: { thread, ...(name ? { name } : {}) } })
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

describe('connectionProblem', () => {
    const nodes = [step('start', 'start'), step('a', 'prompt', 'main', 'Summarize'), step('b', 'prompt'), step('c', 'final_output')]

    it('allows a step to lead to a step with nothing before it', () => {
        expect(connectionProblem('start', 'a', nodes, [])).toBeNull()
        expect(connectionProblem('a', 'b', nodes, [edge('start', 'a')])).toBeNull()
    })

    it('explains why a normal step cannot have two next steps', () => {
        expect(connectionProblem('a', 'c', nodes, [edge('a', 'b')])).toMatch(/"Summarize" already has a next step.*Run in parallel/)
    })

    it('lets branching steps have several next steps', () => {
        const flow = [...nodes, step('d', 'decision')]
        expect(connectionProblem('d', 'c', flow, [edge('d', 'b')])).toBeNull()
    })

    it('refuses loops back, connecting into Start and connecting a step to itself', () => {
        expect(connectionProblem('b', 'a', nodes, [edge('a', 'b')])).toMatch(/loop back/)
        expect(connectionProblem('a', 'start', nodes, [])).toMatch(/Start/)
        expect(connectionProblem('a', 'a', nodes, [])).toMatch(/itself/)
    })

    it('only lets Wait for all join the branches of its Run in parallel step', () => {
        const flow = [step('p', 'multi_thread', 'main'), step('x', 'prompt', 't1'), step('y', 'prompt', 't2'), step('w', 'thread_merge', 'main'), step('z', 'prompt', 'other')]
        const edges = [edge('p', 'x'), edge('p', 'y'), edge('x', 'w')]
        expect(connectionProblem('y', 'w', flow, edges)).toBeNull()
        expect(connectionProblem('z', 'w', flow, edges)).toMatch(/only joins/)
    })
})
