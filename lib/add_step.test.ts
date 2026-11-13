import { describe, expect, it } from 'vitest'
import { addStep, anchorStep, nextStepId, spotBelow } from '@/components/node_utils/add_step'
import { AppNode, useFlowStore } from './store'

const node = (id: string, x: number, y: number, extra: Partial<AppNode> = {}) => ({ id, type: 'prompt', position: { x, y }, data: { thread: 'main' }, ...extra }) as AppNode

describe('adding a step', () => {
    it('gives new steps short readable ids', () => {
        expect(nextStepId('prompt', [{ id: 'start' }])).toBe('prompt_1')
        expect(nextStepId('prompt', [{ id: 'prompt_1' }, { id: 'prompt_3' }])).toBe('prompt_2')
    })

    it('goes after the selected step, or the lowest step with nothing after it', () => {
        const nodes = [node('start', 0, 0), node('a', 0, 150), node('b', 300, 150, { selected: true })]
        expect(anchorStep(nodes, [])?.id).toBe('b')
        nodes[2].selected = false
        expect(anchorStep(nodes, [{ id: 'e', source: 'start', target: 'a' }])?.id).toBe('b')
    })

    it('finds a free spot below the anchor', () => {
        const anchor = node('a', 0, 0, { measured: { width: 150, height: 60 } })
        expect(spotBelow(anchor, [anchor])).toEqual({ x: 0, y: 150 })
        expect(spotBelow(anchor, [anchor, node('b', 0, 150)])).toEqual({ x: 240, y: 150 })
    })

    it('connects the new step after the last one and selects it', () => {
        useFlowStore.setState({ nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { thread: 'main' } } as AppNode], edges: [] })
        const id = addStep('prompt')
        const { nodes, edges } = useFlowStore.getState()
        expect(id).toBe('prompt_1')
        expect(edges.map(e => [e.source, e.target])).toEqual([['start', 'prompt_1']])
        expect(nodes.find(n => n.id == id)?.selected).toBe(true)
        expect(nodes.find(n => n.id == id)?.data.thread).toBe('main')
    })
})
