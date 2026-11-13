import { describe, expect, it } from 'vitest'
import { renderTextTemplate, replaceDynamicValueWithActual, resolveList, resolveTemplateValue } from './logics'
import { AppContext } from './nodes'

const context: AppContext = {
    start: { topic: 'cats', count: 3 },
    prompt_1a2b3c: { assistant_raw_output: 'Hello', assistant_json_output: { a: 1, b: ['x'] } },
    state: { done: 'true' },
}

describe('renderTextTemplate', () => {
    it('fills value references', () => {
        expect(renderTextTemplate('Write about {start.topic} in {start.count} lines', context)).toBe('Write about cats in 3 lines')
        expect(renderTextTemplate('{prompt_1a2b3c.assistant_raw_output}!', context)).toBe('Hello!')
        expect(renderTextTemplate('Done: {state.done}', context)).toBe('Done: true')
    })

    it('reads nested values', () => {
        expect(renderTextTemplate('{prompt_1a2b3c.assistant_json_output.a}', context)).toBe('1')
    })

    it('keeps "=" unchanged', () => {
        expect(renderTextTemplate('If x = 1 and y == 2 then a => b', context)).toBe('If x = 1 and y == 2 then a => b')
    })

    it('leaves JSON examples and other braces alone', () => {
        const text = 'Reply like {"name": "Ann", "tags": {"a": 1}} or {name} or {user.name}'
        expect(renderTextTemplate(text, context)).toBe(text)
    })

    it('turns objects into JSON', () => {
        expect(renderTextTemplate('{prompt_1a2b3c.assistant_json_output}', context)).toBe(JSON.stringify({ a: 1, b: ['x'] }, null, 2))
    })

    it('turns references to nodes that did not run into an empty string', () => {
        expect(renderTextTemplate('[{prompt_ffff00.assistant_raw_output}]', context)).toBe('[]')
        expect(renderTextTemplate('[{start.missing}]', context)).toBe('[]')
    })

    it('handles empty text', () => {
        expect(renderTextTemplate('', context)).toBe('')
    })
})

describe('replaceDynamicValueWithActual (used for conditions)', () => {
    it('still rewrites "=" to "==" for expressions', () => {
        expect(replaceDynamicValueWithActual('{start.count} = 3', context)).toBe('3 == 3')
    })
})

describe('resolveList', () => {
    const ctx = { split_1a: { chunks: ['a', 'b'] }, start: { text: '["x", 2]', lines: 'one\n\n two \n' } } as unknown as AppContext

    it('uses an array reference as is', () => {
        expect(resolveList('{split_1a.chunks}', ctx)).toEqual(['a', 'b'])
    })

    it('parses JSON arrays and splits other text into lines', () => {
        expect(resolveList('{start.text}', ctx)).toEqual(['x', 2])
        expect(resolveList('{start.lines}', ctx)).toEqual(['one', 'two'])
        expect(resolveList('red\nblue', ctx)).toEqual(['red', 'blue'])
    })

    it('returns an empty list for missing values', () => {
        expect(resolveList('{split_1a.missing}', ctx)).toEqual([])
        expect(resolveList('', ctx)).toEqual([])
    })
})

describe('resolveTemplateValue', () => {
    it('keeps objects for single references and fills text otherwise', () => {
        const ctx = { code_1a: { result: { n: 1 } } } as unknown as AppContext
        expect(resolveTemplateValue('{code_1a.result}', ctx)).toEqual({ n: 1 })
        expect(resolveTemplateValue('n={code_1a.result.n}', ctx)).toBe('n=1')
        expect(resolveTemplateValue('{"a": 1}', ctx)).toBe('{"a": 1}')
    })
})
