import { Columns3, Plus, Trash } from 'lucide-react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { useShallow } from 'zustand/react/shallow';
import { AppNode, AppNodeProp, NodeData, useSettingStore } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { DEFAULT_MODELS, findModel, NormalizedUsage, PROVIDERS, ProviderId } from '@/lib/openai/models';
import { availableModels, availableProviders, runChat } from '@/lib/providers';
import { isStopped, StoppedError } from '@/lib/errors';
import MarkdownViewer from '../ui/markdown_viewer';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { UsageStats } from '../node_utils/stats';
import { useAutoLoadAccountModels } from '../node_utils/model_select';
import { NameField, NodeShell, TemplateField, TestOutputField, useNodeSetter } from '../node_utils/node_shell';

type Contender = { provider: ProviderId, model: string }

type CompareData = NodeData & {
    system_prompt?: string
    prompt?: string
    models?: Contender[]
    max_output_tokens?: number
    test_output?: string
}

type Answer = { model: string, label: string, text?: string, error?: string, cost: number | null, seconds: number, usage?: NormalizedUsage }

const labelOf = (c: Contender) => findModel(c.model)?.label || c.model || '(no model)'

export const Metadata: NodeMetaData = {
    type: 'model_compare',
    category: 'ai',
    icon: Columns3,
    name: 'Model Compare',
    description: 'Send the same prompt to several models at once and compare answers, cost and speed',
    tags: ['compare', 'models', 'benchmark', 'evaluate', 'A/B', 'OpenAI', 'Claude', 'Gemini'],
}

export const Outputs = (node: AppNode<CompareData>, extra: OutputExtra) => ({
    name: { title: 'Step name', value: node.data.name },
    answers: { title: 'Answers', description: 'List of {model, text, cost, seconds}', value: extra.answers as string },
    first: { title: 'First answer', description: 'The answer from the first model in the list', value: extra.first as string },
    table: { title: 'Comparison table', description: 'A Markdown table of all answers with cost and time', value: extra.table as string },
} as NodeOutput)

