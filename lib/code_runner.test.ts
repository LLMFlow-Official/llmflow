import { describe, expect, it } from 'vitest'
import { expressionBody, exposedNames, exposedValues, isValidExpression } from './code_runner'
import { replaceDynamicValueWithValueRef, validateStatement } from './logics'

// Runs code the same way the worker does, so expression handling can be tested without a Worker.
async function runLikeWorker(code: string, context: Record<string, unknown>) {
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor
    const names = exposedNames(context)
    const fn = new AsyncFunction('context', ...names, `"use strict";\n${code}`)
    return fn(context, ...exposedValues(context, names))
}

const context = {
    start: { topic: 'cats', count: 3 },
    prompt_1a: { assistant_raw_output: 'Hello world' },
    state: { done: true },
}

describe('exposedNames', () => {
    it('exposes node ids as variables and always defines state', () => {
        expect(exposedNames(context)).toEqual(['start', 'prompt_1a', 'state'])
        expect(exposedNames({ start: {} })).toEqual(['start', 'state'])
    })

    it('skips keys that cannot be variable names', () => {
        expect(exposedNames({ 'bad-id': {}, delete: {}, context: {}, '1x': {}, ok: {} })).toEqual(['ok', 'state'])
    })
})

describe('isValidExpression', () => {
    it('accepts valid expressions without running them', () => {
        expect(isValidExpression('start.count == 3 && prompt_1a.assistant_raw_output.length > 2')).toBe(true)
        // Would throw if executed, but only compiles here
        expect(isValidExpression('undefinedThing.deep.value')).toBe(true)
    })

    it('rejects invalid syntax and empty text', () => {
        expect(isValidExpression('a ==')).toBe(false)
        expect(isValidExpression('   ')).toBe(false)
        expect(isValidExpression('1); alert(1); (1')).toBe(false)
    })
})

describe('statements as the worker runs them', () => {
    it('evaluates conditions with {node.key} references', async () => {
        const body = expressionBody(replaceDynamicValueWithValueRef('{start.count} = 3 && {prompt_1a.assistant_raw_output}.includes("world")'))
        expect(await runLikeWorker(body, context)).toBe(true)
    })

    it('reads Set State values through state', async () => {
        expect(await runLikeWorker(expressionBody('state.done'), context)).toBe(true)
        expect(await runLikeWorker(expressionBody('state.missing ?? "none"'), { start: {} })).toBe('none')
    })

    it('validates statements in the editor', () => {
        expect(validateStatement('{start.count} > 1')).toBe(true)
        expect(validateStatement('{start.count} >')).toBe(false)
    })
})
