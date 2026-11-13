import React, { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Bold, Code, Heading1, Heading2, Heading3, Italic, List, ListOrdered, SquareCode, TextQuote, Underline } from 'lucide-react';
import { Toggle } from './toggle';
import { valueReg } from '@/lib/logics';
import { track } from "@/lib/analytics";
import { typedReference, ReferenceOption } from '@/lib/references';
import { filterReferences, ReferenceSuggestions, suggestionCount, useReferenceOptions } from './reference_suggestions';

/** Colours {node.value} references in the editor without changing the text. */
const ReferenceHighlight = Extension.create({
    name: 'referenceHighlight',
    addProseMirrorPlugins() {
        const find = (doc: PMNode) => {
            const decorations: Decoration[] = []
            doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return
                for (const match of Array.from(node.text.matchAll(new RegExp(valueReg.source, 'g')))) {
                    decorations.push(Decoration.inline(pos + match.index!, pos + match.index! + match[0].length, { class: 'reference-chip' }))
                }
            })
            return DecorationSet.create(doc, decorations)
        }
        return [new Plugin({
            key: new PluginKey('referenceHighlight'),
            state: {
                init: (_, { doc }) => find(doc),
                apply: (tr, old) => tr.docChanged ? find(tr.doc) : old,
            },
            props: { decorations(state) { return this.getState(state) } },
        })]
    },
})

type RichTextEditorProps = {
    initialContent: string
    onChange: (markdown: string) => void
    withoutHighlights?: boolean
    extraToolButtons?: React.JSX.Element
    /** Suggest references from earlier nodes when "{" is typed. */
    nodeId?: string
}

/** A Markdown editor for prompts (bold, headings, lists, quotes, code) built on TipTap. */
export default function RichTextEditor({ initialContent, onChange, withoutHighlights, extraToolButtons, nodeId }: RichTextEditorProps) {
    const options = useReferenceOptions(nodeId)
    const [query, setQuery] = useState<string | null>(null)
    const [active, setActive] = useState(0)

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [StarterKit, Markdown, ...(withoutHighlights ? [] : [ReferenceHighlight])],
        content: initialContent,
        contentType: 'markdown',
        editorProps: { attributes: { class: 'RichEditor-editor prose-sm outline-hidden', 'aria-label': 'Rich text editor', role: 'textbox', 'aria-multiline': 'true' } },
        onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
        onSelectionUpdate: ({ editor }) => {
            if (!nodeId) return
            const { from } = editor.state.selection
            const before = editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\n')
            setQuery(typedReference(before))
            setActive(0)
        },
    })

    useEffect(() => { track('rich_text_editor_opened') }, [])

    const state = useEditorState({
        editor,
        selector: ({ editor }) => editor ? {
            h1: editor.isActive('heading', { level: 1 }), h2: editor.isActive('heading', { level: 2 }), h3: editor.isActive('heading', { level: 3 }),
            quote: editor.isActive('blockquote'), ul: editor.isActive('bulletList'), ol: editor.isActive('orderedList'), codeBlock: editor.isActive('codeBlock'),
            bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'), code: editor.isActive('code'),
        } : null,
    })

    const pick = (option: ReferenceOption) => {
        if (!editor || query === null) return
        const { from } = editor.state.selection
        editor.chain().focus().deleteRange({ from: from - query.length - 1, to: from }).insertContent(`{${option.path}}`).run()
        setQuery(null)
    }

    if (!editor) return null
    const c = () => editor.chain().focus()
    const buttons = [
        { label: 'Heading 1', icon: Heading1, on: state?.h1, run: () => c().toggleHeading({ level: 1 }).run() },
        { label: 'Heading 2', icon: Heading2, on: state?.h2, run: () => c().toggleHeading({ level: 2 }).run() },
        { label: 'Heading 3', icon: Heading3, on: state?.h3, run: () => c().toggleHeading({ level: 3 }).run() },
        { label: 'Quote', icon: TextQuote, on: state?.quote, run: () => c().toggleBlockquote().run() },
        { label: 'Bulleted list', icon: List, on: state?.ul, run: () => c().toggleBulletList().run() },
        { label: 'Numbered list', icon: ListOrdered, on: state?.ol, run: () => c().toggleOrderedList().run() },
        { label: 'Code block', icon: SquareCode, on: state?.codeBlock, run: () => c().toggleCodeBlock().run() },
        { label: 'Bold', icon: Bold, on: state?.bold, run: () => c().toggleBold().run() },
        { label: 'Italic', icon: Italic, on: state?.italic, run: () => c().toggleItalic().run() },
        { label: 'Underline', icon: Underline, on: state?.underline, run: () => c().toggleUnderline().run() },
        { label: 'Inline code', icon: Code, on: state?.code, run: () => c().toggleCode().run() },
    ]
    const open = query !== null && suggestionCount(options, query) > 0

    return (
        <div className="RichEditor-root rounded-md">
            <div className="flex flex-wrap gap-1 p-1" role="toolbar" aria-label="Formatting">
                {buttons.map(b => (
                    <Toggle key={b.label} aria-label={b.label} toolTip={b.label} pressed={!!b.on} onPressedChange={b.run}>
                        <b.icon size={16} />
                    </Toggle>
                ))}
                {extraToolButtons}
            </div>
            <div
                className="relative"
                onKeyDownCapture={(e) => {
                    if (!open) return
                    const count = suggestionCount(options, query!)
                    if (e.key == 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive(a => (a + 1) % count) }
                    else if (e.key == 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive(a => (a - 1 + count) % count) }
                    else if (e.key == 'Enter' || e.key == 'Tab') { e.preventDefault(); e.stopPropagation(); pick(filterReferences(options, query!)[active]) }
                    else if (e.key == 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null) }
                }}
            >
                <EditorContent editor={editor} />
                {open ? <ReferenceSuggestions options={options} query={query!} active={active} onPick={pick} /> : null}
            </div>
        </div>
    )
}
