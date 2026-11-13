import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/shallow";
import { FilePlus2, Loader2, RotateCcw, SendHorizontal, Sparkles, Square, Trash, Undo2 } from "lucide-react";
import { useLibraryStore, createFlow } from "@/lib/library";
import { useSettingStore } from "@/lib/store";
import { availableProviders, providerLabel } from "@/lib/providers";
import { findModel, modelsFor, ProviderId } from "@/lib/openai/models";
import { ChatMessage, useAssistantStore } from "@/lib/assistant/assistant_store";
import { askAssistant, assistantModel, editedSince, stopAssistant, undoAssistantChange } from "@/lib/assistant/run_assistant";
import { chatOf } from "@/lib/assistant/assistant_store";
import { AppNode, useFlowStore } from "@/lib/store";
import { getNodeDetails } from "@/lib/nodes";
import { MOD_KEY } from "@/lib/utils";
import { askToConfirm } from "../ui/confirm_host";
import { openSettings } from "../layout/settings";
import { selectStepKeepingTab } from "./panel_tab";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";
import MarkdownViewer from "../ui/markdown_viewer";

const EXAMPLES = [
    'Summarize a web page and translate the summary into Spanish',
    'Classify a support email and draft a reply for each category',
    'Split a long document into chunks and summarize each one',
]

function plural(count: number, word: string) {
    return `${count} ${word}${count == 1 ? '' : 's'}`
}

/** "2 steps added, 1 changed", with the added and changed steps as links to the canvas. */
function ChangeSummary({ message }: { message: ChatMessage }) {
    const nodes = useFlowStore(s => s.nodes)
    const { fitView } = useReactFlow()
    const c = message.changes
    if (!c) return null
    const parts = [
        c.added.length ? `${plural(c.added.length, 'step')} added` : '',
        c.changed.length ? `${c.changed.length} changed` : '',
        c.removed.length ? `${c.removed.length} removed` : '',
    ].filter(Boolean)
    const linked = [...c.added, ...c.changed].map(id => nodes.find(n => n.id == id)).filter((n): n is AppNode => !!n).slice(0, 8)
    const show = (id: string) => { fitView({ nodes: [{ id }], maxZoom: 1.3, duration: 300 }); selectStepKeepingTab(id) }
    return (
        <span className="flex flex-col gap-1">
            <span>{parts.length ? parts.join(', ') : 'Connections updated'}</span>
            {linked.length && !message.undone ? (
                <span className="flex flex-wrap gap-1">
                    {linked.map(n => (
                        <button key={n.id} className="rounded border border-border px-1.5 py-0.5 hover:bg-muted text-foreground" onClick={() => show(n.id)}>
                            {(n.data.name as string) || getNodeDetails(n.type).name}
                        </button>
                    ))}
                </span>
            ) : null}
        </span>
    )
}

