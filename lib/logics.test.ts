import { describe, expect, it } from 'vitest'
import { renderTextTemplate, replaceDynamicValueWithActual } from './logics'
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
