import { NameField, NodeShell } from '../node_utils/node_shell';
import { Split } from 'lucide-react';
import { AppContext, NodeMetaData } from '@/lib/nodes';
import { AppNode, AppNodeProp } from '@/lib/store';

export const Metadata: NodeMetaData = {
    type: 'multi_thread',
    category: 'logic',
    icon: Split,
    name: 'Run in parallel',
    description: 'Run all connected branches at the same time. Join them again with Wait for all.',
    tags: ['promise', 'async']
}

export const Process = async (context: AppContext, node: AppNode, nextNodes: AppNode[]) => {
    context[node.id] = { ...(context[node.id] || {}), name: (node.data.name as string) || Metadata.name }
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode }) => {
    return (
        <div className='flex flex-col gap-2 px-3'>
            <NameField node={node as AppNode} placeholder={Metadata.name} />
            <p className='text-xs text-muted-foreground'>Every step connected below this one runs at the same time. Connect the end of each branch to a Wait for all step to continue once all of them are done.</p>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} sourceType='multi' />
}