export function LogView({ payload }: NodeLogViewProps<{ answers: Answer[] }>) {
    return (
        <div className='grid gap-2' style={{ gridTemplateColumns: `repeat(${Math.min(payload.answers.length, 2)}, minmax(0, 1fr))` }}>
            {payload.answers.map((a, i) => (
                <div key={i} className='border border-border rounded-md p-2 flex flex-col gap-1 min-w-0'>
                    <span className='text-xs font-semibold'>{a.label}</span>
                    {a.error ? <span className='text-xs text-danger'>{a.error}</span> : <MarkdownViewer text={a.text || ''} />}
                    {a.usage ? <UsageStats usage={a.usage} amount={a.cost} endTime={a.seconds * 1000} startTime={0.0001} /> : null}
                </div>
            ))}
        </div>
    )
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')

/** The models to compare: the ones chosen, or OpenAI's and Claude's defaults (what the settings show). */
export function contendersOf(data: { models?: Contender[] }): Contender[] {
    return data.models?.length ? data.models : [{ provider: 'openai', model: DEFAULT_MODELS.openai }, { provider: 'anthropic', model: DEFAULT_MODELS.anthropic }]
}

export const Process = async (context: AppContext, node: AppNode<CompareData>, nextNodes: AppNode[], controller: Controller) => {
    const contenders = contendersOf(node.data).filter(x => x.model)
    if (contenders.length < 2) throw Error("Choose at least two models to compare")
    const user = renderTextTemplate(node.data.prompt || '', context)
    if (!user.trim()) throw Error("Prompt is required")
    const system = renderTextTemplate(node.data.system_prompt || '', context)

    const results = await Promise.allSettled(contenders.map((c, i) => runChat({
        provider: c.provider,
        model: c.model,
        systemPrompt: system,
        messages: [{ role: 'user', content: user }],
        maxOutputTokens: node.data.max_output_tokens,
    }, controller, { nodeId: `${node.id}::${i}::${labelOf(c)}`, testOutput: node.data.test_output ? `${node.data.test_output} (${labelOf(c)})` : undefined })))

    if (results.some(r => r.status == 'rejected' && isStopped(r.reason))) throw new StoppedError()

    const answers: Answer[] = results.map((r, i) => r.status == 'fulfilled'
        ? { model: r.value.model, label: labelOf(contenders[i]), text: r.value.text, cost: r.value.cost?.toNumber() ?? null, seconds: (r.value.endTime - r.value.startTime) / 1000, usage: r.value.usage }
        : { model: contenders[i].model, label: labelOf(contenders[i]), error: (r.reason as Error)?.message || 'Failed', cost: null, seconds: 0 })
    if (answers.every(a => a.error)) throw Error(`Every model failed. First error: ${answers[0].error}`)

    const table = [
        '| Model | Answer | Cost (USD) | Seconds |',
        '| --- | --- | --- | --- |',
        ...answers.map(a => `| ${a.label} | ${cell(a.error ? `Failed: ${a.error}` : a.text || '')} | ${a.cost === null ? 'unknown' : a.cost.toFixed(6)} | ${a.seconds.toFixed(1)} |`),
    ].join('\n')

    context[node.id] = {
        name: node.data.name,
        answers: answers.map(({ usage, ...rest }) => { void usage; return rest }),
        first: answers[0].text,
        table,
    }
    const failed = answers.filter(a => a.error).length
    controller.log({
        id: node.id,
        type: failed ? 'warning' : 'success',
        title: failed ? `${failed} of ${answers.length} models failed` : `Compared ${answers.length} models`,
        nodeType: node.type,
        payload: { answers },
    })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<CompareData> }) => {
    const setValue = useNodeSetter(node)
    const models = contendersOf(node.data)
    const setModels = (next: Contender[]) => setValue('models', next)
    const update = (index: number, patch: Partial<Contender>) => setModels(models.map((x, i) => i == index ? { ...x, ...patch } : x))
    // Mock mode offers every provider and model; otherwise only those the user's keys can use.
    const access = useSettingStore(useShallow((s) => ({
        sampleAnswers: s.sampleAnswers, devMode: s.devMode, apiKeys: s.apiKeys, compatibleBaseUrl: s.compatibleBaseUrl, accountModels: s.accountModels,
    })))
    const usable = availableProviders(access)
    useAutoLoadAccountModels(models.map(c => c.provider))
    const modelOptions = (c: Contender) => {
        const list = availableModels(c.provider, access).filter(m => !m.deprecated)
        const current = findModel(c.model)
        return current && current.provider == c.provider && !list.includes(current) ? [...list, current] : list
    }

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-2'>
                <div className='flex items-center'>
                    <Label className='text-sm font-semibold'>Models</Label>
                    <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip='Add model' aria-label='Add model' disabled={models.length >= 6} onClick={() => setModels([...models, { provider: 'google', model: DEFAULT_MODELS.google }])}>
                        <Plus className='w-4 h-4' />
                    </Button>
                </div>
                {models.map((c, index) => (
                    <div key={index} className='flex gap-1 items-center'>
                        <Select value={c.provider} onValueChange={(p) => update(index, { provider: p as ProviderId, model: DEFAULT_MODELS[p as ProviderId] })}>
                            <SelectTrigger aria-label='Provider' className='w-28 shrink-0'><SelectValue /></SelectTrigger>
                            <SelectContent>{PROVIDERS.filter(p => usable.includes(p.id) || p.id == c.provider).map(p => <SelectItem key={p.id} value={p.id}>{p.label.split(' ')[0]}</SelectItem>)}</SelectContent>
                        </Select>
                        {c.provider == 'compatible' ? (
                            <Input aria-label='Model ID' value={c.model} placeholder='Model ID' onChange={(e) => update(index, { model: e.target.value.trim() })} />
                        ) : (
                            <Select value={c.model} onValueChange={(m) => update(index, { model: m })}>
                                <SelectTrigger aria-label='Model'><SelectValue placeholder='Model' /></SelectTrigger>
                                <SelectContent>{modelOptions(c).map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
                            </Select>
                        )}
                        <Button variant="ghost" size="sm" aria-label='Remove model' className="text-danger p-0.5 h-8 w-8 shrink-0" disabled={models.length <= 2} onClick={() => setModels(models.filter((_, i) => i != index))}>
                            <Trash className='w-4 h-4' />
                        </Button>
                    </div>
                ))}
                <p className='text-xs text-muted-foreground'>2 to 6 models. They run at the same time, within the parallel limit in Settings.</p>
            </div>
            <TemplateField node={node} field='system_prompt' label='System Prompt' placeholder='Optional' />
            <TemplateField node={node} field='prompt' label='Prompt' rich className='h-28' placeholder='{start.question}' />
            <TestOutputField node={node as AppNode} help='With sample answers on, every model returns this text with its name added.' />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
