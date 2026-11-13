import Decimal from "decimal.js-light";
import { costOf, NormalizedUsage } from "./models";
import { providerFetch } from "../providers/http";

/*
 * OpenAI Decisions API (POST /v1/decisions): typed answers (yes/no, pick one, rating) to many questions
 * about one shared input, in a single fast request.
 * From https://developers.openai.com/api/docs/guides/decisions (read 2026-11-13).
 */

export const DECISIONS_MODEL = 'gpt-6-luna'
export const MAX_QUESTIONS = 400
export const MIN_LEVELS = 2
export const MAX_LEVELS = 10

export type QuestionType = 'predicate' | 'choice' | 'score'

/** A question as the step stores it. Text fields may hold {node.output} references. */
export type DecisionQuestion = {
    name: string
    type: QuestionType
    instructions?: string
    /** Optional image (URL, data URL or reference) sent with the instructions. */
    image?: string
    /** choice: the values to pick from. */
    choices?: { value: string, description?: string }[]
    /** score: ordered levels, lowest first. */
    levels?: { label: string, description?: string }[]
}

type TextPart = { type: 'input_text', text: string }
type ImagePart = { type: 'input_image', image_url: string }
type JsonPart = { type: 'input_json', data: object }

export type DecisionsInputItem =
    | { role: 'developer', content: TextPart[] }
    | { role: 'user', content: (TextPart | ImagePart | JsonPart)[] }

export type DecisionsQuestionPayload = {
    name: string
    type: QuestionType
    instructions: string | (TextPart | ImagePart)[]
    choices?: { value: string, description: string }[]
    levels?: { label: string, description: string }[]
}

/** Request body for POST /v1/decisions. */
export type DecisionsPayload = {
    model: string
    input: string | DecisionsInputItem[]
    questions: DecisionsQuestionPayload[]
    prompt_cache_key?: string
}

export type PredicateAnswer = { type: 'predicate', name: string, probability: number }
export type ChoiceAnswer = { type: 'choice', name: string, choice: string, probabilities: { value: string, probability: number }[], confidence: number }
export type ScoreAnswer = { type: 'score', name: string, score: number, probabilities: { value: number, label: string, probability: number }[], confidence: number }
export type RefusalAnswer = { type: 'refusal', name: string, refusal?: string }
export type DecisionAnswer = PredicateAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer

export type DecisionsUsage = {
    /** Includes cached and cache-write tokens. */
    input_tokens: number
    input_tokens_details?: { cached_tokens?: number, cache_write_tokens?: number }
    output_tokens?: number
    total_tokens?: number
}

/** Response from POST /v1/decisions (only the fields this app reads). */
export type DecisionsResponse = {
    id?: string
    model?: string
    answers: DecisionAnswer[]
    usage?: DecisionsUsage
}

const imageUrlPattern = /^(https?:\/\/\S+|data:image\/[\w.+-]+;base64,)/

function checkImage(url: string, where: string) {
    if (!imageUrlPattern.test(url)) {
        throw new Error(`${where} must be an http(s) URL or an image data URL, got: ${url.length > 60 ? `${url.slice(0, 60)}…` : url}`)
    }
}

/** Question names become outputs ({step.name}), so they must not hide the step's own outputs. */
export const RESERVED_NAMES = ['name', 'answers', 'refused', 'error']

