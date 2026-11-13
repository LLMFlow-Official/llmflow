import { Split } from 'lucide-react';
import { cloneDeep, get, set } from 'lodash';
import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { getOutgoers } from '@xyflow/react';
import { AppContext, Controller, getNodeDetails, NodeConnectDisconnectPayload, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData, UpdatePayload, useFlowStore } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { parseJsonOutput } from '@/lib/openai';
import { NormalizedUsage } from '@/lib/openai/models';
import { runChat } from '@/lib/providers';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { UsageStats } from '../node_utils/stats';
import { ModelNodeData, ModelSelect, modelSummary, nodeModel, nodeProvider, ReasoningEffortSelect } from '../node_utils/model_select';
import { NameField, NodeShell, TemplateField, TestOutputField } from '../node_utils/node_shell';

type Route = { name?: string, description?: string }

type RouterData = NodeData & ModelNodeData & {
    instruction?: string
    input?: string
    /** Keyed by the id of the node each route leads to. */
    routes?: Record<string, Route | null>
    test_output?: string
}

const MISSING_NAME_LABEL = 'Route name required'

export const OnConnect = async (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => {
    const edge = payload.connectedEdge
    if (!edge || payload.sourceNode.type != 'llm_router') return
    updates.edges[edge.id] = { animated: true, label: MISSING_NAME_LABEL, labelBgPadding: [5, 5] }
}

export const OnDisconnect = async (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => {
    if (payload.sourceNode.type != 'llm_router') return
    set(updates, `nodes.${payload.sourceNode.id}.data.routes.${payload.targetNode.id}`, null)
}

export const Metadata: NodeMetaData = {
    type: 'llm_router',
    category: 'ai',
    icon: Split,
    name: 'AI Router',
    description: 'Let a model choose which branch to follow, based on what the input means',
    tags: ['route', 'router', 'classify', 'decision', 'branch', 'ai', 'if'],
    OnConnect,
    OnDisconnect,
}

export const Outputs = (node: AppNode<RouterData>, extra: OutputExtra) => ({
    name: { title: 'Step name', value: node.data.name },
    route: { title: 'Chosen route', description: 'Name of the route the model picked', value: extra.route as string },
    reason: { title: 'Reason', description: "The model's short explanation", value: extra.reason as string },
} as NodeOutput)

type LogViewPayload = { route: string, reason: string, usage: NormalizedUsage, amount: number | null, startTime: number, endTime: number }

export function LogView({ payload }: NodeLogViewProps<LogViewPayload>) {
    return <>
        <div className='bg-accent p-2 text-xs rounded-md border border-border flex flex-col gap-1'>
            <span><b>Route:</b> {payload.route}</span>
            <span><b>Reason:</b> {payload.reason}</span>
        </div>
        <UsageStats usage={payload.usage} amount={payload.amount} startTime={payload.startTime} endTime={payload.endTime} />
    </>
}

export const Process = async (context: AppContext, node: AppNode<RouterData>, nextNodes: AppNode[], controller: Controller) => {
    const routes = nextNodes
        .map(target => ({ target, route: node.data.routes?.[target.id] }))
        .filter(x => x.route?.name?.trim())
        .map(x => ({ target: x.target, name: x.route!.name!.trim(), description: x.route!.description?.trim() }))

    if (nextNodes.length == 0) throw Error("Connect at least one node to route to")
    if (routes.length == 0) throw Error("Give each connected route a name")
    const names = routes.map(x => x.name)
    const duplicate = names.find((x, i) => names.indexOf(x) != i)
    if (duplicate) throw Error(`Route names must be different ("${duplicate}" is used twice)`)

    const input = renderTextTemplate(node.data.input || '', context)
    if (!input.trim()) throw Error("Input is required")

    const instruction = renderTextTemplate(node.data.instruction || '', context)
    const systemPrompt = [
        'Choose the single best route for the input and explain why in one short sentence.',
        instruction ? `Instructions: ${instruction}` : '',
        'Routes:',
        ...routes.map(x => `- ${x.name}${x.description ? `: ${x.description}` : ''}`),
    ].filter(Boolean).join('\n')

    const testOutput = node.data.test_output ? JSON.stringify({ route: node.data.test_output.trim(), reason: 'Sample answer' }) : undefined
    const run = await runChat({
        provider: nodeProvider(node.data),
        model: nodeModel(node.data),
        systemPrompt,
        messages: [{ role: 'user', content: input }],
        responseFormat: 'json_schema',
        responseSchema: {
            name: 'route_choice',
            strict: true,
            schema: {
                type: 'object',
                properties: {
                    route: { type: 'string', enum: names },
                    reason: { type: 'string' },
                },
                required: ['route', 'reason'],
                additionalProperties: false,
            },
        },
        reasoningEffort: node.data.reasoning_effort,
    }, controller, { nodeId: node.id, testOutput })

    const choice = parseJsonOutput(run.text) as { route?: string, reason?: string }
    const picked = routes.find(x => x.name.toLowerCase() == String(choice.route || '').trim().toLowerCase())
    if (!picked) throw Error(`The model picked "${choice.route}", which is not one of the routes: ${names.join(', ')}`)

    context[node.id] = { name: node.data.name, route: picked.name, reason: choice.reason || '' }
    controller.log({
        id: node.id,
        type: 'success',
        title: `Routed to "${picked.name}"`,
        nodeType: node.type,
        payload: {
            route: picked.name,
            reason: choice.reason || '',
            usage: run.usage,
            amount: run.cost === null ? null : run.cost.toNumber(),
            startTime: run.startTime,
            endTime: run.endTime,
        } as LogViewPayload
    })

    return [picked.target]
}

export const Properties = ({ node }: { node: AppNode<RouterData> }) => {
    const { updateNode, updateEdge, nodes, edges } = useFlowStore(useShallow(state => ({
        updateNode: state.updateNode,
        updateEdge: state.updateEdge,
        nodes: state.nodes,
        edges: state.edges
    })));

    const outgoers = useMemo(() => getOutgoers(node, nodes, edges).map(x => ({
        target: x,
        details: getNodeDetails(x.type)
    })), [node, nodes, edges])

    const setRoute = (targetId: string, key: keyof Route, value: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.routes.${targetId}.${key}`, value);
        updateNode(clonedNode);

        const edge = edges.find(x => x.source == node.id && x.target == targetId)
        if (!edge) return
        const name = get(clonedNode, `data.routes.${targetId}.name`, '') as string
        updateEdge({ ...cloneDeep(edge), animated: !name.trim(), label: name.trim() || MISSING_NAME_LABEL })
    }

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <ModelSelect node={node} />
            <ReasoningEffortSelect node={node} />
            <TemplateField
                node={node}
                field='input'
                label='Input'
                placeholder='{start.message}'
                help='The text the model reads to choose a route.'
            />
            <TemplateField
                node={node}
                field='instruction'
                label='Instructions'
                placeholder='e.g. Route support emails by what the customer needs'
                help='Optional extra guidance for choosing.'
            />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Routes</Label>
                {outgoers.length == 0 ? (
                    <p className='text-xs text-muted-foreground'>Connect this node to the nodes it can route to. Each connection becomes a route.</p>
                ) : outgoers.map(({ target, details }) => (
                    <Card key={target.id} className='flex flex-col gap-2 p-3'>
                        <span className='text-sm font-semibold'>{target.data.name ? `${target.data.name} (${details.name})` : `${details.name} (${target.id})`}</span>
                        <Input
                            value={node.data.routes?.[target.id]?.name || ''}
                            placeholder='Route name, e.g. refund'
                            onChange={(e) => setRoute(target.id, 'name', e.target.value)}
                        />
                        <Input
                            value={node.data.routes?.[target.id]?.description || ''}
                            placeholder='When to choose it (optional)'
                            onChange={(e) => setRoute(target.id, 'description', e.target.value)}
                        />
                    </Card>
                ))}
            </div>
            <TestOutputField node={node as AppNode} label='Sample route' help='With sample answers on, the router picks the route with this name.' />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} sourceType='multi' summary={modelSummary(props.data as ModelNodeData)} />
}
