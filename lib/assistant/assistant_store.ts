import { create } from 'zustand'
import type { Edge } from '@xyflow/react'
import type { AppNode } from '../store'

export type ChatMessage = {
    id: string
    role: 'user' | 'assistant' | 'error'
    text: string
    /** What the reply changed on the canvas. */
    changes?: { added: string[], removed: string[], changed: string[] }
    /** Problems the automatic fix could not solve (the change was still applied). */
    warnings?: string[]
    cost?: string
    /** The flow before this reply's change, for Undo. */
    before?: { nodes: AppNode[], edges: Edge[] }
    /** The flow right after the change, to notice edits made since then. */
    after?: string
    undone?: boolean
    /** Error messages: the request that failed, for Retry. */
    retry?: string
}

type AssistantState = {
    /** Conversations per saved flow id (also kept in this browser, see saveChat). */
    chats: Record<string, ChatMessage[]>
    busy: boolean
    /** What the assistant is doing right now ("Designing the flow", "Fixing 2 problems"...). */
    status: string
    received: number
    abort?: AbortController
    add: (flowId: string, message: ChatMessage) => void
    update: (flowId: string, id: string, patch: Partial<ChatMessage>) => void
    clear: (flowId: string) => void
}

const CHAT_KEY = (flowId: string) => `llmflow-chat-${flowId}`

/** Chats are kept in this browser per flow (without the undo snapshots, which can be large). */
function loadChat(flowId: string): ChatMessage[] {
    try { return JSON.parse(localStorage.getItem(CHAT_KEY(flowId)) || '[]') } catch { return [] }
}

function saveChat(flowId: string, messages: ChatMessage[]) {
    try {
        const slim = messages.slice(-40).map(({ before, after, ...m }) => { void before; void after; return m })
        if (slim.length) localStorage.setItem(CHAT_KEY(flowId), JSON.stringify(slim))
        else localStorage.removeItem(CHAT_KEY(flowId))
    } catch { /* storage full or blocked: the chat stays in memory */ }
}

/** The chat of a flow: in memory, or from this browser's storage after a reload. */
export function chatOf(flowId: string): ChatMessage[] {
    const state = useAssistantStore.getState()
    if (!state.chats[flowId]) {
        const stored = loadChat(flowId)
        useAssistantStore.setState(s => ({ chats: { ...s.chats, [flowId]: stored } }))
        return stored
    }
    return state.chats[flowId]
}

export const useAssistantStore = create<AssistantState>()(set => ({
    chats: {},
    busy: false,
    status: '',
    received: 0,
    add: (flowId, message) => set(s => ({ chats: { ...s.chats, [flowId]: [...(s.chats[flowId] || []), message] } })),
    update: (flowId, id, patch) => set(s => ({ chats: { ...s.chats, [flowId]: (s.chats[flowId] || []).map(m => m.id == id ? { ...m, ...patch } : m) } })),
    clear: flowId => set(s => ({ chats: { ...s.chats, [flowId]: [] } })),
}))

// Save a flow's chat whenever it changes.
useAssistantStore.subscribe((state, previous) => {
    for (const [flowId, messages] of Object.entries(state.chats)) {
        if (messages !== previous.chats[flowId] && previous.chats[flowId] !== undefined) saveChat(flowId, messages)
    }
})
