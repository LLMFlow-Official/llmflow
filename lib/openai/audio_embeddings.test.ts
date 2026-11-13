import { describe, expect, it } from 'vitest'
import { cosineSimilarity, embeddingCost, fakeEmbedding, rankBySimilarity } from './audio_embeddings'

describe('cosineSimilarity', () => {
    it('is 1 for the same direction, 0 for unrelated and safe for zero vectors', () => {
        expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 10)
        expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
        expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    })
})

describe('rankBySimilarity', () => {
    it('orders documents by similarity and keeps the top ones', () => {
        const docs = ['cats sleep all day', 'stock market news', 'my cat likes to sleep'].map(text => ({ text, vector: fakeEmbedding(text) }))
        const ranked = rankBySimilarity(fakeEmbedding('when do cats sleep'), docs, 2)
        expect(ranked.map(x => x.index)).toEqual([0, 2])
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    })
})

describe('embeddingCost', () => {
    it('prices per million tokens and is unknown for other models', () => {
        expect(embeddingCost(1_000_000, 'text-embedding-3-small')?.toNumber()).toBe(0.02)
        expect(embeddingCost(10, 'custom')).toBeNull()
    })
})
