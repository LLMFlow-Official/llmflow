import { describe, expect, it } from 'vitest'
import { extractJson, parseHeaders, parseList, splitText } from './text_utils'

describe('extractJson', () => {
    it('parses plain JSON', () => {
        expect(extractJson('{"a": 1}')).toEqual({ a: 1 })
        expect(extractJson(' [1, 2] ')).toEqual([1, 2])
    })

    it('reads a fenced code block', () => {
        expect(extractJson('Here you go:\n```json\n{"name": "Ann"}\n```\nThanks')).toEqual({ name: 'Ann' })
        expect(extractJson('```\n[true]\n```')).toEqual([true])
    })

    it('finds JSON inside other text', () => {
        expect(extractJson('The result is {"ok": true, "n": {"x": 2}} as asked.')).toEqual({ ok: true, n: { x: 2 } })
    })

    it('throws when there is no JSON', () => {
        expect(() => extractJson('no json here')).toThrow(/No valid JSON/)
        expect(() => extractJson('   ')).toThrow(/no text/)
    })
})

describe('splitText', () => {
    it('splits by a separator and drops empty pieces', () => {
        expect(splitText('a\n\n b \nc', { mode: 'separator', separator: '\\n' })).toEqual(['a', 'b', 'c'])
        expect(splitText('a, b,c', { mode: 'separator', separator: ',' })).toEqual(['a', 'b', 'c'])
    })

    it('splits into chunks with overlap', () => {
        expect(splitText('abcdefgh', { mode: 'chunk', size: 3 })).toEqual(['abc', 'def', 'gh'])
        expect(splitText('abcdefgh', { mode: 'chunk', size: 4, overlap: 1 })).toEqual(['abcd', 'defg', 'gh'])
        expect(splitText('abcd', { mode: 'chunk', size: 4, overlap: 2 })).toEqual(['abcd'])
    })

    it('rejects bad chunk settings', () => {
        expect(() => splitText('abc', { mode: 'chunk', size: 0 })).toThrow(/greater than 0/)
        expect(() => splitText('abc', { mode: 'chunk', size: 2, overlap: 2 })).toThrow(/Overlap/)
    })

    it('returns nothing for empty text', () => {
        expect(splitText('', { mode: 'chunk', size: 5 })).toEqual([])
    })
})

describe('parseList and parseHeaders', () => {
    it('parses comma or newline lists', () => {
        expect(parseList('a.com, b.com\n c.com ,,')).toEqual(['a.com', 'b.com', 'c.com'])
        expect(parseList(undefined)).toEqual([])
    })

    it('parses header lines', () => {
        expect(parseHeaders('Authorization: Bearer a:b\n\nbad line\nAccept:  application/json ')).toEqual({
            Authorization: 'Bearer a:b',
            Accept: 'application/json',
        })
    })
})
