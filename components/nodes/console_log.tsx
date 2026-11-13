import { NodeShell } from '../node_utils/node_shell';
import { Captions } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { cloneDeep, set } from 'lodash';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';

import { renderTextTemplate } from '@/lib/logics';
import MarkdownViewer from '../ui/markdown_viewer';

type ConsoleLogData = NodeData & {
    log: string
}

export const Metadata: NodeMetaData = {
    type: 'console_log',
    category: 'io',
    icon: Captions,
    name: 'Log',
    description: 'Write a value to the run log (and the browser console) to check what a step produced',
    tags: ['debug', 'log', 'console']
}

export const Outputs = (node: AppNode<ConsoleLogData>) => {
    return {
        name: {
            title: 'Step name',
            
            value: node.data.name
        },
        log: {
            title: 'Logged text',
            description: 'The text that was logged',
            value: node.data.log
        },
    } as NodeOutput
}

export function LogView({ payload }: NodeLogViewProps<string>) {
    return <>
        <MarkdownViewer text={payload} />
    </>;
}

export const Process = async (context: AppContext, node: AppNode<ConsoleLogData>, nextNodes: AppNode[], controller: Controller) => {
    const output = renderTextTemplate(node.data.log, context)
    context[node.id] = { name: node.data.name, log: output }
    if (output) {
        console.log(`Log:${node.id} `, output);
        controller.log({
            id: node.id,
            type: 'success',
            title: "Logged (also in the browser console)",
            nodeType: node.type,
            payload: output
        });
    }
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<ConsoleLogData> }) => {
    const updateNode = useFlowStore(state => state.updateNode);

    const setValue = (key: string, value: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.${key}`, value);
        updateNode(clonedNode);
    }

    return (
        <div className='flex flex-col gap-3 px-3'>
            <div className='flex flex-col gap-1'>
                <Label>Name</Label>
                <Input
                    name="name"
                    value={node.data.name}
                    placeholder={Metadata.name}
                    onChange={(e) => setValue('name', e.target.value)}
                />
            </div>
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor="log">Log</Label>
                <Textarea
                    id="log"
                    name="log"
                    value={node.data.log}
                    className='h-20'
                    placeholder='Enter your statement here...'
                    onChange={(e) => setValue('log', e.target.value)}
                    node={node}
                    withoutRichText
                />
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
