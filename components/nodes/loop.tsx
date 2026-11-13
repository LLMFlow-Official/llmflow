import { Repeat } from 'lucide-react';
import { cloneDeep, set } from 'lodash';
import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { getOutgoers } from '@xyflow/react';
import { AppContext, Controller, getNodeDetails, NodeConnectDisconnectPayload, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, createStopSignal, NodeData, UpdatePayload, useFlowStore, useRuntimeStore } from '@/lib/store';
import { resolveList, resolveTemplateValue, runStatement, validateStatement } from '@/lib/logics';
import { BranchError, EngineController } from '@/lib/engine';
import { CodeStoppedError } from '@/lib/code_runner';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NameField, NodeShell, TemplateField, useNodeSetter } from '../node_utils/node_shell';

type Route = 'each' | 'done'

type LoopData = NodeData & {
    mode?: 'for_each' | 'repeat'
    items?: string
    concurrency?: number
    until?: string
    max_iterations?: number
    collect?: string
    /** Keyed by target node id. */
    routes?: Record<string, Route | null>
}

const MAX_ITEMS = 200
const ROUTE_LABELS: Record<Route, string> = { each: 'Each item', done: 'After loop' }
const MISSING_LABEL = 'Each item or After loop?'

export const OnConnect = async (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => {
    const edge = payload.connectedEdge
    if (!edge || payload.sourceNode.type != 'loop') return
    updates.edges[edge.id] = { animated: true, label: MISSING_LABEL, labelBgPadding: [5, 5] }
}

export const OnDisconnect = async (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => {
    if (payload.sourceNode.type != 'loop') return
    set(updates, `nodes.${payload.sourceNode.id}.data.routes.${payload.targetNode.id}`, null)
}

export const Metadata: NodeMetaData = {
    type: 'loop',
    category: 'logic',
    icon: Repeat,
    name: 'Loop',
    description: 'Run the connected "Each item" steps once per item of a list, or repeat them until a condition is true',
    tags: ['loop', 'for each', 'repeat', 'iterate', 'map', 'batch', 'until', 'while'],
    OnConnect,
    OnDisconnect,
    bodyTargets: (node: AppNode) => Object.entries((node.data as LoopData).routes || {})
        .filter(([, route]) => route == 'each')
        .map(([id]) => id),
}

export const Outputs = (node: AppNode<LoopData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    item: { title: 'Current item', description: 'Inside the loop: the item being processed', value: extra.item as string },
    index: { title: 'Current index', description: 'Inside the loop: 0 for the first item', value: extra.index as number },
    results: { title: 'Results', description: 'After the loop: the "Result for each item" values, as a list', value: extra.results as string },
    count: { title: 'Count', description: 'After the loop: how many times it ran', value: extra.count as number },
    last: { title: 'Last result', description: 'After the loop: the final result', value: extra.last as string },
} as NodeOutput)

type LogPayload = { results: unknown[] }

export function LogView({ payload }: NodeLogViewProps<LogPayload>) {
    return (
        <div className='bg-accent p-2 text-xs rounded-md whitespace-pre-wrap max-h-40 overflow-y-auto border border-border font-mono'>
            {JSON.stringify(payload.results, null, 2)}
        </div>
    )
}

export const Process = async (context: AppContext, node: AppNode<LoopData>, nextNodes: AppNode[], controller: Controller) => {
    const runBranch = (controller as EngineController).runBranch
    const routes = node.data.routes || {}
    const unassigned = nextNodes.filter(x => !routes[x.id])
    if (unassigned.length) throw Error(`Choose "Each item" or "After loop" for every connection (${unassigned.map(x => x.data.name || x.id).join(', ')})`)

    const bodyIds = nextNodes.filter(x => routes[x.id] == 'each').map(x => x.id)
    const after = nextNodes.filter(x => routes[x.id] == 'done')
    if (!bodyIds.length) throw Error('Connect at least one node as "Each item"')

    const mode = node.data.mode || 'for_each'
    const name = node.data.name
    const results: unknown[] = []
    const collect = (iterationContext: AppContext) => node.data.collect?.trim() ? resolveTemplateValue(node.data.collect, iterationContext) : null
    const describeFailure = (label: string, error: unknown) => {
        if (error instanceof BranchError) return Error(`${label} failed at "${(error.node.data.name as string) || error.node.id}": ${error.message}`)
        return error instanceof Error ? Error(`${label} failed: ${error.message}`) : Error(`${label} failed`)
    }
    const running = () => useRuntimeStore.getState().isRunning
    // Each item gets its own copy so items cannot overwrite each other's values (including Set State).
    const copyContext = (base: AppContext, extra: Record<string, unknown>): AppContext => ({
        ...base,
        state: { ...(base.state || {}) },
        [node.id]: { name, ...extra },
    } as AppContext)

    if (mode == 'for_each') {
        const items = resolveList(node.data.items || '', context)
        if (items.length > MAX_ITEMS) throw Error(`The list has ${items.length} items; the limit is ${MAX_ITEMS}`)
        const concurrency = Math.min(Math.max(node.data.concurrency || 1, 1), 10)
        const slots: unknown[] = new Array(items.length)
        let nextIndex = 0

        const worker = async () => {
            while (nextIndex < items.length && running()) {
                const index = nextIndex++
                controller.log({ id: node.id, type: 'info', title: `Item ${index + 1} of ${items.length}`, nodeType: node.type })
                const iterationContext = copyContext(context, { item: items[index], index, count: items.length })
                try {
                    await runBranch(bodyIds, iterationContext)
                } catch (error) {
                    throw describeFailure(`Item ${index + 1}`, error)
                }
                slots[index] = collect(iterationContext)
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
        if (!running()) return []
        results.push(...slots)
    } else {
        const max = Math.min(Math.max(node.data.max_iterations || 5, 1), 50)
        const until = node.data.until?.trim()
        if (until && !validateStatement(until)) throw Error("The stop condition is not a valid expression")

        let current = context
        for (let index = 0; index < max && running(); index++) {
            controller.log({ id: node.id, type: 'info', title: `Round ${index + 1}`, nodeType: node.type })
            // Each round starts from the previous round's values, so steps can build on their last output.
            const iterationContext = copyContext(current, { item: index, index, count: index + 1, results: [...results], last: results.at(-1) })
            try {
                await runBranch(bodyIds, iterationContext)
            } catch (error) {
                throw describeFailure(`Round ${index + 1}`, error)
            }
            results.push(collect(iterationContext))
            current = iterationContext

            if (until) {
                const { signal, dispose } = createStopSignal()
                try {
                    if (await runStatement(until, iterationContext, signal)) break
                } catch (error) {
                    if (error instanceof CodeStoppedError) return []
                    throw error
                } finally {
                    dispose()
                }
            }
        }
        if (!running()) return []
        // Steps after the loop can read the outputs of the last round.
        for (const key of Object.keys(current)) {
            if (key != node.id) context[key] = current[key]
        }
    }

    context[node.id] = { name, results: results as object, count: results.length, last: results.at(-1) as object }
    controller.log({
        id: node.id,
        type: 'success',
        title: mode == 'for_each' ? `Ran ${results.length} item${results.length == 1 ? '' : 's'}` : `Ran ${results.length} round${results.length == 1 ? '' : 's'}`,
        nodeType: node.type,
        payload: { results } as LogPayload,
    })
    return after
}

export const Properties = ({ node }: { node: AppNode<LoopData> }) => {
    const setValue = useNodeSetter(node)
    const { updateNode, updateEdge, nodes, edges } = useFlowStore(useShallow(state => ({
        updateNode: state.updateNode,
        updateEdge: state.updateEdge,
        nodes: state.nodes,
        edges: state.edges
    })));
    const mode = node.data.mode || 'for_each'
    const untilValid = useMemo(() => !node.data.until || validateStatement(node.data.until), [node.data.until])

    const outgoers = useMemo(() => getOutgoers(node, nodes, edges).map(x => ({ target: x, details: getNodeDetails(x.type) })), [node, nodes, edges])

    const setRoute = (targetId: string, route: Route) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.routes.${targetId}`, route);
        updateNode(clonedNode);
        const edge = edges.find(x => x.source == node.id && x.target == targetId)
        if (edge) updateEdge({ ...cloneDeep(edge), animated: false, label: ROUTE_LABELS[route] })
    }

    const setNumber = (key: string, raw: string, max: number) => {
        const value = parseInt(raw, 10)
        setValue(key, Number.isFinite(value) && value > 0 ? Math.min(value, max) : undefined)
    }

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Mode</Label>
                <Select value={mode} onValueChange={(e) => setValue('mode', e == 'for_each' ? undefined : e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value='for_each'>For each item in a list</SelectItem>
                        <SelectItem value='repeat'>Repeat until a condition is true</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {mode == 'for_each' ? <>
                <TemplateField
                    node={node}
                    field='items'
                    label='List'
                    placeholder='{split_x.chunks}'
                    help={`A list from an earlier node, a JSON array, or one item per line. Up to ${MAX_ITEMS} items. Inside the loop use {${node.id}.item} and {${node.id}.index}.`}
                />
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold' htmlFor='concurrency'>Items at the same time</Label>
                    <Input id='concurrency' type='number' min={1} max={10} value={node.data.concurrency ?? ''} placeholder='1' onChange={(e) => setNumber('concurrency', e.target.value, 10)} />
                    <p className='text-xs text-muted-foreground'>1 runs items one after another. Up to 10.</p>
                </div>
            </> : <>
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold' htmlFor='until'>Stop when</Label>
                    <Textarea
                        id='until'
                        value={node.data.until || ''}
                        className='h-16'
                        placeholder='{prompt_x.assistant_raw_output}.includes("DONE")'
                        onChange={(e) => setValue('until', e.target.value)}
                        node={node}
                        withoutRichText
                    />
                    {untilValid
                        ? <p className='text-xs text-muted-foreground'>Checked after each round. Leave empty to always run the maximum. Each round sees the previous round&apos;s outputs; {`{${node.id}.index}`} is the round number from 0.</p>
                        : <p className='text-xs text-danger'>This is not a valid expression.</p>}
                </div>
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold' htmlFor='max_iterations'>Maximum rounds</Label>
                    <Input id='max_iterations' type='number' min={1} max={50} value={node.data.max_iterations ?? ''} placeholder='5' onChange={(e) => setNumber('max_iterations', e.target.value, 50)} />
                </div>
            </>}
            <TemplateField
                node={node}
                field='collect'
                label={mode == 'for_each' ? 'Result for each item' : 'Result for each round'}
                placeholder='{prompt_x.assistant_raw_output}'
                help={`Saved after every ${mode == 'for_each' ? 'item' : 'round'}; all of them become {${node.id}.results}.`}
            />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Connections</Label>
                {outgoers.length == 0 ? (
                    <p className='text-xs text-muted-foreground'>Connect the first step of the loop and set it to &quot;Each item&quot;. Connect what comes next and set it to &quot;After loop&quot;. Steps inside the loop must not connect to steps after it.</p>
                ) : outgoers.map(({ target, details }) => (
                    <Card key={target.id} className='flex items-center gap-2 p-2'>
                        <span className='text-sm flex-1 truncate'>{target.data.name || details.name}</span>
                        <Select value={node.data.routes?.[target.id] || ''} onValueChange={(e) => setRoute(target.id, e as Route)}>
                            <SelectTrigger className='w-36'><SelectValue placeholder='Choose…' /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value='each'>{ROUTE_LABELS.each}</SelectItem>
                                <SelectItem value='done'>{ROUTE_LABELS.done}</SelectItem>
                            </SelectContent>
                        </Select>
                    </Card>
                ))}
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} sourceType='multi' />
}
