import { Globe } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { parseList } from '@/lib/text_utils';
import { NormalizedUsage } from '@/lib/openai/models';
import { providerLabel, runChat } from '@/lib/providers';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import MarkdownViewer from '../ui/markdown_viewer';
import { CitationList, UsageStats } from '../node_utils/stats';
import { ModelNodeData, ModelSelect, modelSummary, nodeModel, nodeProvider, ReasoningEffortSelect } from '../node_utils/model_select';
import { NameField, NodeShell, TemplateField, TestOutputField, useNodeSetter } from '../node_utils/node_shell';

type WebSearchData = NodeData & ModelNodeData & {
    query?: string
    instructions?: string
    context_size?: 'low' | 'medium' | 'high'
    allowed_domains?: string
    test_output?: string
}

type Citation = { url: string, title?: string }

export const Metadata: NodeMetaData = {
    type: 'web_search',
    category: 'ai',
    icon: Globe,
    name: 'Web Search',
    description: 'Ask a model (OpenAI, Claude or Gemini) to search the web and answer with links to its sources',
    tags: ['search', 'web', 'internet', 'browse', 'research', 'citations', 'OpenAI', 'Claude', 'Gemini'],
}

export const Outputs = (node: AppNode<WebSearchData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    answer: { title: 'Answer', description: 'The answer, with inline links', value: extra.answer as string },
    citations: { title: 'Citations', description: 'Pages cited in the answer (list of {url, title})', value: extra.citations as string },
    sources: { title: 'Sources', description: 'Every URL the search looked at', value: extra.sources as string },
} as NodeOutput)

type LogViewPayload = { answer: string, citations: Citation[], usage: NormalizedUsage, amount: number | null, startTime: number, endTime: number }

export function LogView({ payload }: NodeLogViewProps<LogViewPayload>) {
    return <>
        <MarkdownViewer text={payload.answer} />
        <CitationList citations={payload.citations} />
        <UsageStats usage={payload.usage} amount={payload.amount} costIncomplete={payload.amount !== null} startTime={payload.startTime} endTime={payload.endTime} />
    </>
}

export const Process = async (context: AppContext, node: AppNode<WebSearchData>, nextNodes: AppNode[], controller: Controller) => {
    const query = renderTextTemplate(node.data.query || '', context)
    if (!query.trim()) throw Error("Question is required")

    const provider = nodeProvider(node.data)
    if (provider == 'compatible') throw Error(`Web search is not available for ${providerLabel(provider)}. Choose OpenAI, Anthropic or Google.`)

    const run = await runChat({
        provider,
        model: nodeModel(node.data),
        systemPrompt: renderTextTemplate(node.data.instructions || '', context),
        messages: [{ role: 'user', content: query }],
        reasoningEffort: node.data.reasoning_effort,
        tools: {
            webSearch: {
                contextSize: node.data.context_size,
                allowedDomains: parseList(node.data.allowed_domains),
            },
        },
    }, controller, { nodeId: node.id, testOutput: node.data.test_output })
    // Search calls have a per-call fee that the usage does not report, so the run total becomes a lower bound.
    controller.increaseAmount(null)

    const { text, warning, citations = [], sources = [] } = run

    context[node.id] = { name: node.data.name, answer: text, citations, sources }
    controller.log({
        id: node.id,
        type: warning ? 'warning' : 'success',
        title: warning || `Answered with ${citations.length} cited source${citations.length == 1 ? '' : 's'}`,
        nodeType: node.type,
        payload: {
            answer: text,
            citations,
            usage: run.usage,
            amount: run.cost === null ? null : run.cost.toNumber(),
            startTime: run.startTime,
            endTime: run.endTime,
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
            {nodeProvider(node.data) == 'openai' ? <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Search depth</Label>
                <Select value={node.data.context_size || 'medium'} onValueChange={(e) => setValue('context_size', e == 'medium' ? undefined : e)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value='low'>Low (faster, cheaper)</SelectItem>
                        <SelectItem value='medium'>Medium</SelectItem>
                        <SelectItem value='high'>High (more context)</SelectItem>
                    </SelectContent>
                </Select>
            </div> : null}
            <TemplateField
                node={node}
                field='allowed_domains'
                label='Only these sites'
                placeholder='openai.com, docs.python.org'
                help='Optional. Up to 100 domains, separated by commas or new lines.'
            />
            <p className='text-xs text-muted-foreground'>OpenAI charges a fee per search on top of tokens. That fee is not included in the cost shown.</p>
            <TestOutputField node={node as AppNode} />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} summary={modelSummary(props.data as ModelNodeData)} />
}