/** What is wrong with the questions, in the words of the settings panel. Empty when they can be sent. */
export function questionProblems(questions: DecisionQuestion[]): string[] {
    const problems: string[] = []
    if (!questions.length) problems.push('Add at least one question.')
    if (questions.length > MAX_QUESTIONS) problems.push(`Ask at most ${MAX_QUESTIONS} questions in one step.`)
    const names = questions.map(q => q.name?.trim() || '')
    if (names.some(n => !n)) problems.push('Give every question a name.')
    const badName = names.find(n => n && !/^[A-Za-z][\w]*$/.test(n))
    if (badName) problems.push(`Question names use letters, digits and _ and start with a letter ("${badName}").`)
    const reserved = names.find(n => RESERVED_NAMES.includes(n))
    if (reserved) problems.push(`"${reserved}" can't be a question name; it is already an output of this step.`)
    const duplicate = names.find((n, i) => n && names.indexOf(n) != i)
    if (duplicate) problems.push(`Question names must be different ("${duplicate}" is used twice).`)
    for (const q of questions) {
        const label = q.name?.trim() ? `"${q.name.trim()}"` : 'A question'
        if (!q.instructions?.trim()) problems.push(`${label} needs instructions (what to decide).`)
        if (q.type == 'choice') {
            const values = (q.choices || []).map(c => c.value?.trim()).filter(Boolean)
            if (values.length < 2) problems.push(`${label} needs at least two choices.`)
            if (new Set(values).size != values.length) problems.push(`${label} has the same choice twice.`)
        }
        if (q.type == 'score') {
            const labels = (q.levels || []).map(l => l.label?.trim()).filter(Boolean)
            if (labels.length < MIN_LEVELS || labels.length > MAX_LEVELS) problems.push(`${label} needs ${MIN_LEVELS} to ${MAX_LEVELS} levels.`)
        }
    }
    return problems
}

export type BuildDecisionsOptions = {
    /** The text to decide about (already filled in). */
    text?: string
    /** Shared guidance, sent as a developer message. */
    instructions?: string
    /** Structured data, sent as an input_json part. */
    json?: object
    images?: string[]
    /** Questions with their text already filled in. */
    questions: DecisionQuestion[]
    cacheKey?: string
}

/**
 * Builds a Decisions request. A plain string `input` is sent when there is only text; otherwise a
 * developer message (shared instructions) and one user message holding text, JSON and images.
 */
export function buildDecisionsPayload(o: BuildDecisionsOptions): DecisionsPayload {
    const problems = questionProblems(o.questions)
    if (problems.length) throw new Error(problems[0])

    const text = o.text?.trim() || ''
    const images = (o.images || []).map(x => x.trim()).filter(Boolean)
    images.forEach(x => checkImage(x, 'Image input'))
    if (o.json !== undefined && (o.json === null || typeof o.json != 'object')) throw new Error('JSON data must be an object or a list')

    let input: DecisionsPayload['input']
    if (!o.instructions?.trim() && o.json === undefined && !images.length) {
        if (!text) throw new Error('Add the input to decide about (text, JSON data or an image)')
        input = text
    } else {
        const content: (TextPart | ImagePart | JsonPart)[] = []
        if (text) content.push({ type: 'input_text', text })
        if (o.json !== undefined) content.push({ type: 'input_json', data: o.json })
        for (const image_url of images) content.push({ type: 'input_image', image_url })
        if (!content.length) throw new Error('Add the input to decide about (text, JSON data or an image)')
        input = []
        if (o.instructions?.trim()) input.push({ role: 'developer', content: [{ type: 'input_text', text: o.instructions.trim() }] })
        input.push({ role: 'user', content })
    }

    const questions = o.questions.map((q): DecisionsQuestionPayload => {
        const instructionText = q.instructions!.trim()
        const image = q.image?.trim()
        if (image) checkImage(image, `The image for "${q.name}"`)
        const base: DecisionsQuestionPayload = {
            name: q.name.trim(),
            type: q.type,
            instructions: image ? [{ type: 'input_text', text: instructionText }, { type: 'input_image', image_url: image }] : instructionText,
        }
        // Every example in the guide gives a description; the value or label stands in when it is left empty.
        if (q.type == 'choice') {
            base.choices = (q.choices || []).filter(c => c.value?.trim()).map(c => ({ value: c.value.trim(), description: c.description?.trim() || c.value.trim() }))
        }
        if (q.type == 'score') {
            base.levels = (q.levels || []).filter(l => l.label?.trim()).map(l => ({ label: l.label.trim(), description: l.description?.trim() || l.label.trim() }))
        }
        return base
    })

    return {
        model: DECISIONS_MODEL,
        input,
        questions,
        ...(o.cacheKey?.trim() ? { prompt_cache_key: o.cacheKey.trim() } : {}),
    }
}

/** The answer's main value: the probability (yes/no), the chosen value, or the score. Null when refused. */
export function answerValue(answer: DecisionAnswer | undefined): number | string | null {
    switch (answer?.type) {
        case 'predicate': return answer.probability
        case 'choice': return answer.choice
        case 'score': return answer.score
        default: return null
    }
}

