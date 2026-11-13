import { create } from 'zustand'
import { debounce } from 'lodash'
import type { Edge } from '@xyflow/react'
import type { AppNode, FinalOutput, NodeLogs } from './store'

/**
 * The flow library: every saved flow and its run history, kept in IndexedDB in this browser.
 * Falls back to localStorage when IndexedDB is not available (some private-browsing modes).
 */

export type SavedFlow = {
    id: string
    name: string
    nodes: AppNode[]
    edges: Edge[]
    createdAt: number
    updatedAt: number
}

export type FlowSummary = Pick<SavedFlow, 'id' | 'name' | 'updatedAt'>

export type RunRecord = {
    id: string
    flowId: string
    startedAt: number
    durationMs: number
    status: 'completed' | 'failed' | 'stopped'
    cost: number
    costIncomplete: boolean
    inTokens: number
    outTokens: number
    finalOutputs: FinalOutput[]
    logs: NodeLogs[]
    startValues?: Record<string, unknown>
    /** The flow as it was when it ran (runs saved since this was added), for "Restore this version". */
    flow?: { nodes: AppNode[], edges: Edge[] }
}

const DB_NAME = 'llmflow'
const RUNS_PER_FLOW = 50
const CURRENT_KEY = 'llmflow-current-flow'
const LEGACY_FLOW_KEY = 'flow-store'
const FALLBACK_KEY = 'llmflow-library'

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const starterNodes = (): AppNode[] => [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { thread: 'main' } } as AppNode]

/* ---------------- Storage backends ---------------- */

type Backend = {
    allFlows: () => Promise<SavedFlow[]>
    getFlow: (id: string) => Promise<SavedFlow | undefined>
    putFlow: (flow: SavedFlow) => Promise<void>
    deleteFlow: (id: string) => Promise<void>
    runsFor: (flowId: string) => Promise<RunRecord[]>
    putRun: (run: RunRecord) => Promise<void>
    deleteRun: (id: string) => Promise<void>
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function indexedDbBackend(): Promise<Backend> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, 1)
        open.onupgradeneeded = () => {
            const d = open.result
            if (!d.objectStoreNames.contains('flows')) d.createObjectStore('flows', { keyPath: 'id' })
            if (!d.objectStoreNames.contains('runs')) d.createObjectStore('runs', { keyPath: 'id' }).createIndex('flowId', 'flowId')
        }
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
    })
    const store = (name: 'flows' | 'runs', mode: IDBTransactionMode = 'readonly') => db.transaction(name, mode).objectStore(name)
    return {
        allFlows: () => request(store('flows').getAll() as IDBRequest<SavedFlow[]>),
        getFlow: (id) => request(store('flows').get(id) as IDBRequest<SavedFlow | undefined>),
        putFlow: async (flow) => { await request(store('flows', 'readwrite').put(flow)) },
        deleteFlow: async (id) => { await request(store('flows', 'readwrite').delete(id)) },
        runsFor: (flowId) => request(store('runs').index('flowId').getAll(flowId) as IDBRequest<RunRecord[]>),
        putRun: async (run) => { await request(store('runs', 'readwrite').put(run)) },
        deleteRun: async (id) => { await request(store('runs', 'readwrite').delete(id)) },
    }
}

function localStorageBackend(): Backend {
    type Data = { flows: SavedFlow[], runs: RunRecord[] }
    const read = (): Data => {
        try { return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '') } catch { return { flows: [], runs: [] } }
    }
    const write = (data: Data) => localStorage.setItem(FALLBACK_KEY, JSON.stringify(data))
    return {
        allFlows: async () => read().flows,
        getFlow: async (id) => read().flows.find(x => x.id == id),
        putFlow: async (flow) => { const d = read(); write({ ...d, flows: [...d.flows.filter(x => x.id != flow.id), flow] }) },
        deleteFlow: async (id) => { const d = read(); write({ flows: d.flows.filter(x => x.id != id), runs: d.runs.filter(x => x.flowId != id) }) },
        runsFor: async (flowId) => read().runs.filter(x => x.flowId == flowId),
        putRun: async (run) => { const d = read(); write({ ...d, runs: [...d.runs.filter(x => x.id != run.id), run] }) },
        deleteRun: async (id) => { const d = read(); write({ ...d, runs: d.runs.filter(x => x.id != id) }) },
    }
}

