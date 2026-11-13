import { Globe } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { parseList } from '@/lib/text_utils';
import { buildResponsesPayload, DEFAULT_MODEL_ID, parseResponse, ReasoningEffort, Usage } from '@/lib/openai';
import { runResponses } from '@/lib/openai/run';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import MarkdownViewer from '../ui/markdown_viewer';
import { Stats } from '../node_utils/stats';
import { ModelSelect, ReasoningEffortSelect } from '../node_utils/model_select';
import { NameField, NodeShell, TemplateField, TestOutputField, useNodeSetter } from '../node_utils/node_shell';

type WebSearchData = NodeData & {
    model?: string
    reasoning_effort?: ReasoningEffort
    query?: string
    instructions?: string
    context_size?: 'low' | 'medium' | 'high'
    allowed_domains?: string
    test_output?: string
}

type Citation = { url: string, title?: string }

export const Metadata: NodeMetaData = {
    type: 'web_search',
    name: 'Web Search',
    description: 'Ask a model to search the web and answer with links to its sources',
    tags: ['search', 'web', 'internet', 'browse', 'research', 'citations', 'OpenAI'],
}

export const Outputs = (node: AppNode<WebSearchData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    answer: { title: 'Answer', description: 'The answer, with inline links', value: extra.answer as string },
    citations: { title: 'Citations', description: 'Pages cited in the answer (list of {url, title})', value: extra.citations as string },
    sources: { title: 'Sources', description: 'Every URL the search looked at', value: extra.sources as string },
} as NodeOutput)

type LogViewPayload = { answer: string, citations: Citation[], usage: Usage, amount: number | null, startTime: number, endTime: number }

export function LogView({ payload }: NodeLogViewProps<LogViewPayload>) {
    return <>
        <MarkdownViewer text={payload.answer} />
        {payload.citations.length ? (
            <div className='mt-2 flex flex-col gap-1 text-xs'>
                <span className='font-semibold'>Sources</span>
                {payload.citations.map(x => (
                    <a key={x.url} href={x.url} target='_blank' rel='noopener noreferrer' className='text-blue-600 underline break-all'>
                        {x.title || x.url}
                    </a>
                ))}
            </div>
        ) : null}
        <Stats
            amount={payload.amount}
            costIncomplete={payload.amount !== null}
            inToken={payload.usage.input_tokens}
            outToken={payload.usage.output_tokens}
            cachedToken={payload.usage.input_tokens_details?.cached_tokens}
            reasoningToken={payload.usage.output_tokens_details?.reasoning_tokens}
            startTime={payload.startTime}
            endTime={payload.endTime}
        />
    </>
}

export const Process = async (context: AppContext, node: AppNode<WebSearchData>, nextNodes: AppNode[], controller: Controller) => {
    const query = renderTextTemplate(node.data.query || '', context)
    if (!query.trim()) throw Error("Question is required")

    const payload = buildResponsesPayload({
        model: node.data.model || DEFAULT_MODEL_ID,
        systemPrompt: renderTextTemplate(node.data.instructions || '', context),
        messages: [{ role: 'user', content: query }],
        reasoningEffort: node.data.reasoning_effort,
        webSearch: {
            contextSize: node.data.context_size,
            allowedDomains: parseList(node.data.allowed_domains),
        },
    })

    const { response, cost, startTime, endTime } = await runResponses(payload, controller, node.data.test_output)
    // Search calls have a per-call fee that the usage does not report, so the run total becomes a lower bound.
    controller.increaseAmount(null)

    const { text, warning, citations = [], sources = [] } = parseResponse(response)

    context[node.id] = { name: node.data.name, answer: text, citations, sources }
    controller.log({
        id: node.id,
        type: warning ? 'warning' : 'success',
        title: warning || `Answered with ${citations.length} cited source${citations.length == 1 ? '' : 's'}`,
        nodeType: node.type,
        payload: {
            answer: text,
            citations,
            usage: response.usage,
            amount: cost === null ? null : cost.toNumber(),
            startTime,
            endTime,
        } as LogViewPayload
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<WebSearchData> }) => {
    const setValue = useNodeSetter(node)
    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <ModelSelect node={node} />
            <ReasoningEffortSelect node={node} />
            <TemplateField node={node} field='query' label='Question' placeholder='What changed in {start.topic} this week?' />
            <TemplateField node={node} field='instructions' label='Instructions' placeholder='Optional, e.g. Answer in 3 bullet points' />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Search depth</Label>
                <Select value={node.data.context_size || 'medium'} onValueChange={(e) => setValue('context_size', e == 'medium' ? undefined : e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value='low'>Low (faster, cheaper)</SelectItem>
                        <SelectItem value='medium'>Medium</SelectItem>
                        <SelectItem value='high'>High (more context)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <TemplateField
                node={node}
                field='allowed_domains'
                label='Only these sites'
                placeholder='openai.com, docs.python.org'
                help='Optional. Up to 100 domains, separated by commas or new lines.'
            />
            <p className='text-xs text-gray-500'>OpenAI charges a fee per search on top of tokens. That fee is not included in the cost shown.</p>
            <TestOutputField node={node as AppNode} />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Globe} defaultName={Metadata.name} />
}
