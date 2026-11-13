import { describe, expect, it } from 'vitest'
import { fieldsFromSchema, makeStrict, schemaFromFields, schemaOutputs, strictIssues } from './schema_tools'

const loose = {
    type: 'object',
    properties: {
        title: { type: 'string', maxLength: 80 },
        tags: { type: 'array', items: { type: 'string' } },
        author: { type: 'object', properties: { name: { type: 'string' } } },
    },
    required: ['title'],
}

describe('strictIssues and makeStrict', () => {
    it('finds what strict mode rejects', () => {
        const issues = strictIssues(loose)
        expect(issues.map(x => x.path)).toEqual(['(root)', '(root)', 'title', 'author', 'author'])
        expect(issues.some(x => /missing: tags, author/.test(x.message))).toBe(true)
        expect(issues.some(x => /Claude rejects maxLength/.test(x.message))).toBe(true)
    })

    it('fixes those problems without changing the original', () => {
        const fixed = makeStrict(loose)
        expect(strictIssues(fixed)).toEqual([])
        expect(fixed.properties.title).toEqual({ type: 'string', description: '(maxLength: 80)' })
        expect(fixed.properties.author).toMatchObject({ additionalProperties: false, required: ['name'] })
        expect(loose.required).toEqual(['title'])
    })

    it('requires an object at the top level', () => {
        expect(strictIssues({ type: 'array', items: {} })).toEqual([{ path: '(root)', message: expect.stringMatching(/must be an object/), fixable: false }])
    })
})

describe('form fields', () => {
    it('round-trips a schema the form can show', () => {
        const fields = fieldsFromSchema(makeStrict(loose))!
        expect(fields.map(x => [x.name, x.type])).toEqual([['title', 'string'], ['tags', 'array'], ['author', 'object']])
        expect(fields[1].itemType).toBe('string')
        expect(schemaFromFields(fields)).toEqual(makeStrict({ ...loose, properties: { ...loose.properties, title: { type: 'string', description: '(maxLength: 80)' } } }))
    })

    it('builds arrays of objects and enums', () => {
        const schema = schemaFromFields([
            { name: 'mood', type: 'string', enum: ['happy', 'sad'] },
            { name: 'items', type: 'array', itemType: 'object', children: [{ name: 'id', type: 'integer' }] },
            { name: '', type: 'string' },
        ])
        expect(schema).toEqual({
            type: 'object',
            properties: {
                mood: { type: 'string', enum: ['happy', 'sad'] },
                items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false } },
            },
            required: ['mood', 'items'],
            additionalProperties: false,
        })
    })

    it('refuses schemas the form cannot represent', () => {
        expect(fieldsFromSchema({ type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] } } })).toBeNull()
        expect(fieldsFromSchema({ type: 'array' })).toBeNull()
    })
})

describe('schemaOutputs', () => {
    it('lists nested values as dotted paths', () => {
        expect(schemaOutputs(loose).map(x => x.path)).toEqual(['title', 'tags', 'author', 'author.name'])
    })
})
