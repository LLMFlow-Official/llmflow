import { toast } from '@/hooks/use-toast';
import { MOD_KEY } from './utils';
import { create, useStore } from 'zustand';
import { addEdge, applyNodeChanges, applyEdgeChanges, getOutgoers, NodeProps, getIncomers } from '@xyflow/react';
import { createComputed } from "zustand-computed";
import { persist, createJSONStorage } from 'zustand/middleware';
import { Edge, Node, OnNodesChange, OnEdgesChange, OnConnect } from '@xyflow/react';
import { getNodeDetails, NodeState, NodeType } from './nodes';
import type { ProviderId } from './openai/models';
import Decimal from 'decimal.js-light';
import { temporal, TemporalState } from 'zundo';
import { debounce, merge } from 'lodash';
import { deepEqual } from 'fast-equals';

export type NodeData = {
    thread: string
    name?: string
    parentId?: string
}

export type UpdatePayload = {
    edges: { [key: string]: Partial<Edge> | null },
    nodes: { [key: string]: Partial<AppNode> | null }
}

export type AppNodeProp = NodeProps & {
    data: NodeData
}

export type AppNode<T = NodeData> = Node & {
    type: NodeType
    data: T
};

export type NodeLogs<T = unknown> = {
    id: string
    type: 'info' | 'success' | 'error' | 'warning'
    title: string
    nodeType: NodeType
    payload?: T
}

export type AppState = {
    nodes: AppNode[];
    edges: Edge[];
    onNodesChange: OnNodesChange<AppNode>;
    onEdgesChange: OnEdgesChange;
    onConnect: OnConnect;
    pushNode: (node: AppNode) => void;
    setNodes: (nodes: AppNode[]) => void;
    setEdges: (edges: Edge[]) => void;
    updateNode: (updatedNode: AppNode) => void;
    updateEdge: (updatedEdge: Edge) => void;
    clearSelection: () => void;
};

export type HumanInputRequest = {
    nodeId: string
    title: string
    message: string
    mode: 'text' | 'approve' | 'file'
    placeholder?: string
    /** File mode: allowed file types for the file picker, e.g. "audio/*". */
    accept?: string
    /** Text mode: the typed value. Approve mode: "approved" or null when rejected. File mode: the file, or null if skipped. */
    respond: (value: string | File | null) => void
}

export type FinalOutput = {
    nodeId: string
    name: string
    value: string
}

export type RuntimeState = {
    isRunning: boolean;
    /** Human Input nodes waiting for the user, oldest first. */
    pendingInputs: HumanInputRequest[];
    /** Values from Final Output nodes in this run, in the order they finished. */
    finalOutputs: FinalOutput[];
    /** Text that AI nodes are writing right now, by node id. */
    streaming: Record<string, string>;
    appendStreaming: (nodeId: string, text: string) => void;
    clearStreaming: (nodeId: string) => void;
    requestInput: (request: HumanInputRequest) => void;
    resolveInput: (nodeId: string) => void;
    addFinalOutput: (output: FinalOutput) => void;
    nodeStates: {
        [key: string]: NodeState
    }
    logs: NodeLogs[];
    startTime?: number,
    endTime?: number,
    inToken: number;
    outToken: number;
    amount: number;
    /** True when a node used a model with unknown prices, so `amount` is a lower bound. */
    costIncomplete: boolean;
    start: () => void;
    stop: () => void;
    log: (payload: NodeLogs) => void;
    setNodeState: (nodeStates: { [key: string]: NodeState }) => void;
    setNodeStateFromNodeId: (nodeId: string, state: NodeState) => void;
    increaseInToken: (amount: number) => void;
    increaseOutToken: (amount: number) => void;
    increaseAmount: (amount: Decimal | null) => void;
    setInToken: (inToken: number) => void;
    setOutToken: (outToken: number) => void;
    setAmount: (amount: number) => void;
};

export type DevMode = {
    testOpenAPI: boolean;
    showTreads: boolean;
    showPropData: boolean;
}

export type ApiKeys = Record<ProviderId, string>

