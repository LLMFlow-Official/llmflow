import { describe, expect, it } from 'vitest'
import { Process as multiThread } from '@/components/nodes/multi_thread'
import type { AppNode } from './store'

describe('node process functions', () => {
    it('Multi Thread runs with an empty context and records its name', async () => {
        const context = {}
        const node = { id: 'multi_thread_1', type: 'multi_thread', position: { x: 0, y: 0 }, data: { name: 'Fan out' } } as AppNode
        const next = [{ id: 'a' }] as AppNode[]
        await expect(multiThread(context, node, next)).resolves.toBe(next)
        expect(context).toEqual({ multi_thread_1: { name: 'Fan out' } })
    })
})
