import { NameField, NodeShell } from '../node_utils/node_shell';
import { Cog } from 'lucide-react';
import { AppContext, Controller, NodeMetaData, NodeOutput } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp, NodeData, createStopSignal } from '@/lib/store';
import { CodeStoppedError } from '@/lib/code_runner';
import { cloneDeep, set } from 'lodash';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

import { runStatement, validateStatement } from '@/lib/logics';

type SetStateData = NodeData & {
    variable: string
    value: string
}

export const Metadata: NodeMetaData = {
    type: 'set_state',
    category: 'data',
    icon: Cog,
    name: 'Set variable',
    description: 'Save a value as a variable that later steps can use as {state.name}',
    tags: ['state', 'set', 'node'],
    valueIdentifier: () => "state"
}

export const Outputs = (node: AppNode<SetStateData>) => {
    // Values are read as {state.<variable>}, so only the variable itself is an output.
    return {
        ...(node.data.variable && node.data.value ? {
            [node.data.variable]: {
                title: 'Value',
                description: 'The value that was saved',
                value: node.data.value
            },
        } : {}),
    } as NodeOutput
}

export const Process = async (context: AppContext, node: AppNode<SetStateData>, nextNodes: AppNode[], controller: Controller) => {
    if (!node.data.variable || !node.data.value) return nextNodes
    const isValidStatement = validateStatement(node.data.value)
    if (!isValidStatement) throw Error("Value statement is invalid")

    const valueIdentifier = Metadata.valueIdentifier && Metadata.valueIdentifier(node) || ''
    const { signal, dispose } = createStopSignal()
    let output: unknown
    try {
        output = await runStatement(node.data.value, context, signal)
    } catch (error) {
        if (error instanceof CodeStoppedError) return []
        throw error
    } finally {
        dispose()
    }

    set(context, `${valueIdentifier}.${node.data.variable}`, output)

    controller.log({
        id: node.id,
        type: 'success',
        title: "State value has been updated",
        nodeType: node.type,
        payload: `${node.data.variable} = ${typeof output == 'string' ? output : JSON.stringify(output)}`
    });
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<SetStateData> }) => {
    const updateNode = useFlowStore(state => state.updateNode);

    const setValue = (key: string, value: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.${key}`, value);
        updateNode(clonedNode);
    }

    const isValidCondition = useMemo(() => validateStatement(node.data.value),[node])

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node as AppNode} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label htmlFor="variable">Variable Name</Label>
                <Input
                    id='variable'
                    name="variable"
                    value={node.data.variable}
                    placeholder={"Variable name"}
                    onChange={(e) => setValue('variable', e.target.value)}
                />
            </div>
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor="value">Value <span className={isValidCondition ? 'text-success': 'text-danger'}>{isValidCondition ? '(Valid)' : '(Invalid)'}</span></Label>
                <Textarea
                    id="value"
                    name="value"
                    value={node.data.value}
                    classNameFrame={cn('h-20', isValidCondition ? 'outline-solid outline-success!': 'outline-solid outline-danger!')}
                    placeholder='Enter your value statement here...'
                    onChange={(e) => setValue('value', e.target.value)}
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
