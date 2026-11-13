import { describe, expect, it } from 'vitest'
import { getModelStatus, resolveReplacement, supportsSampling, usageToCost } from './models'

const usage = (input: number, output: number, cached = 0) => ({
    input_tokens: input,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output,
    total_tokens: input + output,
})

describe('usageToCost', () => {
    it('prices input and output separately', () => {
        // gpt-4o: $2.50 in, $10 out per 1M (no long-context rate)
        expect(usageToCost(usage(1_000_000, 1_000_000), 'gpt-4o')?.toNumber()).toBe(12.5)
        // gpt-6.1-terra: $1 in, $5 out per 1M
        expect(usageToCost(usage(100_000, 10_000), 'gpt-6.1-terra')?.toNumber()).toBeCloseTo(0.1 + 0.05, 10)
    })

    it('bills cached input at the cached rate', () => {
        // gpt-6.1-sol: $2 in, $0.10 cached, $10 out per 1M
        const cost = usageToCost(usage(200_000, 0, 80_000), 'gpt-6.1-sol')
        expect(cost?.toNumber()).toBeCloseTo(120_000 * 2 / 1e6 + 80_000 * 0.10 / 1e6, 10)
    })

    it('uses long-context prices above 272K input tokens', () => {
        // gpt-6-astra long context: $20 in, $75 out per 1M
        expect(usageToCost(usage(300_000, 1_000), 'gpt-6-astra')?.toNumber()).toBeCloseTo(300_000 * 20 / 1e6 + 1_000 * 75 / 1e6, 10)
        // exactly at the threshold stays on standard prices
        expect(usageToCost(usage(272_000, 0), 'gpt-6-astra')?.toNumber()).toBeCloseTo(272_000 * 10 / 1e6, 10)
    })

    it('falls back to standard prices when a model has no long-context rate', () => {
        expect(usageToCost(usage(500_000, 0), 'gpt-4.1')?.toNumber()).toBeCloseTo(1, 10)
    })

    it('returns null for models without known prices', () => {
        expect(usageToCost(usage(10, 10), 'some-custom-model')).toBeNull()
        expect(usageToCost(usage(10, 10), 'gpt-3.5-turbo')).toBeNull()
    })

    it('handles missing usage details', () => {
        expect(usageToCost({ input_tokens: 200_000, output_tokens: 0, total_tokens: 200_000 }, 'gpt-6-luna')?.toNumber()).toBeCloseTo(0.02, 10)
    })
})

describe('model status', () => {
    const today = new Date('2026-11-13')

    it('reports shut-down models with a replacement that is in the registry', () => {
        expect(getModelStatus('gpt-4-32k', today)).toEqual({ kind: 'retired', shutdownDate: '2025-06-06', replacement: 'gpt-6-luna' })
        expect(getModelStatus('gpt-3.5-turbo-0613', today)).toEqual({ kind: 'retired', shutdownDate: '2024-09-13', replacement: 'gpt-5.6-terra' })
    })

    it('keeps replacements that are outside the registry', () => {
        expect(resolveReplacement('chatgpt-4o-latest')).toBe('gpt-5.1-chat-latest')
    })

    it('reports deprecated models until their shutdown date, then retired', () => {
        expect(getModelStatus('gpt-4o', today)).toMatchObject({ kind: 'deprecated', shutdownDate: '2027-01-14', replacement: 'gpt-6-luna' })
        expect(getModelStatus('gpt-4o', new Date('2027-01-15'))).toMatchObject({ kind: 'retired' })
    })

    it('reports current and unknown models', () => {
        expect(getModelStatus('gpt-6.1-sol', today)).toEqual({ kind: 'ok' })
        expect(getModelStatus('my-fine-tune', today)).toEqual({ kind: 'unknown' })
    })
})

describe('supportsSampling', () => {
    it('allows temperature on non-reasoning models', () => {
        expect(supportsSampling('gpt-4.1')).toBe(true)
    })

    it('allows temperature on reasoning models only with effort "none"', () => {
        expect(supportsSampling('gpt-6-luna')).toBe(false)
        expect(supportsSampling('gpt-6-luna', 'low')).toBe(false)
        expect(supportsSampling('gpt-6-luna', 'none')).toBe(true)
    })

    it('leaves custom models to the user', () => {
        expect(supportsSampling('my-fine-tune')).toBe(true)
    })
})
