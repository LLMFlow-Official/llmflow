import { Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppContext, Controller, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { backend, useLibraryStore } from '@/lib/library';
import { runNested, startInputs } from '@/lib/run_flow';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NameField, NodeShell, TemplateField, useNodeSetter } from '../node_utils/node_shell';

type SubFlowData = NodeData & {
    flow_id?: string
    /** Start input name -> template. */
    inputs?: Record<string, string>
}

export const Metadata: NodeMetaData = {
    type: 'sub_flow',
    category: 'logic',
    icon: Workflow,
    name: 'Sub-flow',
    description: 'Run another saved flow as one step and use its Final Output values',
    tags: ['sub-flow', 'subflow', 'reuse', 'call', 'flow', 'function', 'module'],
}

export const Outputs = (node: AppNode<SubFlowData>, extra: OutputExtra) => ({
    name: { title: 'Step name', value: node.data.name },
    result: { title: 'Result', description: 'The first Final Output value of the flow', value: extra.result as string },
    outputs: { title: 'All outputs', description: 'Every Final Output value, by its node name (e.g. {node.outputs.Result})', value: extra.outputs as string },
} as NodeOutput)

export const Process = async (context: AppContext, node: AppNode<SubFlowData>, nextNodes: AppNode[], controller: Controller) => {
    if (!node.data.flow_id) throw Error("Choose the flow to run")
    const flow = await (await backend()).getFlow(node.data.flow_id)
    if (!flow) throw Error("The chosen flow no longer exists")

    const startValues = Object.fromEntries(Object.entries(node.data.inputs || {}).map(([name, template]) => [name, renderTextTemplate(template, context)]))
    const chain = (controller as { flowChain?: string[] }).flowChain || [useLibraryStore.getState().currentId || '']
    const finals = await runNested({ flowId: flow.id, flowName: flow.name, nodes: flow.nodes, edges: flow.edges, startValues, controller, chain })

    const outputs = Object.fromEntries(finals.map(x => [x.name, x.value]))
    context[node.id] = { name: node.data.name, result: finals[0]?.value, outputs }
    controller.log({ id: node.id, type: 'success', title: `Ran "${flow.name}"`, nodeType: node.type, payload: finals.length ? finals.map(x => `${x.name}: ${x.value}`).join('\n\n') : 'The flow has no Final Output node.' })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<SubFlowData> }) => {
    const setValue = useNodeSetter(node)
    const flows = useLibraryStore((s) => s.flows)
    const currentId = useLibraryStore((s) => s.currentId)
    const [loaded, setLoaded] = useState<{ flowId: string, inputs: string[] }>()

    useEffect(() => {
        let cancelled = false
        const flowId = node.data.flow_id
        if (!flowId) return
        backend().then(db => db.getFlow(flowId)).then(flow => {
            if (!cancelled) setLoaded({ flowId, inputs: flow ? startInputs(flow.nodes) : [] })
        })
        return () => { cancelled = true }
    }, [node.data.flow_id])
    const inputs = loaded && loaded.flowId == node.data.flow_id ? loaded.inputs : []

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label htmlFor="sub-flow" className='text-sm font-semibold'>Flow to run</Label>
                <Select value={node.data.flow_id || ''} onValueChange={(id) => setValue('flow_id', id)}>
                    <SelectTrigger id="sub-flow" aria-label='Flow to run'><SelectValue placeholder='Choose a saved flow' /></SelectTrigger>
                    <SelectContent>
                        {flows.filter(f => f.id != currentId).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <p className='text-xs text-muted-foreground'>Its Final Output nodes become this node&apos;s outputs. Changes to that flow apply the next time this runs.</p>
            </div>
            {inputs.length ? <div className='flex flex-col gap-2'>
                <Label className='text-sm font-semibold'>Inputs</Label>
                {inputs.map(name => (
                    <TemplateField key={name} node={node} field={`inputs.${name}`} label={name} className='h-12 min-h-0' placeholder={`Value for "${name}"`} />
                ))}
            </div> : node.data.flow_id ? <p className='text-xs text-muted-foreground'>That flow&apos;s Start node has no inputs.</p> : null}
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