/** The level a score is closest to (a score can fall between levels, e.g. 1.1). */
export function nearestLevel(answer: ScoreAnswer): string | undefined {
    const index = Math.round(answer.score)
    return answer.probabilities.find(p => p.value == index)?.label
}

export type ParsedDecisions = {
    /** Keyed by question name. */
    answers: Record<string, DecisionAnswer>
    /** Keyed by question name: see answerValue. */
    values: Record<string, number | string | null>
    refused: string[]
}

/** Matches answers to questions by name and fails when a question has no answer. */
export function parseDecisionsResponse(response: DecisionsResponse, questions: { name: string }[]): ParsedDecisions {
    const byName = new Map((response.answers || []).map(a => [a.name, a]))
    const missing = questions.map(q => q.name.trim()).filter(name => !byName.has(name))
    if (missing.length) throw new Error(`OpenAI returned no answer for ${missing.map(x => `"${x}"`).join(', ')}`)
    const answers: Record<string, DecisionAnswer> = {}
    const values: Record<string, number | string | null> = {}
    const refused: string[] = []
    for (const q of questions) {
        const name = q.name.trim()
        const answer = byName.get(name)!
        answers[name] = answer
        values[name] = answerValue(answer)
        if (answer.type == 'refusal') refused.push(name)
    }
    return { answers, values, refused }
}

/** Decisions usage in the app's shape. Output tokens are not charged, so they count as zero. */
export function normalizeDecisionsUsage(usage: DecisionsUsage | undefined): NormalizedUsage {
    const total = usage?.input_tokens ?? 0
    const cached = Math.min(usage?.input_tokens_details?.cached_tokens ?? 0, total)
    const cacheWrite = Math.min(usage?.input_tokens_details?.cache_write_tokens ?? 0, total - cached)
    return { input: total - cached - cacheWrite, cachedInput: cached, cacheWrite, output: 0 }
}

/** Cost of one Decisions request at gpt-6-luna prices (cache writes at the input price). */
export function decisionsCost(usage: NormalizedUsage): Decimal | null {
    return costOf(usage, DECISIONS_MODEL)
}

const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Sample answers for when sample answers are on. `sample` maps question names to a value: a
 * probability for yes/no, a choice value, or a score (between levels is fine). Questions not in it
 * get 0.8 (yes/no), the first choice, or the middle level.
 */
export function sampleDecisions(questions: DecisionQuestion[], sample: Record<string, unknown> = {}): DecisionsResponse {
    const answers = questions.map((q): DecisionAnswer => {
        const name = q.name.trim()
        const given = sample[name]
        if (q.type == 'predicate') {
            const p = typeof given == 'number' ? given : typeof given == 'boolean' ? (given ? 1 : 0) : 0.8
            return { type: 'predicate', name, probability: Math.min(Math.max(p, 0), 1) }
        }
        if (q.type == 'choice') {
            const values = (q.choices || []).map(c => c.value.trim()).filter(Boolean)
            const choice = typeof given == 'string' && values.includes(given) ? given : values[0]
            const rest = values.length > 1 ? round(0.2 / (values.length - 1)) : 0
            return { type: 'choice', name, choice, confidence: 0.8, probabilities: values.map(value => ({ value, probability: value == choice ? 0.8 : rest })) }
        }
        const labels = (q.levels || []).map(l => l.label.trim()).filter(Boolean)
        const max = Math.max(labels.length - 1, 0)
        const score = typeof given == 'number' ? Math.min(Math.max(given, 0), max) : Math.floor(max / 2)
        // Split between the two nearest levels so the weighted average is exactly the score.
        const low = Math.floor(score)
        const fraction = round(score - low)
        return {
            type: 'score', name, score, confidence: 0.8,
            probabilities: labels.map((label, value) => ({ value, label, probability: value == low ? round(1 - fraction) : value == low + 1 ? fraction : 0 })),
        }
    })
    return { model: DECISIONS_MODEL, answers }
}

const OPENAI_URL = 'https://api.openai.com/v1'

export async function createDecisions(apiKey: string, payload: DecisionsPayload, signal?: AbortSignal): Promise<DecisionsResponse> {
    const response = await providerFetch(`${OPENAI_URL}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal,
    }, 'OpenAI')
    return response.json()
}
