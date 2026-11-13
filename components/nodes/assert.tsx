import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { AppContext, Controller, NodeMetaData, NodeOutput } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData, createStopSignal } from '@/lib/store';
import { CodeStoppedError } from '@/lib/code_runner';
import { renderTextTemplate, runStatement, validateStatement } from '@/lib/logics';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { NameField, NodeShell, useNodeSetter } from '../node_utils/node_shell';

type AssertData = NodeData & {
    condition?: string
    message?: string
}

export const Metadata: NodeMetaData = {
    type: 'assert',
    category: 'logic',
    icon: ShieldCheck,
    name: 'Assert',
    description: 'Check a condition and stop this branch with your message if it is false',
    tags: ['check', 'validate', 'guard', 'test', 'condition'],
}

export const Outputs = (node: AppNode<AssertData>) => ({
    name: { title: 'Step name', value: node.data.name },
} as NodeOutput)

export const Process = async (context: AppContext, node: AppNode<AssertData>, nextNodes: AppNode[], controller: Controller) => {
    const condition = node.data.condition || ''
    if (!condition.trim()) throw Error("Condition is required")
    if (!validateStatement(condition)) throw Error("Condition is not a valid expression")

    const { signal, dispose } = createStopSignal()
    let passed: unknown
    try {
        passed = await runStatement(condition, context, signal)
    } catch (error) {
        if (error instanceof CodeStoppedError) return []
        throw error
    } finally {
        dispose()
    }
    if (!passed) {
        throw Error(renderTextTemplate(node.data.message || '', context) || `Check failed: ${condition}`)
    }

    context[node.id] = { name: node.data.name }
    controller.log({ id: node.id, type: 'success', title: 'Check passed', nodeType: node.type, payload: condition })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<AssertData> }) => {
    const setValue = useNodeSetter(node)
    const isValid = useMemo(() => !node.data.condition || validateStatement(node.data.condition), [node.data.condition])

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='condition'>Condition</Label>
                <Textarea
                    id='condition'
                    name='condition'
                    value={node.data.condition || ''}
                    className='h-20'
                    placeholder='{prompt_x.assistant_raw_output}.length < 500'
                    onChange={(e) => setValue('condition', e.target.value)}
                    node={node}
                    withoutRichText
                />
                {isValid ? (
                    <p className='text-xs text-muted-foreground'>A JavaScript expression, the same as a Decision condition. It runs in an isolated worker.</p>
                ) : (
                    <p className='text-xs text-danger'>This condition is not a valid expression.</p>
                )}
            </div>
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='message'>Failure message</Label>
                <Input
                    id='message'
                    value={node.data.message || ''}
                    placeholder='e.g. The summary is too long'
                    onChange={(e) => setValue('message', e.target.value)}
                />
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
