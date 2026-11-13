import Decimal from "decimal.js-light";
import { providerFetch } from "../providers/http";

const BASE_URL = 'https://api.openai.com/v1'

/* ---------------- Embeddings ---------------- */

// From https://developers.openai.com/api/docs/guides/embeddings (read 2026-11-13).
export const embeddingModels = [
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small', description: 'Cheap and good for most search', pricePerMillion: 0.02 },
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large', description: 'Most accurate', pricePerMillion: 0.13 },
]

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
export const MAX_EMBEDDING_INPUTS = 500

export function embeddingCost(tokens: number, model: string): Decimal | null {
    const info = embeddingModels.find(x => x.id == model)
    return info ? new Decimal(tokens).mul(info.pricePerMillion).div(1_000_000) : null
}

export async function createEmbeddings(apiKey: string, model: string, input: string[], options: { dimensions?: number, signal?: AbortSignal } = {}) {
    const response = await providerFetch(`${BASE_URL}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input, encoding_format: 'float', ...(options.dimensions ? { dimensions: options.dimensions } : {}) }),
        signal: options.signal,
    }, 'OpenAI')
    const body = await response.json() as { data: { index: number, embedding: number[] }[], usage?: { total_tokens?: number } }
    const vectors = new Array<number[]>(input.length)
    for (const item of body.data) vectors[item.index] = item.embedding
    return { vectors, tokens: body.usage?.total_tokens ?? 0 }
}

export function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export type RankedDocument = { text: string, score: number, index: number }

/** Documents ordered from most to least similar to the query, top `limit` only. */
export function rankBySimilarity(query: number[], documents: { text: string, vector: number[] }[], limit: number): RankedDocument[] {
    return documents
        .map((doc, index) => ({ text: doc.text, index, score: Math.round(cosineSimilarity(query, doc.vector) * 10000) / 10000 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(limit, 1))
}

/** Test API stand-in: a bag-of-words vector, so documents sharing words with the query rank higher. */
export function fakeEmbedding(text: string, dimensions = 64): number[] {
    const vector = new Array(dimensions).fill(0)
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
        let hash = 0
        for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
        vector[hash % dimensions] += 1
    }
    return vector
}

/* ---------------- Transcription ---------------- */

// From https://developers.openai.com/api/docs/guides/speech-to-text (read 2026-11-13).
export const transcriptionModels = [
    { id: 'gpt-transcribe', label: 'GPT Transcribe', description: 'Recommended for recorded speech' },
]
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-transcribe'
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
export const AUDIO_TYPES = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']

export async function transcribe(apiKey: string, model: string, file: Blob, options: { filename?: string, prompt?: string, languages?: string[], signal?: AbortSignal } = {}) {
    if (file.size > MAX_AUDIO_BYTES) throw new Error(`The audio is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB`)
    const form = new FormData()
    form.append('file', file, options.filename || 'audio')
    form.append('model', model)
    if (options.prompt) form.append('prompt', options.prompt)
    for (const language of options.languages || []) form.append('languages[]', language)
    const response = await providerFetch(`${BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: options.signal,
    }, 'OpenAI')
    return await response.json() as { text: string, languages?: { code: string }[] }
}

/** Reads audio from a data URL or downloads it from an http(s) URL. */
export async function loadAudio(url: string, signal?: AbortSignal): Promise<{ blob: Blob, filename: string }> {
    const filename = url.startsWith('data:') ? 'audio' : (url.split('?')[0].split('/').pop() || 'audio')
    let response: Response
    try {
        response = await fetch(url, { signal })
    } catch {
        throw new Error("Could not load the audio. The site may block downloads from the browser (CORS); choose \"Ask for a file\" instead.")
    }
    if (!response.ok) throw new Error(`Could not load the audio (${response.status})`)
    return { blob: await response.blob(), filename }
}
