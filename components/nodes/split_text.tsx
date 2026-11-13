import { Scissors } from 'lucide-react';
import { AppContext, Controller, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { splitText } from '@/lib/text_utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NameField, NodeShell, TemplateField, useNodeSetter } from '../node_utils/node_shell';

type SplitTextData = NodeData & {
    source?: string
    mode?: 'separator' | 'chunk'
    separator?: string
    chunk_size?: number
    overlap?: number
}

export const Metadata: NodeMetaData = {
    type: 'split_text',
    name: 'Split Text',
    description: 'Split text into a list, by a separator or into chunks of a fixed size',
    tags: ['split', 'chunk', 'list', 'array', 'text'],
}

export const Outputs = (node: AppNode<SplitTextData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    chunks: { title: 'Chunks', description: 'The list of pieces (inserted as JSON)', value: extra.chunks as string },
    count: { title: 'Count', description: 'Number of pieces', value: extra.count as number },
    first: { title: 'First piece', value: extra.first as string },
} as NodeOutput)

export const Process = async (context: AppContext, node: AppNode<SplitTextData>, nextNodes: AppNode[], controller: Controller) => {
    const text = renderTextTemplate(node.data.source || '', context)
    const mode = node.data.mode || 'separator'
    const chunks = mode == 'separator'
        ? splitText(text, { mode, separator: node.data.separator ?? '\\n' })
        : splitText(text, { mode, size: node.data.chunk_size ?? 2000, overlap: node.data.overlap ?? 0 })

    context[node.id] = { name: node.data.name, chunks, count: chunks.length, first: chunks[0] }
    controller.log({
        id: node.id,
        type: 'success',
        title: `Split into ${chunks.length} piece${chunks.length == 1 ? '' : 's'}`,
        nodeType: node.type,
        payload: JSON.stringify(chunks, null, 2)
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<SplitTextData> }) => {
    const setValue = useNodeSetter(node)
    const mode = node.data.mode || 'separator'
    const setNumber = (key: string, raw: string) => {
        const value = parseInt(raw, 10)
        setValue(key, Number.isFinite(value) ? value : undefined)
    }

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <TemplateField node={node} field='source' label='Text' placeholder='{prompt_x.assistant_raw_output}' />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Split by</Label>
                <Select value={mode} onValueChange={(e) => setValue('mode', e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value='separator'>Separator</SelectItem>
                        <SelectItem value='chunk'>Fixed size chunks</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {mode == 'separator' ? (
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold' htmlFor='separator'>Separator</Label>
                    <Input id='separator' value={node.data.separator ?? '\\n'} onChange={(e) => setValue('separator', e.target.value)} />
                    <p className='text-xs text-muted-foreground'>Write \n for a new line and \t for a tab. Empty pieces are dropped.</p>
                </div>
            ) : (
                <div className='flex gap-2'>
                    <div className='flex flex-col gap-1 flex-1'>
                        <Label className='text-sm font-semibold' htmlFor='chunk_size'>Size (characters)</Label>
                        <Input id='chunk_size' type='number' min={1} value={node.data.chunk_size ?? ''} placeholder='2000' onChange={(e) => setNumber('chunk_size', e.target.value)} />
                    </div>
                    <div className='flex flex-col gap-1 flex-1'>
                        <Label className='text-sm font-semibold' htmlFor='overlap'>Overlap</Label>
                        <Input id='overlap' type='number' min={0} value={node.data.overlap ?? ''} placeholder='0' onChange={(e) => setNumber('overlap', e.target.value)} />
                    </div>
                </div>
            )}
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Scissors} defaultName={Metadata.name} />
}