export type SettingsState = {
    apiKeys: ApiKeys;
    /** Base URL of an OpenAI-compatible server, e.g. http://localhost:11434/v1 for Ollama. */
    compatibleBaseUrl: string;
    /** Keep API keys in this browser between visits. When false they are kept in memory only. */
    rememberKeys: boolean;
    analyticsEnabled: boolean;
    theme: 'system' | 'light' | 'dark';
    /** Model the flow-building assistant uses (empty: pick from the providers with a key). */
    assistantProvider?: ProviderId;
    assistantModel?: string;
    /** At most this many AI requests run at the same time; others wait their turn. */
    maxParallelRequests: number;
    /** An AI request that takes longer than this is cancelled. */
    requestTimeoutSeconds: number;
    devMode?: DevMode;
    /** Model IDs loaded from the user's provider accounts. */
    accountModels: Partial<Record<ProviderId, string[]>>;
    setApiKey: (provider: ProviderId, key: string) => void;
    setSettings: (patch: Partial<Pick<SettingsState, 'compatibleBaseUrl' | 'rememberKeys' | 'analyticsEnabled' | 'maxParallelRequests' | 'requestTimeoutSeconds' | 'theme' | 'assistantProvider' | 'assistantModel'>>) => void;
    setRememberKeys: (value: boolean) => void;
    setAnalyticsEnabled: (value: boolean) => void;
    setAccountModels: (provider: ProviderId, models: string[]) => void;
    setDevMode: (value?: DevMode) => void;
};

const EMPTY_KEYS: ApiKeys = { openai: '', anthropic: '', google: '', compatible: '' }

