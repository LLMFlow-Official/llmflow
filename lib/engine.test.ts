import { describe, expect, it } from 'vitest'
import { EngineEdge, EngineHooks, EngineNode, ProcessFn, runFlow, validateGraph } from './engine'
import type { AppContext, NodeState } from './nodes'

const node = (id: string, type = 'step', data: Record<string, unknown> = {}): EngineNode => ({ id, type, data })
const edge = (source: string, target: string): EngineEdge => ({ id: `${source}->${target}`, source, target })

/** Builds hooks around a map of process functions and records what happened. */
function setup(processes: Record<string, ProcessFn>, options: { bodyTargets?: Record<string, string[]>, running?: () => boolean } = {}) {
    const states: Record<string, NodeState> = {}
    const order: string[] = []
    const errors: string[] = []
    const logs: string[] = []
    const passThrough: ProcessFn = async (context, n, next) => {
        order.push(n.id)
        context[n.id] = { ran: 'yes' }
        return next
    }
    const hooks: EngineHooks = {
        getProcess: (type) => processes[type] || passThrough,
        getBodyTargets: (n) => options.bodyTargets?.[n.id] || [],
        setNodeState: (id, state) => { states[id] = state },
        isRunning: options.running || (() => true),
        controller: {
            log: (entry) => { logs.push(entry.title) },
            increaseInToken: () => { },
            increaseOutToken: () => { },
            increaseAmount: () => { },
        },
        onNodeError: (n, error) => { errors.push(`${n.id}: ${error.message}`) },
        wait: async () => true,
    }
    return { hooks, states, order, errors, logs, passThrough }
}

