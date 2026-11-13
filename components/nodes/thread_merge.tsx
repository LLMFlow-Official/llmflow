import { NodeShell } from '../node_utils/node_shell';
import { Merge } from 'lucide-react';
import { AppContext, NodeMetaData } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp } from '@/lib/store';
import { cloneDeep, set } from 'lodash';
import { Label } from '../ui/label';
import { Input } from '../ui/input';

export const Metadata: NodeMetaData = {
    type: 'thread_merge',
    category: 'logic',
    icon: Merge,
    name: 'Wait for all',
    description: 'Wait until every branch started by Run in parallel has finished, then continue',
    tags: ['await', 'sync']
}

// The engine runs a node with several inputs only after all of them have finished or been
// skipped (see lib/engine.ts), so no waiting is needed here.
export const Process = async (context: AppContext, node: AppNode, nextNodes: AppNode[]) => {
    context[node.id] = { name: node.data.name as string }
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode }) => {
    const updateNode = useFlowStore(state => state.updateNode);

    const setValue = (key: string, value: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.${key}`, value);
        updateNode(clonedNode);
    }

    return (
        <div className='flex flex-col gap-2 px-3'>
            <div className='flex flex-col gap-1'>
                <Label>Name</Label>
                <Input
                    name="name"
                    value={node.data.name as string}
                    placeholder={Metadata.name}
                    onChange={(e) => setValue('name', e.target.value)}
                />
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} targetType='multi' />
}
