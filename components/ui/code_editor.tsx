"use client"

import Editor from '@monaco-editor/react';
import { useIsDark } from '../layout/theme_toggle';

type CodeEditorProps = {
    value: string
    onChange: (value: string) => void
    language?: string
    height?: string
    'aria-label'?: string
}

/** A code editor (line numbers, highlighting, Tab to indent) that follows the light or dark theme. */
export default function CodeEditor({ value, onChange, language = 'javascript', height = '260px', ...rest }: CodeEditorProps) {
    const dark = useIsDark()
    return (
        <div className="rounded-md border border-input overflow-hidden">
            <Editor
                height={height}
                language={language}
                theme={dark ? 'vs-dark' : 'light'}
                value={value}
                onChange={(next) => onChange(next ?? '')}
                loading={<div className="text-xs text-muted-foreground p-2">Loading the editor…</div>}
                options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    tabSize: 4,
                    automaticLayout: true,
                    ariaLabel: rest['aria-label'],
                }}
            />
        </div>
    )
}