let backendPromise: Promise<Backend> | undefined
export function backend(): Promise<Backend> {
    if (!backendPromise) {
        backendPromise = (typeof indexedDB != 'undefined' ? indexedDbBackend() : Promise.reject(new Error('no IndexedDB')))
            .catch(() => localStorageBackend())
    }
    return backendPromise
}

/* ---------------- Library state ---------------- */

type LibraryState = {
    ready: boolean
    flows: FlowSummary[]
    currentId?: string
    currentName: string
    /** Increases each time a different flow is opened (the canvas re-fits its view). */
    revision: number
    /** Increases when a run is added to the history. */
    historyRevision?: number
    /** Autosave of the open flow: shown next to the flow name. */
    saveStatus: 'saved' | 'saving' | 'error'
    saveError?: string
    setFlows: (flows: FlowSummary[]) => void
}

export const useLibraryStore = create<LibraryState>()(set => ({
    ready: false,
    flows: [],
    currentName: '',
    revision: 0,
    saveStatus: 'saved',
    setFlows: flows => set({ flows }),
}))

const summary = (flow: SavedFlow): FlowSummary => ({ id: flow.id, name: flow.name, updatedAt: flow.updatedAt })

async function refreshList() {
    const flows = (await (await backend()).allFlows()).map(summary).sort((a, b) => b.updatedAt - a.updatedAt)
    useLibraryStore.setState({ flows })
    return flows
}

/** Loads a flow into the editor. `loadIntoEditor` is provided by the app (it sets nodes/edges and clears undo history). */
let loadIntoEditor: (nodes: AppNode[], edges: Edge[]) => void = () => { }
let readEditor: () => { nodes: AppNode[], edges: Edge[] } = () => ({ nodes: [], edges: [] })
let saving = Promise.resolve()

/** Writes the open flow now (autosave also does this shortly after every change). */
export async function saveCurrent() {
    const { currentId, currentName } = useLibraryStore.getState()
    if (!currentId) return
    const { nodes, edges } = readEditor()
    const db = await backend()
    const existing = await db.getFlow(currentId)
    const clean = nodes.map(({ selected, dragging, ...rest }) => { void selected; void dragging; return rest as AppNode })
    await db.putFlow({ id: currentId, name: currentName, nodes: clean, edges, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() })
    await refreshList()
}

/** Saves the open flow and keeps the save status up to date. */
function saveWithStatus() {
    saving = saving.then(async () => {
        useLibraryStore.setState({ saveStatus: 'saving' })
        try {
            await saveCurrent()
            useLibraryStore.setState({ saveStatus: 'saved', saveError: undefined })
        } catch (error) {
            console.error(error)
            useLibraryStore.setState({ saveStatus: 'error', saveError: (error as Error)?.message || String(error) })
        }
    })
    return saving
}

const autosave = debounce(saveWithStatus, 600)

/** Tries again after a failed save. */
export function retrySave() {
    return saveWithStatus()
}

export async function openFlow(id: string) {
    await flushSave()
    const flow = await (await backend()).getFlow(id)
    if (!flow) throw new Error('This flow no longer exists')
    useLibraryStore.setState(s => ({ currentId: flow.id, currentName: flow.name, revision: s.revision + 1 }))
    try { localStorage.setItem(CURRENT_KEY, flow.id) } catch { /* ignore */ }
    loadIntoEditor(flow.nodes, flow.edges)
}

