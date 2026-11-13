import { cva } from 'class-variance-authority';
import { cloneDeep, get, set, unset } from 'lodash';
import { Ban, Check, Clock, Loader2, X } from 'lucide-react';
import { AppNode, AppNodeProp, useFlowStore, useRuntimeStore, useSettingStore } from '@/lib/store';
import type { NodeCategory, NodeState } from '@/lib/nodes';
import { findModel } from '@/lib/openai/models';
import { cn } from '@/lib/utils';
import DevMode from './dev_mode';
import { ProblemBadge } from './flow_problems_state';
import { ThreadSourceHandle, ThreadTargetHandle } from './thread_handle';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

const shellVariants = cva(
    // A neutral card; the category colour is a stripe on the left and the icon.
    "relative bg-card text-card-foreground border border-border shadow-sm px-4 py-2 min-w-36 max-w-64 flex flex-col items-center gap-0.5 transition-[opacity,border-color,background-color] duration-200", //tw
    {
        variants: {
            shape: {
                box: 'rounded-lg', //tw
                pill: 'rounded-full px-5', //tw
            },
            state: {
                idle: '',
                faded: '',
                waiting: 'opacity-70', //tw
                running: 'node-running', //tw
                completed: '',
                failed: 'border-danger bg-danger/10', //tw
                skipped: 'border-dashed opacity-60', //tw
            },
            selected: {
                true: 'outline-2 outline-offset-2 outline-foreground', //tw
                false: '',
            },
        },
        defaultVariants: { shape: 'box', state: 'idle', selected: false }
    }
)

const CATEGORY_TEXT: Record<NodeCategory, string> = {
    start: 'text-node-start', //tw
    ai: 'text-node-ai', //tw
    logic: 'text-node-logic', //tw
    data: 'text-node-data', //tw
    io: 'text-node-io', //tw
}

const CATEGORY_STRIPE: Record<NodeCategory, string> = {
    start: 'bg-node-start', //tw
    ai: 'bg-node-ai', //tw
    logic: 'bg-node-logic', //tw
    data: 'bg-node-data', //tw
    io: 'bg-node-io', //tw
}

/** The small mark in the top-right corner that says how the step's last run went. */
function StateBadge({ state }: { state?: NodeState | 'faded' }) {
    const base = 'absolute -top-2 -right-2 flex items-center justify-center rounded-full w-5 h-5 border-2 border-background' //tw
    switch (state) {
        case 'running': return <span className={cn(base, 'bg-running text-white')} aria-label="Running"><Loader2 size={12} className="motion-safe:animate-spin" /></span>
        case 'completed': return <span className={cn(base, 'bg-success text-success-foreground')} aria-label="Done"><Check size={12} strokeWidth={3} /></span>
        case 'failed': return <span className={cn(base, 'bg-danger text-danger-foreground')} aria-label="Failed"><X size={12} strokeWidth={3} /></span>
        case 'waiting': return <span className={cn(base, 'bg-muted text-muted-foreground')} aria-label="Waiting"><Clock size={11} /></span>
        case 'skipped': return <span className={cn(base, 'bg-muted text-muted-foreground')} aria-label="Skipped"><Ban size={11} /></span>
        default: return null
    }
}

type NodeShellProps = AppNodeProp & {
    icon: React.ElementType
    defaultName: string
    category: NodeCategory
    /** One short line under the name, e.g. the model. */
    summary?: string
    /** "multi" lets the node connect to several next nodes (like Decision). */
    sourceType?: 'normal' | 'multi'
    /** "multi" lets several branches connect into the node (Wait for all). "none" for Start. */
    targetType?: 'normal' | 'multi' | 'none'
}

/** How every step looks on the canvas: category colour, name, summary, run status and handles. */
export function NodeShell({ id, selectable, selected, isConnectable, data, icon: Icon, defaultName, category, summary, sourceType = 'normal', targetType = 'normal' }: NodeShellProps) {
    const preview = selectable != undefined && !selectable
    const state = useRuntimeStore((state) => preview ? "faded" : state.nodeStates[id])
    const name = (data?.name || defaultName) as string
    const modelSummary = typeof data?.model == 'string' && data.model ? (findModel(data.model)?.label || data.model) : undefined
    const line = summary ?? modelSummary

    return (
        <div className={cn(shellVariants({ shape: category == 'start' ? 'pill' : 'box', state, selected: !!selected && !preview }))}>
            {category != 'start' ? <span aria-hidden className={cn('absolute left-0 inset-y-0 w-1 rounded-l-lg', CATEGORY_STRIPE[category])} /> : null}
            {targetType != 'none' ? <ThreadTargetHandle active={isConnectable} type={targetType == 'multi' ? 'multi' : 'normal'} /> : null}
            <div className='flex items-center gap-2 max-w-full'>
                <Icon size={18} className={cn('shrink-0', CATEGORY_TEXT[category])} aria-hidden />
                <span className='text-sm font-semibold truncate'>{name}</span>
            </div>
            {line ? <span className='text-xs text-muted-foreground truncate max-w-full'>{line}</span> : null}
            <DevMode data={data} />
            {preview ? null : <StateBadge state={state} />}
            {preview ? null : <ProblemBadge nodeId={id} />}
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
            <Label className='text-sm font-semibold' htmlFor={`name-${node.id}`}>Name</Label>
            <Input
                id={`name-${node.id}`}
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
                value={get(node.data, field) as string || ''}
                className={className || 'h-20'}
                placeholder={placeholder}
                onChange={(e) => setValue(field, e.target.value)}
                node={node}
                withoutRichText={!rich}
            />
            {help ? <p className='text-xs text-muted-foreground'>{help}</p> : null}
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
            {help ? <p className='text-xs text-muted-foreground'>{help}</p> : null}
        </div>
    )
}

export { waitWhileRunning } from '@/lib/store';

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
