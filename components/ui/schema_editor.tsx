"use client"

import dynamic from "next/dynamic"
import { PenBox, Plus, Trash } from "lucide-react";
import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import { useEffect, useMemo, useState } from "react";
import { Input } from "./input";
import { Label } from "./label";
import { Switch } from "./switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { FieldType, fieldsFromSchema, makeStrict, SchemaField, schemaFromFields, strictIssues } from "@/lib/schema_tools";
import type { editor } from 'monaco-editor';
import { track } from "@/lib/analytics";

// Monaco and TipTap are large; they load only when an editor dialog opens.
const JsonEditor = dynamic(() => import("./json_editor"), { ssr: false, loading: () => <div className="h-[30vh] rounded-md bg-muted animate-pulse" /> })


type SchemaEditorProps = {
  defaultValue?: SchemaType,
  onSave: (value: SchemaType) => void
}

export type SchemaType = {
  name: string,
  description?: string,
  strict?: boolean,
  schema: object
}

const schemaStyle = {
  type: "object",
  properties: {
    title: {
      type: "string"
    },
    description: {
      type: "string"
    },
    type: {
      type: "string",
      enum: [
        "object",
        "array",
        "string",
        "number",
        "boolean",
        "null",
        "integer"
      ]
    },
    properties: {
      type: "object",
      additionalProperties: {
        $ref: "#"
      }
    },
    items: {
      anyOf: [
        {
          $ref: "#"
        },
        {
          type: "array",
          items: {
            $ref: "#"
          }
        }
      ]
    },
    required: {
      type: "array",
      items: {
        type: "string"
      },
      uniqueItems: true
    },
    additionalProperties: {
      anyOf: [
        {
          type: "boolean"
        },
        {
          $ref: "#"
        }
      ]
    },
    definitions: {
      type: "object",
      additionalProperties: {
        $ref: "#"
      }
    },
    enum: {
      type: "array",
      minItems: 1,
      items: {
        type: [
          "string",
          "number",
          "boolean",
          "null",
          "object",
          "array"
        ]
      }
    },
    const: {
      type: [
        "string",
        "number",
        "boolean",
        "null",
        "object",
        "array"
      ]
    },
    format: {
      type: "string"
    },
    minLength: {
      type: "integer",
      minimum: 0
    },
    maxLength: {
      type: "integer",
      minimum: 0
    },
    pattern: {
      type: "string",
      format: "regex"
    },
    minimum: {
      type: "number"
    },
    maximum: {
      type: "number"
    },
    exclusiveMinimum: {
      type: "number"
    },
    exclusiveMaximum: {
      type: "number"
    },
    anyOf: {
      type: "array",
      minItems: 1,
      items: {
        $ref: "#"
      }
    },
    not: {
      $ref: "#"
    }
  },
  required: [
    "type",
  ],
  additionalProperties: false
}

const TYPE_LABELS: Record<FieldType, string> = { string: 'Text', number: 'Number', integer: 'Whole number', boolean: 'Yes / no', object: 'Group', array: 'List' }

function FieldRows({ fields, onChange, depth = 0 }: { fields: SchemaField[], onChange: (fields: SchemaField[]) => void, depth?: number }) {
  const update = (index: number, patch: Partial<SchemaField>) => onChange(fields.map((x, i) => i == index ? { ...x, ...patch } : x))
  return (
    <div className={depth ? 'flex flex-col gap-2 pl-4 border-l-2 border-border' : 'flex flex-col gap-2'}>
      {fields.map((field, index) => {
        const nested = field.type == 'object' || (field.type == 'array' && field.itemType == 'object')
        return (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex gap-1 items-center">
              <Input aria-label="Field name" className="h-8" value={field.name} placeholder="name" onChange={(e) => update(index, { name: e.target.value.replace(/[^\w-]/g, '_') })} />
              <Select value={field.type} onValueChange={(type) => update(index, { type: type as FieldType, itemType: type == 'array' ? 'string' : undefined, children: type == 'object' ? (field.children || []) : undefined, enum: undefined })}>
                <SelectTrigger aria-label="Field type" className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TYPE_LABELS) as FieldType[]).map(t => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
              {field.type == 'array' ? (
                <Select value={field.itemType || 'string'} onValueChange={(t) => update(index, { itemType: t as SchemaField['itemType'], children: t == 'object' ? (field.children || []) : undefined })}>
                  <SelectTrigger aria-label="List item type" className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(TYPE_LABELS) as FieldType[]).filter(t => t != 'array').map(t => <SelectItem key={t} value={t}>of {TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              ) : null}
              <Button variant="ghost" size="sm" aria-label="Remove field" className="text-red-500 p-0.5 h-8 w-8 shrink-0" onClick={() => onChange(fields.filter((_, i) => i != index))}><Trash className="w-4 h-4" /></Button>
            </div>
            <Input aria-label="Field description" className="h-8 text-xs" value={field.description || ''} placeholder="Description: tells the model what to put here" onChange={(e) => update(index, { description: e.target.value || undefined })} />
            {field.type == 'string' ? (
              <Input
                aria-label="Allowed values"
                className="h-8 text-xs"
                // Read when leaving the box, so commas can be typed freely.
                defaultValue={(field.enum || []).join(', ')}
                placeholder="Allowed values (optional), e.g. positive, negative"
                onBlur={(e) => {
                  const values = e.target.value.split(',').map(x => x.trim()).filter(Boolean)
                  update(index, { enum: values.length ? values : undefined })
                }}
              />
            ) : null}
            {nested ? <FieldRows depth={depth + 1} fields={field.children || []} onChange={(children) => update(index, { children })} /> : null}
          </div>
        )
      })}
      <Button variant="outline" size="sm" className="w-fit h-7 text-xs" onClick={() => onChange([...fields, { name: '', type: 'string' }])}><Plus className="w-3 h-3 mr-1" /> Add field</Button>
    </div>
  )
}

