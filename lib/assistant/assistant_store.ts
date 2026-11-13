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
    undone?: boolean
}

type AssistantState = {
    /** Conversations per saved flow id. Kept in memory only. */
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

export const useAssistantStore = create<AssistantState>()(set => ({
    chats: {},
    busy: false,
    status: '',
    received: 0,
    add: (flowId, message) => set(s => ({ chats: { ...s.chats, [flowId]: [...(s.chats[flowId] || []), message] } })),
    update: (flowId, id, patch) => set(s => ({ chats: { ...s.chats, [flowId]: (s.chats[flowId] || []).map(m => m.id == id ? { ...m, ...patch } : m) } })),
    clear: flowId => set(s => ({ chats: { ...s.chats, [flowId]: [] } })),
}))
