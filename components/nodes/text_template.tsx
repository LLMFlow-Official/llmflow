import { FileText } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import MarkdownViewer from '../ui/markdown_viewer';
import { NameField, NodeShell, TemplateField } from '../node_utils/node_shell';

type TextTemplateData = NodeData & {
    template?: string
}

export const Metadata: NodeMetaData = {
    type: 'text_template',
    category: 'data',
    icon: FileText,
    name: 'Text Template',
    description: 'Build a block of text from values of earlier nodes, to reuse in later prompts',
    tags: ['text', 'template', 'format', 'combine', 'string'],
}

export const Outputs = (node: AppNode<TextTemplateData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    text: { title: 'Text', description: 'The filled-in text', value: extra.text as string },
} as NodeOutput)

export function LogView({ payload }: NodeLogViewProps<string>) {
    return <MarkdownViewer text={payload} />
}

export const Process = async (context: AppContext, node: AppNode<TextTemplateData>, nextNodes: AppNode[], controller: Controller) => {
    const text = renderTextTemplate(node.data.template || '', context)
    context[node.id] = { name: node.data.name, text }
    controller.log({ id: node.id, type: 'success', title: 'Text built', nodeType: node.type, payload: text })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<TextTemplateData> }) => (
    <div className='flex flex-col gap-3 px-3'>
        <NameField node={node} placeholder={Metadata.name} />
        <TemplateField
            node={node}
            field='template'
            label='Template'
            rich
            className='h-40'
            placeholder='Summary of {start.topic}: {prompt_x.assistant_raw_output}'
            help='Use the Value Selector to insert values from earlier nodes. Objects are inserted as JSON.'
        />
    </div>
)

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