export async function createFlow(name: string, nodes: AppNode[] = starterNodes(), edges: Edge[] = []) {
    await flushSave()
    const now = Date.now()
    const flow: SavedFlow = { id: newId('flow'), name: name.trim() || 'Untitled flow', nodes, edges, createdAt: now, updatedAt: now }
    await (await backend()).putFlow(flow)
    await refreshList()
    await openFlow(flow.id)
    return flow.id
}

export async function renameCurrent(name: string) {
    useLibraryStore.setState({ currentName: name.trim() || 'Untitled flow' })
    await saveCurrent()
}

export async function duplicateFlow(id: string) {
    await flushSave()
    const flow = await (await backend()).getFlow(id)
    if (!flow) return
    return createFlow(`${flow.name} (copy)`, flow.nodes, flow.edges)
}

export async function deleteFlow(id: string) {
    const db = await backend()
    for (const run of await db.runsFor(id)) await db.deleteRun(run.id)
    await db.deleteFlow(id)
    const flows = await refreshList()
    if (useLibraryStore.getState().currentId == id) {
        if (flows.length) await openFlow(flows[0].id)
        else await createFlow('My flow')
    }
}

export async function flushSave() {
    autosave.flush()
    await saving
}

/* ---------------- Run history ---------------- */

/** Replaces large values (images as data URLs) so history stays small. */
export function shrinkForHistory<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, v) => typeof v == 'string' && v.length > 20_000
        ? (v.startsWith('data:') ? '[image not kept in history]' : `${v.slice(0, 20_000)}… [cut]`)
        : v))
}

export async function saveRun(run: Omit<RunRecord, 'id'>) {
    const db = await backend()
    await db.putRun(shrinkForHistory({ ...run, id: newId('run') }))
    const runs = (await db.runsFor(run.flowId)).sort((a, b) => b.startedAt - a.startedAt)
    for (const old of runs.slice(RUNS_PER_FLOW)) await db.deleteRun(old.id)
}

export async function runsForFlow(flowId: string) {
    return (await (await backend()).runsFor(flowId)).sort((a, b) => b.startedAt - a.startedAt)
}

export async function deleteRun(id: string) {
    await (await backend()).deleteRun(id)
}

/* ---------------- Start-up ---------------- */

/**
 * Connects the library to the editor, moves a flow saved by older versions (in localStorage) into
 * the library, and opens the last used flow.
 */
export async function initLibrary(editor: {
    load: (nodes: AppNode[], edges: Edge[]) => void
    read: () => { nodes: AppNode[], edges: Edge[] }
    subscribe: (onChange: () => void) => () => void
}) {
    loadIntoEditor = editor.load
    readEditor = editor.read
    const db = await backend()
    let flows = await refreshList()

    if (!flows.length) {
        let nodes = starterNodes()
        let edges: Edge[] = []
        let legacy: string | null = null
        try { legacy = localStorage.getItem(LEGACY_FLOW_KEY) } catch { /* ignore */ }
        if (legacy) {
            try {
                const state = JSON.parse(legacy).state
                if (Array.isArray(state?.nodes) && state.nodes.length) {
                    nodes = state.nodes
                    edges = Array.isArray(state.edges) ? state.edges : []
                }
            } catch { /* keep the starter flow */ }
        }
        const now = Date.now()
        await db.putFlow({ id: newId('flow'), name: 'My flow', nodes, edges, createdAt: now, updatedAt: now })
        // Only remove the old copy once the library has it.
        if (legacy && (await db.allFlows()).length) {
            try { localStorage.removeItem(LEGACY_FLOW_KEY) } catch { /* ignore */ }
        }
        flows = await refreshList()
    }

    let current: string | null = null
    try { current = localStorage.getItem(CURRENT_KEY) } catch { /* ignore */ }
    await openFlow(flows.some(x => x.id == current) ? current! : flows[0].id)
    useLibraryStore.setState({ ready: true })
    editor.subscribe(() => autosave())
    if (typeof window != 'undefined') window.addEventListener('beforeunload', () => autosave.flush())
}