export default function SchemaEditor({ defaultValue, onSave }: SchemaEditorProps) {
  const [schema, setSchema] = useState<SchemaType>(defaultValue || { name: '', strict: true, schema: { type: 'object', properties: {}, required: [], additionalProperties: false } })
  const [errors, setErrors] = useState<editor.IMarker[]>([])
  const [mode, setMode] = useState<'fields' | 'json'>(() => fieldsFromSchema(defaultValue?.schema ?? { type: 'object' }) ? 'fields' : 'json')
  const [jsonKey, setJsonKey] = useState(0)
  // The form keeps its own list so a field that has no name yet stays visible while it is being typed.
  const [formFields, setFormFields] = useState<SchemaField[] | null>(() => fieldsFromSchema(defaultValue?.schema ?? { type: 'object' }))
  const issues = useMemo(() => strictIssues(schema.schema), [schema.schema])

  const editFields = (next: SchemaField[]) => {
    setFormFields(next)
    setSchema(s => ({ ...s, schema: schemaFromFields(next) }))
  }

  const setValue = (key: keyof SchemaType, value: unknown) => setSchema(s => ({ ...s, [key]: value }))

  useEffect(() => {
    track('schema_editor_opened')
  }, [])

  return (
    <div className='rounded-md relative'>
      <div className="bg-accent p-2 text-xs rounded-md whitespace-pre-wrap max-h-28 overflow-y-auto border border-border">
        {defaultValue?.name || 'Not assigned'}
      </div>
      <div className="absolute top-1 right-1">
        <Dialog onOpenChange={(open) => {
          if (!open) return
          const current = defaultValue || schema
          setSchema(current)
          setFormFields(fieldsFromSchema(current.schema))
          setJsonKey(k => k + 1)
        }}>
          <DialogTrigger asChild>
            <Button toolTip="Schema Editor" aria-label="Edit output structure" variant="ghost" className="h-6 w-6 p-1" size="icon">
              <PenBox size={10} />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-(--breakpoint-md) max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Output structure</DialogTitle>
              <DialogDescription>The model&apos;s answer will be JSON with exactly these fields.</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <div className='flex flex-col gap-1 flex-1'>
                <Label htmlFor="schema-name">Name</Label>
                <Input id="schema-name" value={schema.name} placeholder="e.g. review_summary" onChange={(e) => setValue('name', e.target.value.replace(/[^\w-]/g, '_'))} />
              </div>
              <div className='flex flex-col gap-1 flex-2'>
                <Label htmlFor="schema-description">Description (optional)</Label>
                <Input id="schema-description" value={schema.description || ''} placeholder="What the output is for" onChange={(e) => setValue('description', e.target.value || undefined)} />
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <Switch id="schema-strict" checked={!!schema.strict} onCheckedChange={(e) => setValue('strict', e)} />
              <Label htmlFor="schema-strict">Strict (the answer always matches the structure)</Label>
            </div>
            <div className="flex gap-1 border-b border-border">
              {(['fields', 'json'] as const).map(m => (
                <button
                  key={m}
                  className={`px-3 py-1 text-sm -mb-px border-b-2 ${mode == m ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
                  onClick={() => {
                    if (m == 'fields') setFormFields(fieldsFromSchema(schema.schema))
                    else setJsonKey(k => k + 1)
                    setMode(m)
                  }}
                  disabled={m == 'fields' && !fieldsFromSchema(schema.schema)}
                  title={m == 'fields' && !fieldsFromSchema(schema.schema) ? 'This structure uses features only the JSON view can edit' : undefined}
                >
                  {m == 'fields' ? 'Fields' : 'JSON'}
                </button>
              ))}
            </div>
            {mode == 'fields' && formFields ? (
              <FieldRows fields={formFields} onChange={editFields} />
            ) : (
              <div className='flex flex-col gap-1'>
                <Label>JSON Schema <span className={errors.length == 0 ? 'text-green-600' : 'text-red-600'}>{errors.length == 0 ? '(Valid)' : '(Invalid)'}</span></Label>
                <JsonEditor
                  key={jsonKey}
                  defaultValue={JSON.stringify(schema.schema, null, 4)}
                  schema={schemaStyle}
                  onErrorChange={setErrors}
                  onChange={(s) => {
                    try {
                      if (s) setValue('schema', JSON.parse(s))
                    } catch { }
                  }}
                />
              </div>
            )}
            {schema.strict && issues.length ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:text-amber-200 p-2 text-xs text-amber-900 flex flex-col gap-1">
                <span className="font-semibold">Providers will reject this in strict mode:</span>
                <ul className="list-disc pl-4">{issues.slice(0, 6).map((x, i) => <li key={i}><b>{x.path}</b>: {x.message}</li>)}</ul>
                {issues.some(x => x.fixable) ? <Button size="sm" variant="outline" className="w-fit h-7 text-xs" onClick={() => {
                  const fixed = makeStrict(schema.schema)
                  setValue('schema', fixed)
                  setFormFields(fieldsFromSchema(fixed))
                  setJsonKey(k => k + 1)
                }}>Fix automatically</Button> : null}
              </div>
            ) : null}
            <DialogFooter>
              <DialogClose asChild><Button disabled={!schema.name || errors.length > 0} onClick={() => onSave(schema)}>Save</Button></DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
