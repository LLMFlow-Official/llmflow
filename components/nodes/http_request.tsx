import { Network } from 'lucide-react';
import { AppContext, Controller, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { parseHeaders } from '@/lib/text_utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { NameField, NodeShell, onFlowStop, TemplateField, useNodeSetter } from '../node_utils/node_shell';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

type HttpRequestData = NodeData & {
    method?: typeof METHODS[number]
    url?: string
    headers?: string
    body?: string
    timeout?: number
    /** Defaults to true: a 4xx/5xx response stops this branch. */
    fail_on_error?: boolean
}

export const Metadata: NodeMetaData = {
    type: 'http_request',
    name: 'HTTP Request',
    description: 'Call any web API and use its response in later nodes',
    tags: ['http', 'api', 'fetch', 'request', 'webhook', 'rest', 'url'],
}

export const Outputs = (node: AppNode<HttpRequestData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    status: { title: 'Status', description: 'HTTP status code, e.g. 200', value: extra.status as number },
    ok: { title: 'OK', description: 'true when the status is 200-299', value: extra.ok as string },
    body: { title: 'Body', description: 'Parsed JSON when the response is JSON, otherwise text', value: extra.body as string },
    headers: { title: 'Headers', description: 'Response headers', value: extra.headers as string },
} as NodeOutput)

export const Process = async (context: AppContext, node: AppNode<HttpRequestData>, nextNodes: AppNode[], controller: Controller) => {
    const url = renderTextTemplate(node.data.url || '', context).trim()
    if (!/^https?:\/\//i.test(url)) throw Error("URL must start with http:// or https://")

    const method = node.data.method || 'GET'
    const headers = parseHeaders(renderTextTemplate(node.data.headers || '', context))
    const hasBody = method != 'GET' && !!node.data.body?.trim()
    const body = hasBody ? renderTextTemplate(node.data.body || '', context) : undefined
    if (body && !Object.keys(headers).some(x => x.toLowerCase() == 'content-type') && /^\s*[{[]/.test(body)) {
        headers['Content-Type'] = 'application/json'
    }

    const timeoutSeconds = node.data.timeout || 30
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort('timeout'), timeoutSeconds * 1000)
    let stopped = false
    const removeStopListener = onFlowStop(() => { stopped = true; abort.abort('stopped') })

    let response: Response
    try {
        response = await fetch(url, { method, headers, body, signal: abort.signal })
    } catch {
        if (stopped) return []
        if (abort.signal.aborted) throw Error(`The request took longer than ${timeoutSeconds} seconds`)
        throw Error("The request failed. The server may be unreachable, or it may not allow requests from a browser (CORS).")
    } finally {
        clearTimeout(timer)
        removeStopListener()
    }

    const text = await response.text()
    const isJson = (response.headers.get('content-type') || '').includes('json')
    let parsedBody: unknown = text
    if (isJson && text) {
        try { parsedBody = JSON.parse(text) } catch { parsedBody = text }
    }
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => { responseHeaders[key] = value })

    context[node.id] = {
        name: node.data.name,
        status: response.status,
        ok: String(response.ok),
        body: parsedBody as object,
        headers: responseHeaders,
    }

    const preview = typeof parsedBody == 'string' ? parsedBody : JSON.stringify(parsedBody, null, 2)
    const shortPreview = preview.length > 3000 ? `${preview.slice(0, 3000)}…` : preview

    if (!response.ok && node.data.fail_on_error !== false) {
        throw Error(`${method} ${url} returned ${response.status}: ${shortPreview.slice(0, 300)}`)
    }

    controller.log({
        id: node.id,
        type: response.ok ? 'success' : 'warning',
        title: `${method} ${response.status} ${response.statusText}`.trim(),
        nodeType: node.type,
        payload: shortPreview
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<HttpRequestData> }) => {
    const setValue = useNodeSetter(node)
    const method = node.data.method || 'GET'

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Method</Label>
                <Select value={method} onValueChange={(e) => setValue('method', e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {METHODS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <TemplateField node={node} field='url' label='URL' className='h-12 min-h-0' placeholder='https://api.example.com/items?q={start.topic}' />
            <TemplateField
                node={node}
                field='headers'
                label='Headers'
                placeholder={'Authorization: Bearer …\nAccept: application/json'}
                help='One "Name: value" per line. Headers are saved in the flow and in exported .flow files, so avoid secrets you would not share.'
            />
            {method != 'GET' ? (
                <TemplateField node={node} field='body' label='Body' className='h-28' placeholder={'{"text": "{prompt_x.assistant_raw_output}"}'} help='JSON bodies get a Content-Type: application/json header automatically.' />
            ) : null}
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='timeout'>Timeout (seconds)</Label>
                <Input id='timeout' type='number' min={1} max={300} value={node.data.timeout ?? ''} placeholder='30' onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    setValue('timeout', Number.isFinite(value) && value > 0 ? Math.min(value, 300) : undefined)
                }} />
            </div>
            <div className='flex items-center justify-between'>
                <Label className='text-sm font-semibold' htmlFor='fail_on_error'>Stop on error status (4xx/5xx)</Label>
                <Switch id='fail_on_error' checked={node.data.fail_on_error !== false} onCheckedChange={(e) => setValue('fail_on_error', e ? undefined : false)} />
            </div>
            <p className='text-xs text-muted-foreground'>Requests are sent from your browser, so the API must allow cross-origin (CORS) requests.</p>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Network} defaultName={Metadata.name} />
}
