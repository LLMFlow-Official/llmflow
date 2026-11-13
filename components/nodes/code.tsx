import { Code2 } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { CodeStoppedError, runCodeInWorker } from '@/lib/code_runner';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { NameField, NodeShell, onFlowStop, useNodeSetter } from '../node_utils/node_shell';

type CodeData = NodeData & {
    code?: string
    timeout?: number
}

const PLACEHOLDER = `// "context" holds the outputs of earlier nodes, e.g. context.start.topic
// and context.prompt_x.assistant_raw_output. "state" holds Set State values.
// Return a value to use it later as {<this node id>.result}.
const words = context.start.topic.split(' ')
return { count: words.length, upper: context.start.topic.toUpperCase() }`

export const Metadata: NodeMetaData = {
    type: 'code',
    name: 'Code',
    description: 'Run a small JavaScript function on earlier values and return a result',
    tags: ['code', 'javascript', 'js', 'script', 'function', 'transform'],
}

export const Outputs = (node: AppNode<CodeData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    result: { title: 'Result', description: 'The value the code returned. Objects can be read with {node.result.key}', value: extra.result as string },
} as NodeOutput)

type LogViewPayload = { result: unknown, logs: string[] }

export function LogView({ payload }: NodeLogViewProps<LogViewPayload>) {
    return (
        <div className='flex flex-col gap-2 text-xs'>
            {payload.logs.length ? (
                <div className='bg-gray-900 text-gray-100 p-2 rounded-md whitespace-pre-wrap max-h-28 overflow-y-auto font-mono'>{payload.logs.join('\n')}</div>
            ) : null}
            <div className='bg-accent p-2 rounded-md whitespace-pre-wrap max-h-28 overflow-y-auto border border-gray-300 font-mono'>
                {typeof payload.result == 'string' ? payload.result : JSON.stringify(payload.result, null, 2)}
            </div>
        </div>
    )
}

export const Process = async (context: AppContext, node: AppNode<CodeData>, nextNodes: AppNode[], controller: Controller) => {
    const code = node.data.code || ''
    if (!code.trim()) throw Error("Code is required")

    const timeoutSeconds = node.data.timeout || 10
    const abort = new AbortController()
    const removeStopListener = onFlowStop(() => abort.abort())

    try {
        const { result, logs } = await runCodeInWorker(code, context, timeoutSeconds * 1000, abort.signal)
        context[node.id] = { name: node.data.name, result: result as object }
        controller.log({ id: node.id, type: 'success', title: 'Code finished', nodeType: node.type, payload: { result, logs } as LogViewPayload })
        return nextNodes
    } catch (error) {
        if (error instanceof CodeStoppedError) return []
        const logs = (error as { logs?: string[] }).logs || []
        throw Error(`${(error as Error).message}${logs.length ? `\nConsole output:\n${logs.join('\n')}` : ''}`)
    } finally {
        removeStopListener()
    }
}

export const Properties = ({ node }: { node: AppNode<CodeData> }) => {
    const setValue = useNodeSetter(node)
    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='code'>JavaScript</Label>
                <textarea
                    id='code'
                    spellCheck={false}
                    value={node.data.code || ''}
                    placeholder={PLACEHOLDER}
                    onChange={(e) => setValue('code', e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key != 'Tab') return
                        e.preventDefault()
                        const el = e.currentTarget
                        const { selectionStart, selectionEnd, value } = el
                        setValue('code', `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`)
                        requestAnimationFrame(() => el.setSelectionRange(selectionStart + 4, selectionStart + 4))
                    }}
                    className='min-h-[220px] rounded-md border border-input bg-gray-900 text-gray-100 p-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                />
                <p className='text-xs text-gray-500'>
                    The function body can use await and console.log. It runs in a separate worker that cannot see this page or your API key, and it can only return values that can be turned into JSON.
                </p>
            </div>
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='timeout'>Time limit (seconds)</Label>
                <Input id='timeout' type='number' min={1} max={120} value={node.data.timeout ?? ''} placeholder='10' onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    setValue('timeout', Number.isFinite(value) && value > 0 ? Math.min(value, 120) : undefined)
                }} />
            </div>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Code2} defaultName={Metadata.name} />
}
