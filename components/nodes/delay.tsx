import { Hourglass } from 'lucide-react';
import { AppContext, Controller, NodeMetaData, NodeOutput } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { NameField, NodeShell, useNodeSetter, waitWhileRunning } from '../node_utils/node_shell';

const MAX_SECONDS = 600

type DelayData = NodeData & {
    seconds?: number
}

export const Metadata: NodeMetaData = {
    type: 'delay',
    category: 'logic',
    name: 'Delay',
    description: 'Wait a number of seconds before continuing, e.g. to stay under rate limits',
    tags: ['wait', 'sleep', 'pause', 'timer', 'rate limit'],
}

export const Outputs = (node: AppNode<DelayData>) => ({
    name: { title: 'Node name', value: node.data.name },
} as NodeOutput)

export const Process = async (context: AppContext, node: AppNode<DelayData>, nextNodes: AppNode[], controller: Controller) => {
    const seconds = Math.min(Math.max(node.data.seconds ?? 1, 0), MAX_SECONDS)
    const finished = await waitWhileRunning(seconds * 1000)
    if (!finished) return []

    context[node.id] = { name: node.data.name }
    controller.log({ id: node.id, type: 'info', title: `Waited ${seconds} second${seconds == 1 ? '' : 's'}`, nodeType: node.type })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<DelayData> }) => {
    const setValue = useNodeSetter(node)
    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='seconds'>Seconds</Label>
                <Input
                    id='seconds'
                    type='number'
                    min={0}
                    max={MAX_SECONDS}
                    step={0.5}
                    value={node.data.seconds ?? ''}
                    placeholder='1'
                    onChange={(e) => {
                        const value = parseFloat(e.target.value)
                        setValue('seconds', Number.isFinite(value) ? Math.min(Math.max(value, 0), MAX_SECONDS) : undefined)
                    }}
                />
                <p className='text-xs text-muted-foreground'>Up to {MAX_SECONDS / 60} minutes. Stopping the flow ends the wait.</p>
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Hourglass} defaultName={Metadata.name} category={Metadata.category} />
}
