import { Braces, Plus, Trash } from 'lucide-react';
import { get } from 'lodash';
import { AppContext, Controller, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { extractJson } from '@/lib/text_utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { NameField, NodeShell, TemplateField, useNodeSetter } from '../node_utils/node_shell';

type Field = { name: string, path?: string }

type JsonExtractData = NodeData & {
    source?: string
    fields?: Field[]
}

export const Metadata: NodeMetaData = {
    type: 'json_extract',
    category: 'data',
    name: 'JSON Extract',
    description: 'Read JSON from text (even inside a code block) and pick out fields',
    tags: ['json', 'parse', 'extract', 'field', 'object'],
}

export const Outputs = (node: AppNode<JsonExtractData>, extra: OutputExtra) => {
    const outputs: NodeOutput = {
        name: { title: 'Node name', value: node.data.name },
        json: { title: 'JSON', description: 'The whole parsed value', value: extra.json as string },
    }
    for (const field of node.data.fields || []) {
        if (!field.name) continue
        outputs[field.name] = {
            title: field.name,
            description: `Value at ${field.path || field.name}`,
            value: (extra as Record<string, string>)[field.name],
        }
    }
    return outputs
}

export const Process = async (context: AppContext, node: AppNode<JsonExtractData>, nextNodes: AppNode[], controller: Controller) => {
    if (!node.data.source) throw Error("Source is required")
    const json = extractJson(renderTextTemplate(node.data.source, context))

    const values: Record<string, unknown> = {}
    for (const field of node.data.fields || []) {
        if (!field.name) continue
        values[field.name] = get(json, field.path || field.name)
    }

    // Objects stay objects so later nodes can read nested values like {node.json.items[0]}.
    context[node.id] = { name: node.data.name, json: json as object, ...(values as Record<string, object>) }

    controller.log({
        id: node.id,
        type: 'success',
        title: 'JSON read',
        nodeType: node.type,
        payload: JSON.stringify(Object.keys(values).length ? values : json, null, 2)
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<JsonExtractData> }) => {
    const setValue = useNodeSetter(node)
    const fields = node.data.fields || []
    const setFields = (next: Field[]) => setValue('fields', next)

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <TemplateField
                node={node}
                field='source'
                label='Source'
                placeholder='{prompt_x.assistant_raw_output}'
                help='Text that contains JSON. Plain JSON, a ```json block, or JSON inside other text all work.'
            />
            <div className='flex flex-col gap-1'>
                <div className='flex items-center'>
                    <Label className='text-sm font-semibold'>Fields</Label>
                    <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip='Add field' onClick={() => setFields([...fields, { name: '' }])}>
                        <Plus className='w-4 h-4' />
                    </Button>
                </div>
                {fields.length == 0 ? <p className='text-xs text-muted-foreground'>Optional. Each field becomes its own output. The whole JSON is always available as &quot;json&quot;.</p> : null}
                {fields.map((field, index) => (
                    <div key={index} className='flex gap-1 items-center'>
                        <Input
                            value={field.name}
                            placeholder='Output name'
                            onChange={(e) => setFields(fields.map((x, i) => i == index ? { ...x, name: e.target.value.replace(/[^\w-]/g, '_') } : x))}
                        />
                        <Input
                            value={field.path || ''}
                            placeholder='Path, e.g. items[0].title'
                            onChange={(e) => setFields(fields.map((x, i) => i == index ? { ...x, path: e.target.value } : x))}
                        />
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger/80 p-0.5 h-6 w-6 shrink-0" onClick={() => setFields(fields.filter((_, i) => i != index))}>
                            <Trash className='w-4 h-4' />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Braces} defaultName={Metadata.name} category={Metadata.category} />
}