export const useSettingStore = create<SettingsState>()(persist(set => ({
    apiKeys: EMPTY_KEYS,
    compatibleBaseUrl: '',
    rememberKeys: true,
    analyticsEnabled: true,
    theme: 'system',
    maxParallelRequests: 4,
    requestTimeoutSeconds: 600,
    devMode: undefined,
    accountModels: {},
    setApiKey: (provider, key) => set(state => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
    setSettings: patch => set(patch),
    setRememberKeys: rememberKeys => set({ rememberKeys }),
    setAnalyticsEnabled: analyticsEnabled => set({ analyticsEnabled }),
    setAccountModels: (provider, models) => set(state => ({ accountModels: { ...state.accountModels, [provider]: models } })),
    setDevMode: value => set({ devMode: value }),
}), {
    name: 'flow-setting-store',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    // Keys are only written to storage when the user chose to remember them.
    partialize: (state) => state.rememberKeys ? state : { ...state, apiKeys: EMPTY_KEYS },
    // Version 0 had a single OpenAI key and a flat list of OpenAI account models.
    migrate: (persisted, version) => {
        const state = (persisted || {}) as Record<string, unknown>
        if (version < 1) {
            state.apiKeys = { ...EMPTY_KEYS, openai: (state.openAIKey as string) || '' }
            state.accountModels = Array.isArray(state.accountModels) ? { openai: state.accountModels } : {}
            delete state.openAIKey
        }
        return state as unknown as SettingsState
    },
    merge: (persisted, current) => {
        const state = (persisted || {}) as Partial<SettingsState>
        return { ...current, ...state, apiKeys: { ...EMPTY_KEYS, ...(state.apiKeys || {}) } }
    },
}));

export const useRuntimeStore = create<RuntimeState>()(set => ({
    isRunning: false,
    nodeStates: {},
    logs: [],
    startTime: undefined,
    endTime: undefined,
    duration: 0,
    inToken: 0,
    outToken: 0,
    amount: 0,
    costIncomplete: false,
    pendingInputs: [],
    finalOutputs: [],
    streaming: {},
    appendStreaming: (nodeId, text) => set((state) => ({ streaming: { ...state.streaming, [nodeId]: (state.streaming[nodeId] || '') + text } })),
    clearStreaming: (nodeId) => set((state) => {
        const streaming = { ...state.streaming }
        delete streaming[nodeId]
        return { streaming }
    }),
    start: () => set({ streaming: {},  isRunning: true, startTime: new Date().getTime(), endTime: undefined, inToken: 0, outToken: 0, amount: 0, costIncomplete: false, logs: [], pendingInputs: [], finalOutputs: [] }),
    stop: () => set({ isRunning: false, endTime: new Date().getTime() }),
    requestInput: (request) => set((state) => ({ pendingInputs: [...state.pendingInputs, request] })),
    resolveInput: (nodeId) => set((state) => ({ pendingInputs: state.pendingInputs.filter(x => x.nodeId !== nodeId) })),
    addFinalOutput: (output) => set((state) => ({ finalOutputs: [...state.finalOutputs, output] })),
    log: (payload) => set((state) => ({ logs: [...state.logs, payload] })),
    setNodeState: (nodeStates) => set({ nodeStates }),
    setNodeStateFromNodeId: (nodeId, nodeState) => set((state) => ({ nodeStates: { ...state.nodeStates, [nodeId]: nodeState } })),
    increaseInToken: (amount) => set((state) => ({ inToken: state.inToken + amount })),
    increaseOutToken: (amount) => set((state) => ({ outToken: state.outToken + amount })),
    increaseAmount: (amount) => set((state) => amount === null
        ? { costIncomplete: true }
        : { amount: new Decimal(state.amount).add(amount).toNumber() }),
    setInToken: (inToken) => set({ inToken }),
    setOutToken: (outToken) => set({ outToken }),
    setAmount: (amount) => set({ amount }),
}));

const processOnConnect = (
    nodes: AppNode[],
    edges: Edge[],
    targetNode: AppNode,
    sourceNode: AppNode,
    newEdge: Edge,
    updates: UpdatePayload,
) => {
    const targetNodeDetails = getNodeDetails(targetNode.type);
    const sourceNodeDetails = getNodeDetails(sourceNode.type);

    if (targetNodeDetails.OnConnect) {
        targetNodeDetails.OnConnect({ nodes, edges, targetNode, sourceNode, connectedEdge: newEdge }, updates)
    }

    if (sourceNodeDetails.OnConnect) {
        sourceNodeDetails.OnConnect({ nodes, edges, targetNode, sourceNode, connectedEdge: newEdge }, updates);
    }
}

const processOnDisconnect = (
    nodes: AppNode[],
    edges: Edge[],
    targetNode: AppNode,
    sourceNode: AppNode,
    updates: UpdatePayload,
) => {
    const targetNodeDetails = getNodeDetails(targetNode.type);
    const sourceNodeDetails = getNodeDetails(sourceNode.type);

    if (targetNodeDetails.OnDisconnect) {
        targetNodeDetails.OnDisconnect({ nodes, edges, targetNode, sourceNode }, updates)
    }

    if (sourceNodeDetails.OnDisconnect) {
        sourceNodeDetails.OnDisconnect({ nodes, edges, targetNode, sourceNode }, updates);
    }
}

/** Says so when connections had to be removed because they now cross between branches. */
function reportRemovedConnections(updates: UpdatePayload) {
    const removed = Object.values(updates.edges).filter(x => x === null).length
    if (!removed) return
    toast({
        title: removed == 1 ? 'A connection was removed' : `${removed} connections were removed`,
        description: `They joined steps from different branches. Use a Wait for all step to bring branches together. Undo (${MOD_KEY}+Z) brings them back.`,
        duration: 8000,
    })
}

const processNodeThread = (
    node: { node: AppNode, parentNode?: AppNode, thread: string },
    nodes: AppNode[],
    edges: Edge[],
    updates: UpdatePayload
) => {
    const nodesToProcess = [node]
    while (nodesToProcess.length > 0) {
        const { node: currentNode, parentNode, thread } = nodesToProcess.pop()!;
        if (updates.nodes[currentNode.id] || (currentNode.data.thread == thread && currentNode.data.parentId == parentNode?.id)) continue;
        
        let newThread = parentNode && parentNode.type === 'multi_thread' ? Math.random().toString(16).slice(2) : thread
        if (currentNode.type === 'thread_merge') {
            const otherParents = getIncomers(currentNode, nodes, edges);
            if (parentNode || otherParents.length > 0) {
                const nodesWithUpdates = nodes.filter(node => updates.nodes[node.id] !== null).map(node => node.id in updates.nodes ? { ...merge(node, updates.nodes[node.id]) } : node)
                if (parentNode) {
                    otherParents.push(parentNode)
                }
                newThread = findParentMultiThreadNodeThread(otherParents, nodesWithUpdates, edges);
            }
        }

        updates['nodes'][currentNode.id] = merge(updates['nodes'][currentNode.id], { data:{ thread: newThread, parentId: parentNode?.id } });
        const children = getOutgoers(currentNode, nodes, edges);
        nodesToProcess.push(...children.map(child => ({ node: child, parentNode: currentNode, thread: newThread })));
    }

    const nodesWithUpdates = nodes.filter(node => updates.nodes[node.id] !== null).map(node => node.id in updates.nodes ? { ...merge(node, updates.nodes[node.id]) } : node)
    const edgeProcess = [nodesWithUpdates.find(x => x.id == node.node.id)!]
    const checked: {[key: string]: boolean} = {}
    while (edgeProcess.length > 0) {
        const currentNode = edgeProcess.pop()!;
        if (checked[currentNode.id]) continue;

        const parents = getIncomers(currentNode, nodesWithUpdates, edges);
        const notMatchingThreads = currentNode.type == 'thread_merge' ? [] : parents.filter(x => x.data.thread != currentNode.data.thread && x.type != 'multi_thread')
        const needToRemoveEdges = notMatchingThreads.map(x => edges.find(y => y.source == x.id && y.target == currentNode.id)!)

        needToRemoveEdges.forEach(x => {
            updates.edges[x.id] = null
        })

        checked[currentNode.id] = true
        const children = getOutgoers(currentNode, nodesWithUpdates, edges);
        edgeProcess.push(...children);
    }
};

export const findParentMultiThreadNodeThread = (
    nodesToProcess: AppNode[],
    nodes: AppNode[],
    edges: Edge[],
) => {
    while (nodesToProcess.length > 0) {
        const currentNode = nodesToProcess.pop()!;
        if (currentNode.type == 'multi_thread') return currentNode.data.thread
        const children = getIncomers(currentNode, nodes, edges);
        nodesToProcess.push(...children);
    }
    return Math.random().toString(16).slice(2)
}

const initialNodes: AppNode[] = [{
    id: 'start',
    type: 'start',
    position: { x: 0, y: 0 },
    data: { thread: 'main', state: 'idle' }
}];

const initialEdges: Edge[] = [];

const computed = createComputed((state: AppState) => ({
    isOnlyOneSelected: state.nodes.filter(node => node.selected).length === 1,
    selectedNode: state.nodes.find(node => node.selected)
}));

export const useTemporalFlowStore = <T,>(
    selector: (state: TemporalState<Partial<AppState>>) => T,
) => useStore(useFlowStore.temporal, selector);

export const useFlowStore = create<AppState>()(temporal(computed((set, get) => ({
    nodes: initialNodes,
    edges: initialEdges,
    onNodesChange: changes => {
        const filteredChanges = changes.filter(change => !(change.type === 'remove' && change.id === 'start'));
        set({ nodes: applyNodeChanges(filteredChanges, get().nodes) });
    },
    onEdgesChange: changes => {
        const { edges, nodes } = get();
        const newEdges = applyEdgeChanges(changes, edges)
        const removedEdgesId = changes.filter(change => change.type === 'remove').map(change => change.id);
        const removedEdges = edges.filter(edge => removedEdgesId.includes(edge.id));

        const updates: UpdatePayload = {
            edges: {},
            nodes: {}
        };

        for (const edge of removedEdges) {
            const targetNode = nodes.find(node => node.id === edge.target)!;
            const sourceNode = nodes.find(node => node.id === edge.source)!;

            if (targetNode.data.parentId !== sourceNode.id && targetNode.data.thread === sourceNode.data.thread) continue;

            processOnDisconnect(nodes, edges, targetNode, sourceNode, updates)
            const otherParents = getIncomers(targetNode, nodes, newEdges);
            const sourceThread = otherParents.length == 0 ? Math.random().toString(16).slice(2) : otherParents[0].data.thread;
            processNodeThread({ node: targetNode, thread:sourceThread }, nodes, newEdges, updates);
        }
        reportRemovedConnections(updates)

        set({
            edges: newEdges.filter(edge => updates.edges[edge.id] !== null).map(edge => edge.id in updates.edges ? { ...merge(edge, updates.edges[edge.id]) } : edge),
            nodes: nodes.filter(node => updates.nodes[node.id] !== null).map(node => node.id in updates.nodes ? { ...merge(node, updates.nodes[node.id]) } : node),
        });
    },
    onConnect: connection => {
        const { edges, nodes } = get();
        const newEdges = addEdge(connection, edges).map(x => (Object.fromEntries(Object.entries(x).filter(([key]) => !['markerEnd', 'style'].includes(key))) as Edge))
        const sourceNode = nodes.find(node => node.id === connection.source)!;
        const sourceThread = ((!sourceNode || sourceNode.type === 'multi_thread') ? Math.random().toString(16).slice(2) : sourceNode.data.thread) as string;
        const targetNode = nodes.find(node => node.id === connection.target)!;

        const updates: UpdatePayload = {
            edges: {},
            nodes: {}
        };

        if (targetNode.data.parentId !== sourceNode.id && targetNode.data.thread === sourceNode.data.thread) {
            set({ 
                edges: newEdges
            });
            return;
        };

        const newEdge = newEdges.find(x => x.source == sourceNode.id && x.target == targetNode.id)!
        processOnConnect(nodes, newEdges, targetNode, sourceNode, newEdge, updates)
        processNodeThread({ node: targetNode, parentNode: sourceNode, thread:sourceThread }, nodes, edges, updates);
        reportRemovedConnections(updates)

        set({
            edges: newEdges.filter(edge => updates.edges[edge.id] !== null).map(edge => edge.id in updates.edges ? { ...merge(edge, updates.edges[edge.id]) } : edge),
            nodes: nodes.filter(node => updates.nodes[node.id] !== null).map(node => node.id in updates.nodes ? { ...merge(node, updates.nodes[node.id]) } : node),
        });
    },
    pushNode: node => set((s) => ({ nodes: [...s.nodes, node] })),
    setNodes: nodes => set({ nodes }),
    setEdges: edges => set({ edges }),
    updateNode: updatedNode => set({
        nodes: get().nodes.map(node => node.id === updatedNode.id ? updatedNode : node)
    }),
    updateEdge: updatedEdge => set({
        edges: get().edges.map(edge => edge.id === updatedEdge.id ? updatedEdge : edge)
    }),
    clearSelection: () => set((s) => ({ nodes:s.nodes.map(x => ({...x, selected: false})), edges:s.edges.map(x => ({...x, selected: false})) }))
// Flows are saved in the flow library (lib/library.ts), not by this store.
})), {
    limit: 20,
    equality: deepEqual,
    handleSet: (handleSet) => debounce(handleSet, 1000, {
        leading: true,
        trailing: false,
    }),
    partialize: ({ nodes, edges }) => ({ nodes, edges }) as AppState
}));

/**
 * An AbortSignal that fires when the running flow is stopped. Call dispose() when the work is done.
 */
export function createStopSignal(): { signal: AbortSignal, dispose: () => void } {
    const controller = new AbortController()
    if (!useRuntimeStore.getState().isRunning) controller.abort()
    const unsubscribe = useRuntimeStore.subscribe((state, previous) => {
        if (previous.isRunning && !state.isRunning) controller.abort()
    })
    return { signal: controller.signal, dispose: unsubscribe }
}

/** Waits for the given time, returning false early if the flow is stopped. */
export function waitWhileRunning(ms: number): Promise<boolean> {
    return new Promise(resolve => {
        const end = Date.now() + ms
        const tick = () => {
            if (!useRuntimeStore.getState().isRunning) return resolve(false)
            if (Date.now() >= end) return resolve(true)
            setTimeout(tick, Math.min(100, end - Date.now()))
        }
        tick()
    })
}

const edgeKey = (edges: Edge[]) => edges.map(e => `${e.source}>${e.target}`).join('|')

/**
 * Clears the run marks when the flow's content changes after a run: a step's settings, a step
 * added or removed, or a connection changed. Selecting or moving steps keeps them.
 */
useFlowStore.subscribe((state, previous) => {
    if (state.nodes === previous.nodes && state.edges === previous.edges) return
    const runtime = useRuntimeStore.getState()
    if (runtime.isRunning || !Object.keys(runtime.nodeStates).length) return
    const changed = state.nodes.length != previous.nodes.length
        || state.nodes.some((node, i) => node.id != previous.nodes[i]?.id || node.data !== previous.nodes[i]?.data)
        || edgeKey(state.edges) != edgeKey(previous.edges)
    if (changed) runtime.setNodeState({})
})
