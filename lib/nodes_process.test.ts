import { describe, expect, it } from 'vitest'
import { Process as multiThread } from '@/components/nodes/multi_thread'
import { Process as aiDecisions } from '@/components/nodes/ai_decisions'
import { useSettingStore } from './store'
import type { AppNode } from './store'
import type { Controller } from './nodes'

describe('node process functions', () => {
    it('Multi Thread runs with an empty context and records its name', async () => {
        const context = {}
        const node = { id: 'multi_thread_1', type: 'multi_thread', position: { x: 0, y: 0 }, data: { name: 'Fan out' } } as AppNode
        const next = [{ id: 'a' }] as AppNode[]
        await expect(multiThread(context, node, next)).resolves.toBe(next)
        expect(context).toEqual({ multi_thread_1: { name: 'Fan out' } })
    })

    it('AI Decisions answers every question with sample answers and exposes each value', async () => {
        useSettingStore.setState({ sampleAnswers: true })
        const logs: unknown[] = []
        const controller = { log: (x: unknown) => logs.push(x), increaseInToken: () => {}, increaseOutToken: () => {}, increaseAmount: () => {} } as unknown as Controller
        const context: Record<string, Record<string, unknown>> = { start: { ticket: 'Checkout is down' } }
        const node = {
            id: 'ai_decisions_1', type: 'ai_decisions', position: { x: 0, y: 0 },
            data: {
                name: 'Triage', input: '{start.ticket}',
                questions: [
                    { name: 'is_urgent', type: 'predicate', instructions: 'Is it urgent? {start.ticket}' },
                    { name: 'team', type: 'choice', instructions: 'Which team?', choices: [{ value: 'billing' }, { value: 'technical' }] },
                ],
                test_output: '{"team": "technical"}',
            },
        } as unknown as AppNode
        const next = [{ id: 'a' }] as AppNode[]
        await expect(aiDecisions(context as never, node as never, next, controller)).resolves.toBe(next)
        expect(context.ai_decisions_1).toMatchObject({ name: 'Triage', is_urgent: 0.8, team: 'technical', refused: [] })
        expect(logs).toEqual([expect.objectContaining({ type: 'success', title: 'Answered 2 questions' })])
    })
})
