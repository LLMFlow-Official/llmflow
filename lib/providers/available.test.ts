import { describe, expect, it } from 'vitest'
import { availableModels, availableProviders } from './index'
import { isModelOnAccount, modelsFor } from '../openai/models'

const settings = (patch: Partial<Parameters<typeof availableModels>[1]> = {}) => ({
    sampleAnswers: false, devMode: undefined, apiKeys: { openai: '', anthropic: '', google: '', compatible: '' }, compatibleBaseUrl: '', accountModels: {}, ...patch,
})

describe('available providers and models', () => {
    it('offers every provider and model in mock mode', () => {
        const s = settings({ sampleAnswers: true, accountModels: { openai: ['gpt-5.5'] } })
        expect(availableProviders(s)).toEqual(['openai', 'anthropic', 'google', 'compatible'])
        expect(availableModels('openai', s)).toEqual(modelsFor('openai'))
    })

    it('offers only providers with a key and models on the account otherwise', () => {
        const s = settings({ apiKeys: { openai: 'sk', anthropic: '', google: '', compatible: '' }, accountModels: { openai: ['gpt-5.5', 'gpt-4.1-2025-04-14'] } })
        expect(availableProviders(s)).toEqual(['openai'])
        expect(availableModels('openai', s).map(m => m.id)).toEqual(['gpt-5.5', 'gpt-4.1'])
    })

    it('keeps the built-in list until the account list has loaded', () => {
        expect(availableModels('anthropic', settings())).toEqual(modelsFor('anthropic'))
    })

    it('matches dated snapshots but not longer model names', () => {
        expect(isModelOnAccount('gpt-4.1', ['gpt-4.1-2025-04-14'])).toBe(true)
        expect(isModelOnAccount('claude-haiku-5-5', ['claude-haiku-5-5-20260301'])).toBe(true)
        expect(isModelOnAccount('gpt-4.1', ['gpt-4.1-mini'])).toBe(false)
    })
})
