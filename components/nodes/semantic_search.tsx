import { ListOrdered } from 'lucide-react';
import { useState } from 'react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, createStopSignal, NodeData } from '@/lib/store';
import { renderTextTemplate, resolveList } from '@/lib/logics';
import {
    createEmbeddings, DEFAULT_EMBEDDING_MODEL, embeddingCost, embeddingModels, fakeEmbedding, MAX_EMBEDDING_INPUTS, rankBySimilarity, RankedDocument
} from '@/lib/openai/audio_embeddings';
import { getProviderKey, isTestApi } from '@/lib/providers';
import { StoppedError } from '@/lib/errors';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Stats } from '../node_utils/stats';
import { NameField, NodeShell, TemplateField, useNodeSetter } from '../node_utils/node_shell';

type SemanticSearchData = NodeData & {
    model?: string
    query?: string
    documents?: string
    top_k?: number
}

export const Metadata: NodeMetaData = {
    type: 'semantic_search',
    name: 'Semantic Search',
    description: 'Find the pieces of text most related in meaning to a question, using OpenAI embeddings',
    tags: ['embeddings', 'search', 'rank', 'similarity', 'rag', 'retrieve', 'vector', 'OpenAI'],
}

export const Outputs = (node: AppNode<SemanticSearchData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    top: { title: 'Best match', description: 'The most related text', value: extra.top as string },
    matches: { title: 'Matches', description: 'The best matches as one block of text, most related first', value: extra.matches as string },
    results: { title: 'Results', description: 'List of {text, score, index}, most related first', value: extra.results as string },
} as NodeOutput)

type LogPayload = { results: RankedDocument[], tokens: number, amount: number | null, startTime: number, endTime: number }

export function LogView({ payload }: NodeLogViewProps<LogPayload>) {
    return <>
        <ol className='text-xs flex flex-col gap-1 list-decimal pl-4'>
            {payload.results.map(x => <li key={x.index}><span className='font-mono text-muted-foreground'>{x.score.toFixed(3)}</span> {x.text.length > 160 ? `${x.text.slice(0, 160)}…` : x.text}</li>)}
        </ol>
        <Stats amount={payload.amount} inToken={payload.tokens} outToken={0} startTime={payload.startTime} endTime={payload.endTime} />
    </>
}

export const Process = async (context: AppContext, node: AppNode<SemanticSearchData>, nextNodes: AppNode[], controller: Controller) => {
    const query = renderTextTemplate(node.data.query || '', context)
    if (!query.trim()) throw Error("Question is required")
    const documents = resolveList(node.data.documents || '', context).map(x => typeof x == 'string' ? x : JSON.stringify(x)).filter(x => x.trim())
    if (!documents.length) throw Error("There are no texts to search. Connect a list, e.g. from Split Text.")
    if (documents.length + 1 > MAX_EMBEDDING_INPUTS) throw Error(`Up to ${MAX_EMBEDDING_INPUTS - 1} texts can be searched at once`)

    const model = node.data.model || DEFAULT_EMBEDDING_MODEL
    const startTime = Date.now()
    let vectors: number[][]
    let tokens = 0

    if (isTestApi()) {
        vectors = [query, ...documents].map(x => fakeEmbedding(x))
    } else {
        const apiKey = getProviderKey('openai')
        const { signal, dispose } = createStopSignal()
        try {
            const result = await createEmbeddings(apiKey, model, [query, ...documents], { signal })
            vectors = result.vectors
            tokens = result.tokens
        } catch (error) {
            if (signal.aborted) throw new StoppedError()
            throw error
        } finally {
            dispose()
        }
    }

    const cost = isTestApi() ? null : embeddingCost(tokens, model)
    controller.increaseInToken(tokens)
    controller.increaseAmount(cost)

    const results = rankBySimilarity(vectors[0], documents.map((text, i) => ({ text, vector: vectors[i + 1] })), node.data.top_k || 3)
    context[node.id] = {
        name: node.data.name,
        top: results[0]?.text,
        matches: results.map(x => x.text).join('\n\n---\n\n'),
        results,
    }
    controller.log({
        id: node.id,
        type: 'success',
        title: `Found ${results.length} of ${documents.length}`,
        nodeType: node.type,
        payload: { results, tokens, amount: cost === null ? null : cost.toNumber(), startTime, endTime: Date.now() } as LogPayload,
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<SemanticSearchData> }) => {
    const setValue = useNodeSetter(node)
    const model = node.data.model || DEFAULT_EMBEDDING_MODEL
    const [customMode, setCustomMode] = useState(!embeddingModels.some(x => x.id == model))

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Embedding model</Label>
                <Select value={customMode ? '__custom__' : model} onValueChange={(e) => { setCustomMode(e == '__custom__'); if (e != '__custom__') setValue('model', e) }}>
                    <SelectTrigger aria-label='Embedding model'><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {embeddingModels.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
                        <SelectItem value='__custom__'>Custom model ID…</SelectItem>
                    </SelectContent>
                </Select>
                {customMode ? <Input aria-label='Model ID' value={node.data.model || ''} placeholder='Model ID' onChange={(e) => setValue('model', e.target.value.trim())} /> : null}
            </div>
            <TemplateField node={node} field='query' label='Question' placeholder='{start.question}' />
            <TemplateField node={node} field='documents' label='Texts to search' placeholder='{split_text_x.chunks}' help='A list from an earlier node (e.g. Split Text), a JSON array, or one text per line.' />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='top_k'>How many matches</Label>
                <Input id='top_k' type='number' min={1} max={50} value={node.data.top_k ?? ''} placeholder='3' onChange={(e) => {
                    const value = parseInt(e.target.value, 10)
                    setValue('top_k', Number.isFinite(value) && value > 0 ? Math.min(value, 50) : undefined)
                }} />
            </div>
            <p className='text-xs text-muted-foreground'>In Test API mode, texts are compared by shared words instead of calling OpenAI.</p>
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={ListOrdered} defaultName={Metadata.name} />
}
