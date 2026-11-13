import { describe, expect, it } from 'vitest'
import { AppNode, useFlowStore, useRuntimeStore } from './store'

const node = (id: string, data: Record<string, unknown> = {}, x = 0) => ({ id, type: 'prompt', position: { x, y: 0 }, data: { thread: 'main', ...data } }) as AppNode

describe('run marks on the canvas', () => {
    it('stay when steps are selected or moved, and clear when the flow is edited', () => {
        const a = node('a', { name: 'A' })
        const b = node('b')
        useFlowStore.setState({ nodes: [a, b], edges: [{ id: 'e', source: 'a', target: 'b' }] })
        useRuntimeStore.setState({ isRunning: false, nodeStates: { a: 'completed', b: 'failed' } })

        useFlowStore.setState({ nodes: [{ ...a, selected: true, position: { x: 50, y: 10 } }, b] })
        expect(useRuntimeStore.getState().nodeStates).toEqual({ a: 'completed', b: 'failed' })

        useFlowStore.setState({ nodes: [{ ...a, data: { ...a.data, name: 'Renamed' } }, b] })
        expect(useRuntimeStore.getState().nodeStates).toEqual({})
    })

    it('clear when a connection changes, but not while a run is going', () => {
        useFlowStore.setState({ nodes: [node('a'), node('b')], edges: [] })
        useRuntimeStore.setState({ isRunning: true, nodeStates: { a: 'running' } })
        useFlowStore.setState({ edges: [{ id: 'e', source: 'a', target: 'b' }] })
        expect(useRuntimeStore.getState().nodeStates).toEqual({ a: 'running' })

        useRuntimeStore.setState({ isRunning: false, nodeStates: { a: 'completed' } })
        useFlowStore.setState({ edges: [] })
        expect(useRuntimeStore.getState().nodeStates).toEqual({})
    })
})
