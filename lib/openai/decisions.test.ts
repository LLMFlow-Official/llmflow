import { describe, expect, it } from 'vitest'
import {
    buildDecisionsPayload, decisionsCost, DecisionQuestion, nearestLevel, normalizeDecisionsUsage, parseDecisionsResponse,
    questionProblems, sampleDecisions, ScoreAnswer,
} from './decisions'

const predicate: DecisionQuestion = { name: 'is_spam', type: 'predicate', instructions: 'The message is spam.' }
const choice: DecisionQuestion = {
    name: 'department', type: 'choice', instructions: 'Which team handles this?',
    choices: [{ value: 'billing', description: 'Payments' }, { value: 'support' }, { value: 'other', description: 'Anything else' }],
}
const score: DecisionQuestion = {
    name: 'severity', type: 'score', instructions: 'How severe is it?',
    levels: [{ label: 'low' }, { label: 'medium' }, { label: 'high', description: 'Blocks work' }],
}

describe('questionProblems', () => {
    it('accepts well-formed questions', () => {
        expect(questionProblems([predicate, choice, score])).toEqual([])
    })

    it('reports missing, duplicate, reserved and malformed names', () => {
        expect(questionProblems([])).toContain('Add at least one question.')
        expect(questionProblems([{ ...predicate, name: '' }])).toContain('Give every question a name.')
        expect(questionProblems([predicate, predicate])).toContain('Question names must be different ("is_spam" is used twice).')
        expect(questionProblems([{ ...predicate, name: 'answers' }])[0]).toMatch(/can't be a question name/)
        expect(questionProblems([{ ...predicate, name: '1st' }])[0]).toMatch(/start with a letter/)
    })

    it('needs instructions, two distinct choices and 2-10 levels', () => {
        expect(questionProblems([{ ...predicate, instructions: ' ' }])).toEqual(['"is_spam" needs instructions (what to decide).'])
        expect(questionProblems([{ ...choice, choices: [{ value: 'a' }] }])).toEqual(['"department" needs at least two choices.'])
        expect(questionProblems([{ ...choice, choices: [{ value: 'a' }, { value: 'a' }] }])).toEqual(['"department" has the same choice twice.'])
        expect(questionProblems([{ ...score, levels: [{ label: 'only' }] }])).toEqual(['"severity" needs 2 to 10 levels.'])
        expect(questionProblems([{ ...score, levels: Array.from({ length: 11 }, (_, i) => ({ label: `l${i}` })) }])).toHaveLength(1)
    })
})

describe('buildDecisionsPayload', () => {
    it('sends plain text input as a string, with typed questions', () => {
        const payload = buildDecisionsPayload({ text: ' Hello ', questions: [predicate, choice, score] })
        expect(payload).toEqual({
            model: 'gpt-6-luna',
            input: 'Hello',
            questions: [
                { name: 'is_spam', type: 'predicate', instructions: 'The message is spam.' },
                {
                    name: 'department', type: 'choice', instructions: 'Which team handles this?',
                    choices: [{ value: 'billing', description: 'Payments' }, { value: 'support', description: 'support' }, { value: 'other', description: 'Anything else' }],
                },
                {
                    name: 'severity', type: 'score', instructions: 'How severe is it?',
                    levels: [{ label: 'low', description: 'low' }, { label: 'medium', description: 'medium' }, { label: 'high', description: 'Blocks work' }],
                },
            ],
        })
    })

    it('uses messages for shared instructions, JSON data and images', () => {
        const payload = buildDecisionsPayload({
            text: 'Check this order',
            instructions: 'You review orders.',
            json: { role: 'admin', items: [1, 2] },
            images: ['https://example.com/a.png', ''],
            questions: [predicate],
            cacheKey: ' orders ',
        })
        expect(payload.input).toEqual([
            { role: 'developer', content: [{ type: 'input_text', text: 'You review orders.' }] },
            {
                role: 'user', content: [
                    { type: 'input_text', text: 'Check this order' },
                    { type: 'input_json', data: { role: 'admin', items: [1, 2] } },
                    { type: 'input_image', image_url: 'https://example.com/a.png' },
                ],
            },
        ])
        expect(payload.prompt_cache_key).toBe('orders')
    })

    it('puts a question image into its instructions', () => {
        const payload = buildDecisionsPayload({ text: 'x', questions: [{ ...predicate, image: 'data:image/png;base64,AAAA' }] })
        expect(payload.questions[0].instructions).toEqual([
            { type: 'input_text', text: 'The message is spam.' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        ])
    })

    it('rejects missing input, bad images, non-object JSON and bad questions', () => {
        expect(() => buildDecisionsPayload({ text: ' ', questions: [predicate] })).toThrow(/Add the input/)
        expect(() => buildDecisionsPayload({ text: 'x', images: ['not a url'], questions: [predicate] })).toThrow(/Image input must be/)
        expect(() => buildDecisionsPayload({ text: 'x', json: 5 as unknown as object, questions: [predicate] })).toThrow(/object or a list/)
        expect(() => buildDecisionsPayload({ text: 'x', questions: [] })).toThrow('Add at least one question.')
    })
})

describe('parseDecisionsResponse', () => {
    it('matches answers by name and takes each main value', () => {
        const parsed = parseDecisionsResponse({
            answers: [
                { type: 'score', name: 'severity', score: 1.1, confidence: 0.7, probabilities: [{ value: 0, label: 'low', probability: 0.1 }, { value: 1, label: 'medium', probability: 0.7 }, { value: 2, label: 'high', probability: 0.2 }] },
                { type: 'predicate', name: 'is_spam', probability: 0.92 },
                { type: 'refusal', name: 'department' },
            ],
        }, [predicate, choice, score])
        expect(parsed.values).toEqual({ is_spam: 0.92, department: null, severity: 1.1 })
        expect(parsed.refused).toEqual(['department'])
        expect(nearestLevel(parsed.answers.severity as ScoreAnswer)).toBe('medium')
    })

    it('fails when a question has no answer', () => {
        expect(() => parseDecisionsResponse({ answers: [] }, [predicate])).toThrow('OpenAI returned no answer for "is_spam"')
    })
})

describe('usage and cost', () => {
    it('splits cached and cache-write tokens out of input and charges nothing for output', () => {
        const usage = normalizeDecisionsUsage({ input_tokens: 3000, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 500 }, output_tokens: 40 })
        expect(usage).toEqual({ input: 1500, cachedInput: 1000, cacheWrite: 500, output: 0 })
        // (1500 + 500) * $0.10 + 1000 * $0.01, per million tokens
        expect(decisionsCost(usage)?.toNumber()).toBeCloseTo(0.00021, 10)
    })
})

describe('sampleDecisions', () => {
    it('uses given sample values and sensible defaults', () => {
        const defaults = parseDecisionsResponse(sampleDecisions([predicate, choice, score]), [predicate, choice, score])
        expect(defaults.values).toEqual({ is_spam: 0.8, department: 'billing', severity: 1 })

        const given = parseDecisionsResponse(sampleDecisions([predicate, choice, score], { is_spam: 0.1, department: 'other', severity: 1.6 }), [predicate, choice, score])
        expect(given.values).toEqual({ is_spam: 0.1, department: 'other', severity: 1.6 })
        // The level probabilities average back to the score.
        const answer = given.answers.severity as ScoreAnswer
        expect(answer.probabilities.reduce((sum, p) => sum + p.value * p.probability, 0)).toBeCloseTo(1.6)
        expect(nearestLevel(answer)).toBe('high')
    })

    it('ignores a sample choice that is not one of the choices', () => {
        expect(parseDecisionsResponse(sampleDecisions([choice], { department: 'nope' }), [choice]).values.department).toBe('billing')
    })
})
