import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { valueReg } from "@/lib/logics";
import { typedReference, ReferenceOption } from "@/lib/references";
import { cn } from "@/lib/utils";
import { ReferenceSuggestions, suggestionCount, filterReferences, useReferenceOptions } from "./reference_suggestions";

type TemplateInputProps = {
    id?: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    /** Colour {node.value} references. */
    highlight?: boolean
    /** Suggest references from earlier nodes when "{" is typed. */
    nodeId?: string
    readOnly?: boolean
    disabled?: boolean
    'aria-label'?: string
}

/** Splits text into plain parts and {reference} parts for the highlight layer. */
function highlighted(text: string) {
    const parts: { text: string, ref: boolean }[] = []
    let last = 0
    for (const match of Array.from(text.matchAll(new RegExp(valueReg.source, 'g')))) {
        if (match.index! > last) parts.push({ text: text.slice(last, match.index), ref: false })
        parts.push({ text: match[0], ref: true })
        last = match.index! + match[0].length
    }
    if (last < text.length) parts.push({ text: text.slice(last), ref: false })
    return parts
}

/**
 * A plain-text box that colours {node.value} references and suggests them while typing "{".
 * A native textarea sits on top of a highlighted copy of its text, so typing, selection, undo and
 * accessibility all stay native.
 */
export function TemplateInput({ id, value, onChange, placeholder, className, highlight = true, nodeId, readOnly, disabled, ...rest }: TemplateInputProps) {
    const textarea = useRef<HTMLTextAreaElement>(null)
    const backdrop = useRef<HTMLDivElement>(null)
    const options = useReferenceOptions(nodeId)
    const [query, setQuery] = useState<string | null>(null)
    const [active, setActive] = useState(0)
    const pendingCaret = useRef<number | null>(null)

    useLayoutEffect(() => {
        if (pendingCaret.current !== null && textarea.current) {
            textarea.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
            pendingCaret.current = null
        }
    })

    const updateQuery = (el: HTMLTextAreaElement) => {
        const q = nodeId ? typedReference(el.value.slice(0, el.selectionStart)) : null
        setQuery(q)
        setActive(0)
    }

    const pick = (option: ReferenceOption) => {
        const el = textarea.current
        if (!el || query === null) return
        const end = el.selectionStart
        const start = end - query.length - 1
        // Also replace a closing brace the user may have typed already.
        const after = el.value.slice(end).startsWith('}') ? end + 1 : end
        const inserted = `{${option.path}}`
        pendingCaret.current = start + inserted.length
        onChange(el.value.slice(0, start) + inserted + el.value.slice(after))
        setQuery(null)
    }

    const open = query !== null && suggestionCount(options, query) > 0

    return (
        <div className={cn("relative rounded-md border border-input bg-background text-sm focus-within:ring-2 focus-within:ring-ring", disabled && "opacity-50", className)}>
            {highlight ? (
                <div ref={backdrop} aria-hidden className="absolute inset-0 px-3 py-2 whitespace-pre-wrap break-words overflow-hidden text-transparent pointer-events-none">
                    {highlighted(value).map((p, i) => p.ref
                        ? <mark key={i} className="bg-blue-100 dark:bg-blue-950 text-transparent rounded-sm">{p.text}</mark>
                        : <Fragment key={i}>{p.text}</Fragment>)}
                    {'\n'}
                </div>
            ) : null}
            <textarea
                ref={textarea}
                id={id}
                aria-label={rest['aria-label']}
                aria-autocomplete={nodeId ? 'list' : undefined}
                value={value}
                placeholder={placeholder}
                readOnly={readOnly}
                disabled={disabled}
                spellCheck
                className="relative block w-full h-full min-h-[inherit] resize-none bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground"
                onChange={(e) => { onChange(e.target.value); updateQuery(e.target) }}
                onSelect={(e) => updateQuery(e.currentTarget)}
                onBlur={() => setQuery(null)}
                onScroll={(e) => { if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop }}
                onKeyDown={(e) => {
                    if (!open) return
                    const count = suggestionCount(options, query!)
                    if (e.key == 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % count) }
                    else if (e.key == 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + count) % count) }
                    else if (e.key == 'Enter' || e.key == 'Tab') { e.preventDefault(); pick(filterReferences(options, query!)[active]) }
                    else if (e.key == 'Escape') { e.preventDefault(); setQuery(null) }
                }}
            />
            {open ? <ReferenceSuggestions options={options} query={query!} active={active} onPick={pick} /> : null}
        </div>
    )
}
