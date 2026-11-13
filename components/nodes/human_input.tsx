import { UserRound } from 'lucide-react';
import { AppContext, Controller, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData, useRuntimeStore } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NameField, NodeShell, onFlowStop, TemplateField, useNodeSetter } from '../node_utils/node_shell';

type HumanInputData = NodeData & {
    mode?: 'text' | 'approve'
    message?: string
    placeholder?: string
}

export const Metadata: NodeMetaData = {
    type: 'human_input',
    category: 'io',
    icon: UserRound,
    name: 'Human Input',
    description: 'Pause the run and ask you to type a value or approve before continuing',
    tags: ['human', 'input', 'approve', 'review', 'pause', 'ask', 'manual'],
}

export const Outputs = (node: AppNode<HumanInputData>, extra: OutputExtra) => ({
    name: { title: 'Step name', value: node.data.name },
    value: { title: 'Value', description: 'What you typed (text mode)', value: extra.value as string },
    approved: { title: 'Approved', description: '"true" when you approved (approve mode)', value: extra.approved as string },
} as NodeOutput)

export const Process = async (context: AppContext, node: AppNode<HumanInputData>, nextNodes: AppNode[], controller: Controller) => {
    const mode = node.data.mode || 'text'
    const message = renderTextTemplate(node.data.message || '', context)

    // undefined means the flow was stopped while waiting.
    const answer = await new Promise<string | File | null | undefined>((resolve) => {
        let removeStopListener = () => {}
        const finish = (value: string | File | null | undefined) => {
            removeStopListener()
            useRuntimeStore.getState().resolveInput(node.id)
            resolve(value)
        }
        removeStopListener = onFlowStop(() => finish(undefined))
        useRuntimeStore.getState().requestInput({
            nodeId: node.id,
            title: node.data.name || Metadata.name,
            message,
            mode,
            placeholder: node.data.placeholder,
            respond: finish,
        })
    })

    if (answer === undefined) return []
    if (mode == 'approve' && answer === null) throw Error("Rejected")

    context[node.id] = {
        name: node.data.name,
        value: mode == 'text' ? (answer as string) || '' : undefined,
        approved: mode == 'approve' ? 'true' : undefined,
    }
    controller.log({
        id: node.id,
        type: 'success',
        title: mode == 'approve' ? 'Approved' : 'Input received',
        nodeType: node.type,
        payload: mode == 'text' ? (answer as string) || '' : undefined,
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<HumanInputData> }) => {
    const setValue = useNodeSetter(node)
    const mode = node.data.mode || 'text'
    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Ask for</Label>
                <Select value={mode} onValueChange={(e) => setValue('mode', e == 'text' ? undefined : e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value='text'>A typed answer</SelectItem>
                        <SelectItem value='approve'>Approve or reject</SelectItem>
                    </SelectContent>
                </Select>
                {mode == 'approve' ? <p className='text-xs text-muted-foreground'>Rejecting stops this branch.</p> : null}
            </div>
            <TemplateField
                node={node}
                field='message'
                label='Message'
                rich
                className='h-28'
                placeholder={mode == 'approve' ? 'Send this email?\n\n{prompt_x.assistant_raw_output}' : 'What tone should the reply use?'}
                help='Shown to you while the run waits.'
            />
            {mode == 'text' ? (
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold' htmlFor='placeholder'>Answer hint</Label>
                    <Input id='placeholder' value={node.data.placeholder || ''} placeholder='e.g. friendly, formal…' onChange={(e) => setValue('placeholder', e.target.value)} />
                </div>
            ) : null}
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