function Message({ flowId, message, last, onRetry }: { flowId: string, message: ChatMessage, last: boolean, onRetry?: (text: string) => void }) {
    const busy = useAssistantStore(s => s.busy)
    if (message.role == 'user') {
        return <div className="self-end max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word">{message.text}</div>
    }
    if (message.role == 'error') {
        return (
            <div role="alert" className="self-start max-w-[95%] rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm flex flex-col gap-2">
                <span>{message.text}</span>
                {message.retry && message.text != 'Stopped.' ? (
                    <Button variant="outline" size="sm" className="self-start h-7 gap-1" disabled={busy} onClick={() => onRetry?.(message.retry!)}>
                        <RotateCcw size={12} /> Try again
                    </Button>
                ) : null}
            </div>
        )
    }
    return (
        <div className="self-start max-w-[95%] rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm flex flex-col gap-2 min-w-0">
            <MarkdownViewer text={message.text} />
            {message.warnings ? (
                <div className="text-xs text-warning">
                    <p className="font-semibold">Check these before running:</p>
                    <ul className="list-disc pl-4">{message.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
            ) : null}
            {message.changes || message.cost ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <ChangeSummary message={message} />
                    {message.cost ? <span>· {message.cost}</span> : null}
                    {message.before ? (
                        message.undone
                            ? <span className="ml-auto italic">Undone</span>
                            : <Button
                                variant="ghost" size="sm" className="ml-auto h-6 px-2 gap-1"
                                disabled={busy || !last}
                                aria-label="Undo this change"
                                toolTip={last ? "Put the flow back as it was before this change" : `Only the latest change can be undone here (${MOD_KEY}+Z still works)`}
                                onClick={async () => {
                                    // Undo restores the flow from before the change, so edits made since then would be lost.
                                    if (editedSince(message) && !(await askToConfirm({
                                        title: 'Undo the assistant\'s change?',
                                        description: 'You changed the flow after this. Undo puts it back as it was before the assistant\'s change, so your later edits are removed too.',
                                        confirmLabel: 'Undo anyway',
                                        destructive: true,
                                    }))) return
                                    undoAssistantChange(flowId, message)
                                }}
                            >
                                <Undo2 size={12} /> Undo
                            </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

function ModelPicker() {
    // Re-render when the choice, the keys or sample answers change (assistantModel() reads them).
    useSettingStore(useShallow(s => [s.assistantProvider, s.assistantModel, s.apiKeys, s.compatibleBaseUrl, s.sampleAnswers, s.devMode]))
    const usable = availableProviders().filter(p => p != 'compatible')
    const current = assistantModel()
    if (!current) return null
    return (
        <Select
            value={`${current.provider}:${current.model}`}
            onValueChange={(value) => {
                const [provider, ...rest] = value.split(':')
                useSettingStore.getState().setSettings({ assistantProvider: provider as ProviderId, assistantModel: rest.join(':') })
            }}
        >
            <SelectTrigger className="h-8 text-xs w-full" aria-label="Assistant model">
                <SelectValue>{findModel(current.model)?.label || current.model}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {usable.map(p => (
                    <SelectGroup key={p}>
                        <SelectLabel>{providerLabel(p)}</SelectLabel>
                        {modelsFor(p).filter(m => m.group != 'Deprecated' && !m.deprecated).map(m => (
                            <SelectItem key={m.id} value={`${p}:${m.id}`}>{m.label}</SelectItem>
                        ))}
                    </SelectGroup>
                ))}
                {current.provider == 'compatible' ? (
                    <SelectGroup>
                        <SelectLabel>{providerLabel('compatible')}</SelectLabel>
                        <SelectItem value={`compatible:${current.model}`}>{current.model}</SelectItem>
                    </SelectGroup>
                ) : null}
            </SelectContent>
        </Select>
    )
}

/** "Build" tab: describe a flow in plain language and the assistant creates or edits it on the canvas. */
export default function FlowAssistantPanel() {
    const { currentId, currentName } = useLibraryStore(useShallow(s => ({ currentId: s.currentId, currentName: s.currentName })))
    const { messages, busy, status, received } = useAssistantStore(useShallow(s => ({ messages: (currentId && s.chats[currentId]) || EMPTY, busy: s.busy, status: s.status, received: s.received })))
    useSettingStore(useShallow(s => [s.apiKeys, s.compatibleBaseUrl, s.sampleAnswers, s.devMode]))
    const [text, setText] = useState('')
    const listRef = useRef<HTMLDivElement>(null)
    const { fitView } = useReactFlow()
    const ready = !!assistantModel()
    // Only the latest change can be undone from the chat; older ones would drop the changes made after them.
    const lastChangeId = messages.findLast(m => m.before)?.id

    // Load this flow's chat from the browser after a reload.
    useEffect(() => { if (currentId) chatOf(currentId) }, [currentId])

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }, [messages.length, busy])

    // After an error, the request goes back in the box so it can be changed or sent again.
    const retry = (request: string) => { setText(''); send(request) }
    const lastError = messages.at(-1)?.role == 'error' ? messages.at(-1) : undefined
    const [restoredFor, setRestoredFor] = useState<string>()
    if (lastError && lastError.id != restoredFor && lastError.retry && lastError.text != 'Stopped.') {
        setRestoredFor(lastError.id)
        if (!text) setText(lastError.retry)
    }

    const send = (value = text) => {
        if (!value.trim() || busy) return
        setText('')
        askAssistant(value.trim(), () => requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 })))
    }

    if (!currentId) return null

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center gap-1 px-3 pb-2 border-b border-border">
                <div className="flex-1 min-w-0"><ModelPicker /></div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" toolTip="Start another flow" aria-label="Start another flow" disabled={busy} onClick={() => createFlow('New flow')}>
                    <FilePlus2 size={16} />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" toolTip="Clear chat" aria-label="Clear chat" disabled={busy || !messages.length} onClick={() => useAssistantStore.getState().clear(currentId)}>
                    <Trash size={16} />
                </Button>
            </div>

            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
                {!messages.length ? (
                    <div className="flex flex-col gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 text-foreground font-semibold"><Sparkles size={16} /> Build with chat</div>
                        <p>Describe what the flow should do. The assistant builds it on the canvas, or changes <span className="font-medium text-foreground">{currentName || 'this flow'}</span> if it already has steps. You can keep asking for changes, and undo any of them.</p>
                        {ready ? (
                            <div className="flex flex-col gap-2">
                                {EXAMPLES.map(example => (
                                    <button key={example} className="text-left rounded-md border border-border px-3 py-2 hover:bg-muted text-foreground" onClick={() => send(example)}>{example}</button>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-md border border-border p-3 flex flex-col gap-2">
                                <p>The assistant needs an API key for OpenAI, Claude or Gemini. Or try it now with sample answers: it then builds a small example flow.</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button size="sm" onClick={openSettings}>Open Settings</Button>
                                    <Button size="sm" variant="outline" onClick={turnOnSampleAnswers}>Use sample answers</Button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : messages.map(m => <Message key={m.id} flowId={currentId} message={m} last={m.id == lastChangeId} onRetry={retry} />)}
                {busy ? (
                    <div className="self-start flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden />
                        <span role="status">{status}…</span>
                        {received ? <span aria-hidden>({Math.round(received / 1000 * 10) / 10}k characters)</span> : null}
                    </div>
                ) : null}
            </div>

            <form data-own-shortcuts className="p-3 border-t border-border flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
                <textarea
                    aria-label="Describe the flow or the change"
                    className="w-full min-h-20 max-h-48 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    placeholder={messages.length ? 'Ask for a change, e.g. "add a step that checks the tone"' : 'e.g. "Take a blog post URL, summarize it and write 3 tweets"'}
                    value={text}
                    disabled={!ready}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key == 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
                    }}
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line</span>
                    {busy ? (
                        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={stopAssistant}><Square size={12} /> Stop</Button>
                    ) : (
                        <Button type="submit" size="sm" className="gap-1" disabled={!ready || !text.trim()}><SendHorizontal size={14} /> Send</Button>
                    )}
                </div>
            </form>
        </div>
    )
}

const EMPTY: ChatMessage[] = []

/** Turns on sample answers (no real AI requests). */
function turnOnSampleAnswers() {
    useSettingStore.getState().setSettings({ sampleAnswers: true })
}