describe('runFlow', () => {
    it('runs a chain in order', async () => {
        const nodes = [node('start'), node('a'), node('b')]
        const { hooks, states, order } = setup({})
        await runFlow('start', {}, nodes, [edge('start', 'a'), edge('a', 'b')], hooks)
        expect(order).toEqual(['start', 'a', 'b'])
        expect(states).toEqual({ start: 'completed', a: 'completed', b: 'completed' })
    })

    it('skips branches that were not chosen, and everything after them', async () => {
        const nodes = [node('start'), node('pick', 'pick'), node('yes'), node('no'), node('after_no')]
        const { hooks, states, order } = setup({
            pick: async (_c, _n, next) => next.filter(x => x.id == 'yes'),
        })
        await runFlow('start', {}, nodes, [edge('start', 'pick'), edge('pick', 'yes'), edge('pick', 'no'), edge('no', 'after_no')], hooks)
        expect(order).toEqual(['start', 'yes'])
        expect(states.no).toBe('skipped')
        expect(states.after_no).toBe('skipped')
    })

    it('runs a merge once, after every input has finished or been skipped', async () => {
        const nodes = [node('start'), node('pick', 'pick'), node('slow', 'slow'), node('fast'), node('unused'), node('merge')]
        const ran: string[] = []
        const { hooks, states } = setup({
            pick: async (_c, _n, next) => next.filter(x => x.id != 'unused'),
            slow: async (_c, n, next) => { await new Promise(r => setTimeout(r, 20)); ran.push(n.id); return next },
            step: async (_c, n, next) => { ran.push(n.id); return next },
        })
        const edges = [edge('start', 'pick'), edge('pick', 'slow'), edge('pick', 'fast'), edge('pick', 'unused'),
            edge('slow', 'merge'), edge('fast', 'merge'), edge('unused', 'merge')]
        await runFlow('start', {}, nodes, edges, hooks)
        expect(ran.filter(x => x == 'merge')).toHaveLength(1)
        expect(ran.indexOf('merge')).toBeGreaterThan(ran.indexOf('slow'))
        expect(states.unused).toBe('skipped')
        expect(states.merge).toBe('completed')
    })

    it('skips a merge when all of its inputs are skipped', async () => {
        const nodes = [node('start'), node('pick', 'pick'), node('a'), node('b'), node('merge')]
        const { hooks, states } = setup({ pick: async () => [] })
        await runFlow('start', {}, nodes, [edge('start', 'pick'), edge('pick', 'a'), edge('pick', 'b'), edge('a', 'merge'), edge('b', 'merge')], hooks)
        expect(states.merge).toBe('skipped')
    })

    it('reports a failure, skips what follows it, and keeps other branches running', async () => {
        const nodes = [node('start'), node('split', 'split'), node('bad', 'bad'), node('after_bad'), node('good')]
        const { hooks, states, errors, order } = setup({
            bad: async () => { throw new Error('boom') },
        })
        await runFlow('start', {}, nodes, [edge('start', 'split'), edge('split', 'bad'), edge('split', 'good'), edge('bad', 'after_bad')], hooks)
        expect(errors).toEqual(['bad: boom'])
        expect(states.bad).toBe('failed')
        expect(states.after_bad).toBe('skipped')
        expect(order).toContain('good')
    })

    it('retries a failing node', async () => {
        let calls = 0
        const nodes = [node('start'), node('flaky', 'flaky', { on_error: { retries: 2 } })]
        const { hooks, states, logs } = setup({
            flaky: async (_c, _n, next) => { calls++; if (calls < 3) throw new Error(`try ${calls}`); return next },
        })
        await runFlow('start', {}, nodes, [edge('start', 'flaky')], hooks)
        expect(calls).toBe(3)
        expect(states.flaky).toBe('completed')
        expect(logs.filter(x => x.startsWith('Attempt'))).toHaveLength(2)
    })

    it('gives up after the last retry', async () => {
        let calls = 0
        const nodes = [node('start'), node('flaky', 'flaky', { on_error: { retries: 1 } })]
        const { hooks, errors } = setup({ flaky: async () => { calls++; throw new Error('nope') } })
        await runFlow('start', {}, nodes, [edge('start', 'flaky')], hooks)
        expect(calls).toBe(2)
        expect(errors).toEqual(['flaky: nope'])
    })

    it('continues after a failure when asked, with the error as an output', async () => {
        const context: AppContext = {}
        const nodes = [node('start'), node('bad', 'bad', { on_error: { continue: true } }), node('next')]
        const { hooks, states, errors } = setup({ bad: async () => { throw new Error('rate limited') } })
        await runFlow('start', context, nodes, [edge('start', 'bad'), edge('bad', 'next')], hooks)
        expect(errors).toEqual([])
        expect(states.bad).toBe('failed')
        expect(states.next).toBe('completed')
        expect(context.bad.error).toBe('rate limited')
    })

    it('runs a loop body through runBranch, isolated from the outer flow', async () => {
        const seen: unknown[] = []
        const nodes = [node('start'), node('loop', 'loop'), node('body', 'body'), node('body2', 'body'), node('after')]
        const { hooks, states, order } = setup({
            loop: async (context, n, next, controller) => {
                for (const item of [1, 2, 3]) {
                    const iteration = { ...context, loop: { item } } as AppContext
                    await controller.runBranch(['body'], iteration)
                }
                return next.filter(x => x.id == 'after')
            },
            body: async (context, n, next) => { seen.push(`${n.id}:${context.loop.item}`); return next },
        }, { bodyTargets: { loop: ['body'] } })
        await runFlow('start', {}, nodes, [edge('start', 'loop'), edge('loop', 'body'), edge('body', 'body2'), edge('loop', 'after')], hooks)
        expect(seen).toEqual(['body:1', 'body2:1', 'body:2', 'body2:2', 'body:3', 'body2:3'])
        expect(order).toContain('after')
        expect(states.body).toBe('completed')
    })

    it('stops the loop when a body node fails', async () => {
        const nodes = [node('start'), node('loop', 'loop'), node('body', 'bad'), node('after')]
        const { hooks, errors, states } = setup({
            loop: async (context, n, next, controller) => {
                await controller.runBranch(['body'], context)
                return next
            },
            bad: async () => { throw new Error('item broke') },
        }, { bodyTargets: { loop: ['body'] } })
        await runFlow('start', {}, nodes, [edge('start', 'loop'), edge('loop', 'body'), edge('loop', 'after')], hooks)
        expect(errors).toEqual(['body: item broke', 'loop: item broke'])
        expect(states.after).toBe('skipped')
    })

    it('does not start nodes after the run is stopped', async () => {
        let running = true
        const nodes = [node('start'), node('stopper', 'stopper'), node('never')]
        const { hooks, order } = setup({
            stopper: async (_c, _n, next) => { running = false; return next },
        }, { running: () => running })
        await runFlow('start', {}, nodes, [edge('start', 'stopper'), edge('stopper', 'never')], hooks)
        expect(order).not.toContain('never')
    })
})

describe('validateGraph', () => {
    it('accepts a normal flow', () => {
        expect(validateGraph('start', [node('start'), node('a')], [edge('start', 'a')])).toBeNull()
    })

    it('rejects a cycle', () => {
        const nodes = [node('start'), node('a', 'step', { name: 'Ask' }), node('b')]
        expect(validateGraph('start', nodes, [edge('start', 'a'), edge('a', 'b'), edge('b', 'a')])).toMatch(/loops back to "(Ask|b)"/)
    })

    it('rejects loop body steps that are also connected from outside', () => {
        const nodes = [node('start'), node('loop', 'loop', { name: 'Each' }), node('body', 'step', { name: 'Body' }), node('after')]
        const edges = [edge('start', 'loop'), edge('loop', 'body'), edge('loop', 'after'), edge('after', 'body')]
        expect(validateGraph('start', nodes, edges, (n) => n.id == 'loop' ? ['body'] : [])).toMatch(/"Body" is inside the loop "Each"/)
    })

    it('rejects a cycle inside a loop body', () => {
        const nodes = [node('start'), node('loop', 'loop'), node('x'), node('y')]
        const edges = [edge('start', 'loop'), edge('loop', 'x'), edge('x', 'y'), edge('y', 'x')]
        expect(validateGraph('start', nodes, edges, (n) => n.id == 'loop' ? ['x'] : [])).toMatch(/inside the loop/)
    })
})
