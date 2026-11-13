import { cva } from 'class-variance-authority';
import { cloneDeep, set, unset } from 'lodash';
import { useMemo } from 'react';
import { AppNode, AppNodeProp, useFlowStore, useRuntimeStore, useSettingStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import NoteIcon from './node_icon';
import DevMode from './dev_mode';
import { ThreadSourceHandle, ThreadTargetHandle } from './thread_handle';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

const shellVariants = cva(
    "bg-white border-2 p-2 flex flex-col gap-2 items-center transition-all duration-300", //tw
    {
        variants: {
            kind: {
                // Same look as the existing nodes: blue squares control the flow, red rounded boxes do work.
                control: 'text-blue-600 border-blue-600 bg-opacity-80', //tw
                action: 'text-red-600 border-red-600 rounded-md', //tw
            },
            state: {
                idle: '',
                faded: 'opacity-20', //tw
                waiting: 'opacity-20',
                running: 'opacity-40',
                completed: 'opacity-100',
                failed: 'opacity-80 outline outline-offset-1 outline-red-500', //tw
                skipped: 'opacity-30 border-dashed', //tw
            }
        },
        defaultVariants: {
            kind: 'action',
            state: 'idle'
        }
    }
)

type NodeShellProps = AppNodeProp & {
    icon: React.ElementType
    defaultName: string
    kind?: 'control' | 'action'
    /** "multi" lets the node connect to several next nodes (like Decision). */
    sourceType?: 'normal' | 'multi'
}

/** Canvas rendering shared by the newer nodes: handles, state icon, name and dev-mode info. */
export function NodeShell({ id, selectable, isConnectable, data, icon, defaultName, kind = 'action', sourceType = 'normal' }: NodeShellProps) {
    const state = useRuntimeStore((state) => selectable != undefined && !selectable ? "faded" : state.nodeStates[id])
    const name = useMemo(() => (data?.name || defaultName) as string, [data?.name, defaultName]);

    return (
        <div className={cn(shellVariants({ kind, state }))}>
            <ThreadTargetHandle active={isConnectable} />
            <div className='flex gap-2'>
                <NoteIcon state={state} idleIcon={icon} />
                <span className='text-sm font-semibold'>{name}</span>
            </div>
            <DevMode data={data} />
            <ThreadSourceHandle active={isConnectable} type={sourceType} />
        </div>
    );
}

/** Returns a setter that writes `data.<key>` on the node, removing the key when the value is undefined. */
export function useNodeSetter<T>(node: AppNode<T>) {
    const updateNode = useFlowStore(state => state.updateNode);
    return (key: string, value: unknown) => {
        const clonedNode = cloneDeep(node) as AppNode;
        if (value === undefined) unset(clonedNode, `data.${key}`);
        else set(clonedNode, `data.${key}`, value);
        updateNode(clonedNode);
    }
}

export function NameField({ node, placeholder }: { node: AppNode, placeholder: string }) {
    const setValue = useNodeSetter(node)
    return (
        <div className='flex flex-col gap-1'>
            <Label>Name</Label>
            <Input
                name="name"
                value={(node.data.name as string) || ''}
                placeholder={placeholder}
                onChange={(e) => setValue('name', e.target.value)}
            />
        </div>
    )
}

type TemplateFieldProps = {
    node: AppNode
    field: string
    label: string
    placeholder?: string
    help?: string
    rich?: boolean
    className?: string
}

/** A text field that supports {nodeId.key} references through the Value Selector. */
export function TemplateField({ node, field, label, placeholder, help, rich = false, className }: TemplateFieldProps) {
    const setValue = useNodeSetter(node)
    return (
        <div className='flex flex-col gap-1'>
            <Label className='text-sm font-semibold' htmlFor={field}>{label}</Label>
            <Textarea
                id={field}
                name={field}
                value={(node.data as Record<string, unknown>)[field] as string || ''}
                className={className || 'h-20'}
                placeholder={placeholder}
                onChange={(e) => setValue(field, e.target.value)}
                node={node}
                withoutRichText={!rich}
            />
            {help ? <p className='text-xs text-gray-500'>{help}</p> : null}
        </div>
    )
}

/** Shown only in Test API mode: the value the node returns instead of calling the API. */
export function TestOutputField({ node, label = 'Test Output', type = 'text', help }: { node: AppNode, label?: string, type?: 'text' | 'json', help?: string }) {
    const isTestAPI = useSettingStore((s) => s.devMode?.testOpenAPI || false)
    const setValue = useNodeSetter(node)
    if (!isTestAPI) return null
    return (
        <div className='flex flex-col gap-1'>
            <Label className='text-sm font-semibold' htmlFor="test_output">{label}</Label>
            <Textarea
                id="test_output"
                name="test_output"
                type={type}
                value={(node.data as Record<string, unknown>).test_output as string || ''}
                className='h-20'
                onChange={(e) => setValue('test_output', e.target.value)}
                withoutHighlights
                withoutRichText={type == 'text'}
            />
            {help ? <p className='text-xs text-gray-500'>{help}</p> : null}
        </div>
    )
}

/** Waits for the given time, returning false early if the flow is stopped. */
export function waitWhileRunning(ms: number): Promise<boolean> {
    return new Promise(resolve => {
        const end = Date.now() + ms
        const tick = () => {
            if (!useRuntimeStore.getState().isRunning) return resolve(false)
            if (Date.now() >= end) return resolve(true)
            setTimeout(tick, Math.min(100, end - Date.now()))
        }
        tick()
    })
}

/** Calls onStop once if the flow is stopped; returns a function that removes the listener. */
export function onFlowStop(onStop: () => void): () => void {
    return useRuntimeStore.subscribe((state, previous) => {
        if (previous.isRunning && !state.isRunning) onStop()
    })
}

/** Shows the Human Input panel asking for a file and waits for it. Resolves null if skipped, undefined if the flow stopped. */
export function askForFile(nodeId: string, title: string, message: string, accept?: string): Promise<File | null | undefined> {
    return new Promise((resolve) => {
        let removeStopListener = () => {}
        const finish = (value: File | null | undefined) => {
            removeStopListener()
            useRuntimeStore.getState().resolveInput(nodeId)
            resolve(value)
        }
        removeStopListener = onFlowStop(() => finish(undefined))
        useRuntimeStore.getState().requestInput({
            nodeId, title, message, mode: 'file', accept,
            respond: (value) => finish(value instanceof File ? value : null),
        })
    })
}
