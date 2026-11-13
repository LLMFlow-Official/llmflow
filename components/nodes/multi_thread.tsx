import { NodeShell } from '../node_utils/node_shell';
import { Split } from 'lucide-react';
import { AppContext, NodeMetaData } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp } from '@/lib/store';
import { cloneDeep, set } from 'lodash';
import { Label } from '../ui/label';
import { Input } from '../ui/input';

export const Metadata: NodeMetaData = {
    type: 'multi_thread',
    category: 'logic',
    name: 'Multi Thread',
    description: 'This node allows you to run multiple threads in parallel',
    tags: ['promise', 'async']
}

export const Process = async (context: AppContext, node: AppNode, nextNodes: AppNode[]) => {
    context[node.id] = { ...(context[node.id] || {}), name: (node.data.name as string) || Metadata.name }
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
    return <NodeShell {...props} icon={Split} defaultName={Metadata.name} category={Metadata.category} sourceType='multi' />
}
