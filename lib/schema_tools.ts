/**
 * Helpers for structured-output JSON schemas: strict-mode checks and fixes, a simple field model for
 * the form editor, and the list of fields a node outputs.
 */

type JsonSchema = Record<string, unknown>

const isObject = (value: unknown): value is JsonSchema => typeof value == 'object' && value !== null && !Array.isArray(value)

/** Keywords Claude's structured outputs reject (see Anthropic's structured outputs limits). */
const CLAUDE_UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems']

export type SchemaIssue = { path: string, message: string, fixable: boolean }

function walk(schema: unknown, path: string, visit: (node: JsonSchema, path: string) => void) {
    if (!isObject(schema)) return
    visit(schema, path)
    if (isObject(schema.properties)) {
        for (const [key, child] of Object.entries(schema.properties)) walk(child, path ? `${path}.${key}` : key, visit)
    }
    if (schema.items) walk(schema.items, `${path}[]`, visit)
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
        if (Array.isArray(schema[key])) (schema[key] as unknown[]).forEach((x, i) => walk(x, `${path}(${key} ${i + 1})`, visit))
    }
    if (isObject(schema.$defs)) for (const [key, child] of Object.entries(schema.$defs)) walk(child, `$defs.${key}`, visit)
}

const isObjectType = (node: JsonSchema) => node.type == 'object' || (Array.isArray(node.type) && node.type.includes('object')) || isObject(node.properties)

/**
 * Problems that make providers reject a strict schema: the root must be an object, objects must set
 * additionalProperties to false and list every property as required. Also flags keywords Claude rejects.
 */
export function strictIssues(schema: unknown): SchemaIssue[] {
    const issues: SchemaIssue[] = []
    if (!isObject(schema) || !isObjectType(schema)) {
        issues.push({ path: '(root)', message: 'The top level must be an object ("type": "object")', fixable: false })
        return issues
    }
    walk(schema, '', (node, path) => {
        const where = path || '(root)'
        if (isObjectType(node)) {
            if (node.additionalProperties !== false) issues.push({ path: where, message: 'Objects must set "additionalProperties": false', fixable: true })
            const keys = isObject(node.properties) ? Object.keys(node.properties) : []
            const required = Array.isArray(node.required) ? node.required as string[] : []
            const missing = keys.filter(k => !required.includes(k))
            if (missing.length) issues.push({ path: where, message: `Every property must be required (missing: ${missing.join(', ')}). Use a type like ["string", "null"] for optional values.`, fixable: true })
        }
        const unsupported = CLAUDE_UNSUPPORTED.filter(k => k in node)
        if (unsupported.length) issues.push({ path: where, message: `Claude rejects ${unsupported.join(', ')}; describe the limit in "description" instead`, fixable: true })
    })
    return issues
}

/** Returns a copy that passes strictIssues where possible (moving unsupported limits into descriptions). */
export function makeStrict<T>(schema: T): T {
    const copy = JSON.parse(JSON.stringify(schema)) as T
    walk(copy, '', (node) => {
        if (isObjectType(node)) {
            node.additionalProperties = false
            node.required = isObject(node.properties) ? Object.keys(node.properties) : []
        }
        const moved = CLAUDE_UNSUPPORTED.filter(k => k in node).map(k => `${k}: ${JSON.stringify(node[k])}`)
        if (moved.length) {
            for (const k of CLAUDE_UNSUPPORTED) delete node[k]
            node.description = [node.description, `(${moved.join(', ')})`].filter(Boolean).join(' ')
        }
    })
    return copy
}

/* ---------------- Form editor model ---------------- */

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'

export type SchemaField = {
    name: string
    type: FieldType
    description?: string
    /** For "string": allowed values. */
    enum?: string[]
    /** For "array": the type of each item. */
    itemType?: Exclude<FieldType, 'array'>
    /** For "object", or "array" of objects. */
    children?: SchemaField[]
}

const FIELD_TYPES: FieldType[] = ['string', 'number', 'integer', 'boolean', 'object', 'array']

function fieldFrom(name: string, node: unknown): SchemaField | null {
    if (!isObject(node) || typeof node.type != 'string' || !FIELD_TYPES.includes(node.type as FieldType)) return null
    const field: SchemaField = { name, type: node.type as FieldType }
    if (typeof node.description == 'string' && node.description) field.description = node.description
    if (field.type == 'string' && Array.isArray(node.enum)) field.enum = node.enum.map(String)
    if (field.type == 'object') {
        const children = fieldsFromSchema(node)
        if (!children) return null
        field.children = children
    }
    if (field.type == 'array') {
        const items = node.items
        if (!isObject(items) || typeof items.type != 'string' || items.type == 'array' || !FIELD_TYPES.includes(items.type as FieldType)) return null
        field.itemType = items.type as Exclude<FieldType, 'array'>
        if (field.itemType == 'object') {
            const children = fieldsFromSchema(items)
            if (!children) return null
            field.children = children
        }
    }
    return field
}

/** Reads a schema into form fields, or returns null when it uses features the form cannot show. */
export function fieldsFromSchema(schema: unknown): SchemaField[] | null {
    if (!isObject(schema) || schema.type != 'object') return null
    if (!isObject(schema.properties)) return []
    const fields: SchemaField[] = []
    for (const [name, node] of Object.entries(schema.properties)) {
        const field = fieldFrom(name, node)
        if (!field) return null
        fields.push(field)
    }
    return fields
}

function nodeFrom(field: SchemaField): JsonSchema {
    const node: JsonSchema = { type: field.type }
    if (field.description) node.description = field.description
    if (field.type == 'string' && field.enum?.length) node.enum = field.enum
    if (field.type == 'object') Object.assign(node, schemaFromFields(field.children || []))
    if (field.type == 'array') {
        const item: JsonSchema = { type: field.itemType || 'string' }
        if (field.itemType == 'object') Object.assign(item, schemaFromFields(field.children || []))
        node.items = item
    }
    return node
}

/** Builds a strict object schema from form fields (every field required, no extra properties). */
export function schemaFromFields(fields: SchemaField[]): JsonSchema {
    const named = fields.filter(x => x.name)
    return {
        type: 'object',
        properties: Object.fromEntries(named.map(f => [f.name, nodeFrom(f)])),
        required: named.map(f => f.name),
        additionalProperties: false,
    }
}

/* ---------------- Node outputs ---------------- */

export type SchemaOutput = { path: string, title?: string, description?: string }

/** Every named value in the schema as a dotted path, e.g. "address.city", for the Value Selector. */
export function schemaOutputs(schema: unknown, prefix = '', depth = 0): SchemaOutput[] {
    if (!isObject(schema) || !isObject(schema.properties) || depth > 4) return []
    const outputs: SchemaOutput[] = []
    for (const [key, node] of Object.entries(schema.properties)) {
        const path = prefix ? `${prefix}.${key}` : key
        const n = isObject(node) ? node : {}
        outputs.push({ path, title: typeof n.title == 'string' ? n.title : undefined, description: typeof n.description == 'string' ? n.description : undefined })
        outputs.push(...schemaOutputs(n, path, depth + 1))
    }
    return outputs
}
