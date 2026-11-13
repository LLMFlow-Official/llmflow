import { Flag } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData, useRuntimeStore } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import MarkdownViewer from '../ui/markdown_viewer';
import { NameField, NodeShell, TemplateField } from '../node_utils/node_shell';

type FinalOutputData = NodeData & {
    value?: string
}

export const Metadata: NodeMetaData = {
    type: 'final_output',
    name: 'Final Output',
    description: "Mark the flow's result. It is shown at the top of the runtime log",
    tags: ['result', 'output', 'answer', 'end', 'return'],
}

export const Outputs = (node: AppNode<FinalOutputData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    value: { title: 'Value', description: 'The final result', value: extra.value as string },
} as NodeOutput)

export function LogView({ payload }: NodeLogViewProps<string>) {
    return <MarkdownViewer text={payload} />
}

export const Process = async (context: AppContext, node: AppNode<FinalOutputData>, nextNodes: AppNode[], controller: Controller) => {
    const value = renderTextTemplate(node.data.value || '', context)
    context[node.id] = { name: node.data.name, value }
    const output = { nodeId: node.id, name: node.data.name || Metadata.name, value }
    if (controller.addFinalOutput) controller.addFinalOutput(output)
    else useRuntimeStore.getState().addFinalOutput(output)
    controller.log({ id: node.id, type: 'success', title: 'Final output set', nodeType: node.type, payload: value })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<FinalOutputData> }) => (
    <div className='flex flex-col gap-3 px-3'>
        <NameField node={node} placeholder={Metadata.name} />
        <TemplateField
            node={node}
            field='value'
            label='Value'
            rich
            className='h-32'
            placeholder='{prompt_x.assistant_raw_output}'
        />
    </div>
)

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Flag} defaultName={Metadata.name} />
}
