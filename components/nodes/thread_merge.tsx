import { NameField, NodeShell } from '../node_utils/node_shell';
import { Merge } from 'lucide-react';
import { AppContext, NodeMetaData } from '@/lib/nodes';
import { AppNode, AppNodeProp } from '@/lib/store';

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
    return (
        <div className='flex flex-col gap-2 px-3'>
            <NameField node={node as AppNode} placeholder={Metadata.name} />
            <p className='text-xs text-muted-foreground'>Connect the last step of each branch started by Run in parallel. The flow continues from here once every branch has finished.</p>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} targetType='multi' />
}
