import { ImageIcon, Plus, ScrollText, Trash } from 'lucide-react';
import { AppContext, NodeMetaData, NodeOutput, OutputExtra, Controller, NodeLogViewProps } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { capitalize, cloneDeep, get, set } from 'lodash';
import { schemaOutputs } from '@/lib/schema_tools';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { useState } from 'react';

import { Button } from '../ui/button';
import ConfirmAlert from '../ui/confirm_alert';
import { findModel, Message, parseJsonOutput, ResponseFormat, supportsSampling } from '@/lib/openai';
import { NormalizedUsage } from '@/lib/openai/models';
import { ChatRequest, runChat } from '@/lib/providers';
import { renderTextTemplate } from '@/lib/logics';
import { CitationList, UsageStats } from '../node_utils/stats';
import MarkdownViewer from '../ui/markdown_viewer';
import { Slider } from '../ui/slider';
import SchemaEditor, { SchemaType } from '../ui/schema_editor';
import { ModelNodeData, ModelSelect, modelSummary, nodeModel, nodeProvider, ReasoningEffortSelect, TierSelect, ToolsSection } from '../node_utils/model_select';
import { NameField, NodeShell, TestOutputField } from '../node_utils/node_shell';
import ViewAsCode from '../node_utils/view_as_code';

type PromptData = NodeData & ModelNodeData & {
    system_prompt?: string
    prompts?: Message[]
    /** Image URLs or {nodeId.image} references, sent with the last user prompt. */
    images?: string[]
    response_format?: ResponseFormat
    response_schema?: SchemaType
    temperature?: number
    top_p?: number
    test_output?: string
}

export const Metadata: NodeMetaData = {
    type: 'prompt',
    category: 'ai',
    icon: ScrollText,
    name: 'AI Prompt',
    description: 'Ask an AI model (OpenAI, Claude, Gemini or your own server) and use its answer',
    tags: ['OpenAI', 'ChatGPT', 'GPT', 'Claude', 'Anthropic', 'Gemini', 'Google', 'LLM', 'prompt', 'chat']
}

type LogViewPayload = {
    assistant_output: string
    usage: NormalizedUsage
    amount: number | null
    startTime: number
    endTime: number
    model: string
    citations?: { url: string, title?: string }[]
    searched?: boolean
}

export function LogView({ payload }: NodeLogViewProps<LogViewPayload>) {
    return <>
        <MarkdownViewer text={payload.assistant_output} />
        <CitationList citations={payload.citations} />
        <p className='text-[11px] text-muted-foreground mt-1'>{payload.model}</p>
        <UsageStats usage={payload.usage} amount={payload.amount} costIncomplete={payload.searched} startTime={payload.startTime} endTime={payload.endTime} />
    </>;
}

export const Outputs = (node: AppNode<PromptData>, extra: OutputExtra) => {
    const outputs = {
        assistant_raw_output: {
            title: 'Answer',
            description: "The model's reply as text",
            value: extra.assistant_raw_output
        },
        name: {
            title: 'Step name',
            value: node.data.name
        },
        model_name: {
            title: 'Model',
            description: 'The model this step uses',
            value: nodeModel(node.data)
        },
        system_prompt: {
            title: 'System prompt',
            value: node.data.system_prompt
        },
    } as NodeOutput

    if (node.data.tools?.webSearch) {
        outputs['citations'] = {
            title: 'Citations',
            description: 'Pages the answer cited (list of {url, title})',
            value: extra.citations as string
        }
    }

    if (node.data.response_format == 'json_object' || node.data.response_format == 'json_schema') {
        outputs['assistant_json_output'] = {
            title: 'Answer as JSON',
            description: 'The reply read as JSON; pick fields with {step.assistant_json_output.field}',
            value: extra.assistant_json_output as string
        }
    }

    if (node.data.response_format == 'json_schema') {
        const json = extra.assistant_json_output as Record<string, unknown> | undefined
        for (const field of schemaOutputs(node.data.response_schema?.schema)) {
            const last = field.path.split('.').at(-1)!
            outputs[`assistant_json_output.${field.path}`] = {
                title: field.title || `${capitalize(last)} Value`,
                description: field.description || 'A field from the output structure',
                value: json ? get(json, field.path) as string : undefined
            }
        }
    }

    return outputs
}

/** The request this node sends. `fill` replaces {node.value} references (identity for "view as code"). */
function buildRequest(node: AppNode<PromptData>, fill: (text: string) => string): ChatRequest {
    return {
        provider: nodeProvider(node.data),
        model: nodeModel(node.data),
        systemPrompt: fill(node.data.system_prompt || ''),
        messages: (node.data.prompts || []).map(x => ({
            ...x,
            content: fill(x.content || '')
        })),
        images: (node.data.images || []).map(fill),
        responseFormat: node.data.response_format || 'text',
        responseSchema: node.data.response_schema,
        reasoningEffort: node.data.reasoning_effort,
        maxOutputTokens: node.data.max_output_tokens,
        temperature: node.data.temperature,
        topP: node.data.top_p,
        tools: node.data.tools,
        tier: node.data.tier,
    }
}

export const Process = async (context: AppContext, node: AppNode<PromptData>, nextNodes: AppNode[], controller: Controller) => {
    const response_format = node.data.response_format || 'text'
    const request = buildRequest(node, (text) => renderTextTemplate(text, context))

    const run = await runChat(request, controller, { nodeId: node.id, testOutput: node.data.test_output })
    // Web searches have a per-search fee that usage does not report, so the run total becomes a lower bound.
    if (node.data.tools?.webSearch) controller.increaseAmount(null)
    const jsonOutput = response_format != 'text' ? parseJsonOutput(run.text) : undefined

    controller.log({
        id: node.id,
        type: run.warning ? 'warning' : 'success',
        title: run.warning || "Request successfully executed",
        nodeType: node.type,
        payload: {
            assistant_output: jsonOutput ? JSON.stringify(jsonOutput, null, 2) : run.text,
            usage: run.usage,
            amount: run.cost === null ? null : run.cost.toNumber(),
            startTime: run.startTime,
            endTime: run.endTime,
            model: run.model,
            citations: run.citations,
            searched: !!node.data.tools?.webSearch,
        } as LogViewPayload
    });

    context[node.id] = Object.fromEntries(Object.entries(Outputs(node, {
        assistant_raw_output: run.text,
        assistant_json_output: jsonOutput,
        citations: run.citations || [],
    })).map(([key, value]) => [key, value.value]))

    return nextNodes
}

function ImageInputs({ node }: { node: AppNode<PromptData> }) {
    const updateNode = useFlowStore(state => state.updateNode);
    const images = node.data.images || []

    const setImages = (next: string[]) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, 'data.images', next);
        updateNode(clonedNode);
    }

    return (
        <div className='flex flex-col gap-1'>
            <div className='flex items-center'>
                <Label className='text-sm font-semibold'>Images</Label>
                <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip='Add image' onClick={() => setImages([...images, ''])}>
                    <ImageIcon className='w-4 h-4' />
                </Button>
            </div>
            {images.length == 0 ? <p className='text-xs text-muted-foreground'>Optional. Add an image URL or pick an image from an Image Generation node.</p> : null}
            {images.map((image, index) => (
                <div key={index} className='flex gap-1 items-start'>
                    <Textarea
                        name={`image_${index}`}
                        value={image}
                        className='h-12 min-h-0'
                        classNameFrame='flex-1'
                        placeholder='https://… or {node.image}'
                        onChange={(e) => setImages(images.map((x, i) => i == index ? e.target.value : x))}
                        node={node}
                        withoutRichText
                    />
                    <Button variant="ghost" size="sm" className="text-danger hover:text-danger/80 p-0.5 h-6 w-6" onClick={() => setImages(images.filter((_, i) => i != index))}>
                        <Trash className='w-4 h-4' />
                    </Button>
                </div>
            ))}
        </div>
    )
}

export const Properties = ({ node }: { node: AppNode<PromptData> }) => {
    const updateNode = useFlowStore(state => state.updateNode);
    const [deletePrompt, setDeletePrompt] = useState<number>();
    // A new step starts with one empty user message, so there is always somewhere to type.
    const prompts: Message[] = node.data.prompts?.length ? node.data.prompts : [{ role: 'user', content: '' }]

    const model = nodeModel(node.data)
    const modelInfo = findModel(model)
    const showSampling = supportsSampling(model, node.data.reasoning_effort)
    const reasons = !modelInfo || !!modelInfo.reasoningEfforts
    const hasAdvanced = (node.data.response_format || 'text') != 'text' || !!node.data.reasoning_effort || !!node.data.tier
        || node.data.max_output_tokens != undefined || node.data.temperature != undefined || node.data.top_p != undefined
        || !!(node.data as { images?: unknown[] }).images?.length || !!node.data.tools && Object.keys(node.data.tools).length > 0
    const [advancedOpen, setAdvancedOpen] = useState(hasAdvanced)

    const setValue = (key: string, value: string | number | SchemaType | undefined) => {
        const clonedNode = cloneDeep(node);
        if (value === undefined) delete (clonedNode.data as Record<string, unknown>)[key];
        else set(clonedNode, `data.${key}`, value);
        updateNode(clonedNode);
    }

    const setPrompts = (next: Message[]) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, 'data.prompts', next);
        updateNode(clonedNode);
    }

    const setPromptValue = (index: number, value: string) => {
        const next = cloneDeep(prompts)
        next[index].content = value
        setPrompts(next)
    }

    const addPrompt = (role: 'user' | 'assistant') => setPrompts([...prompts, { role, content: '' }])

    const handleDelete = (promptIndex?: number, force: boolean = false) => {
        if (!force && promptIndex != undefined && prompts[promptIndex].content) {
            setDeletePrompt(promptIndex);
            return;
        }
        setDeletePrompt(undefined);
        setPrompts(prompts.filter((_, i) => i != promptIndex));
    };

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node as AppNode} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor="system_prompt">Instructions <span className='font-normal text-muted-foreground'>(optional)</span></Label>
                <Textarea
                    id="system_prompt"
                    name="system_prompt"
                    value={node.data.system_prompt}
                    className='h-20'
                    placeholder='How the model should behave, e.g. "You are a friendly support agent. Answer in two sentences."'
                    onChange={(e) => setValue('system_prompt', e.target.value)}
                    node={node}
                />
            </div>
            {prompts.map((prompt, index) => (
                <div key={index} className='flex flex-col gap-1'>
                    <div className='flex items-center'>
                        <Label className='text-sm font-semibold' htmlFor={`prompt-${index}`}>
                            {prompt.role == 'user' ? (index == 0 ? 'Message' : 'Next message') : 'Example answer'}
                        </Label>
                        {prompts.length > 1 || prompt.content ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Delete ${prompt.role == 'user' ? 'message' : 'example answer'} ${index + 1}`}
                                onClick={() => handleDelete(index)}
                                className="text-danger hover:text-danger/80 p-0.5 h-6 w-6 ml-auto"
                            >
                                <Trash className='w-4 h-4' />
                            </Button>
                        ) : null}
                    </div>
                    <Textarea
                        id={`prompt-${index}`}
                        name={`prompt-${index}`}
                        value={prompt.content}
                        className='h-24'
                        placeholder={prompt.role == 'user'
                            ? (index == 0 ? 'What to ask, e.g. "Summarize this: {start.text}". Type { to use a value from an earlier step.' : 'A follow-up message')
                            : 'An example of the answer you want (the model treats it as its own earlier reply)'}
                        onChange={(e) => setPromptValue(index, e.target.value)}
                        node={node}
                    />
                </div>
            ))}
            <div className='flex flex-wrap gap-2'>
                <Button variant="outline" size="sm" className='gap-1' onClick={() => addPrompt('user')}><Plus className='w-4 h-4' /> Message</Button>
                <Button variant="outline" size="sm" className='gap-1' onClick={() => addPrompt('assistant')}><Plus className='w-4 h-4' /> Example answer</Button>
            </div>
            <ModelSelect node={node} />
            <details className='rounded-md border border-border' open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
                <summary className='cursor-pointer select-none px-3 py-2 text-sm font-semibold'>Advanced <span className='font-normal text-muted-foreground'>(format, reasoning, length, tools, images)</span></summary>
                <div className='flex flex-col gap-3 p-3 pt-1'>
                    <div className='flex flex-col gap-1'>
                        <Label className='text-sm font-semibold flex' htmlFor='response_format'>Answer format</Label>
                        <Select
                            name='response_format'
                            value={node.data.response_format || 'text'}
                            onValueChange={(e) => setValue('response_format', e)}
                        >
                            <SelectTrigger id='response_format'>
                                <SelectValue className='w-full' placeholder="Answer format" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="text">Text</SelectItem>
                                <SelectItem value="json_object">JSON</SelectItem>
                                <SelectItem value="json_schema">JSON with fields you define</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {node.data.response_format == 'json_schema' ? <div className='flex flex-col gap-1'>
                        <Label className='text-sm font-semibold flex'>Fields</Label>
                        <SchemaEditor defaultValue={node.data.response_schema} onSave={(e) => setValue('response_schema', e)} />
                    </div> : null}
                    <ReasoningEffortSelect node={node} />
                    <TierSelect node={node} />
                    <div className='flex flex-col gap-1'>
                        <Label className='text-sm font-semibold flex' htmlFor='max_output_tokens'>Longest answer (tokens)</Label>
                        <Input
                            id='max_output_tokens'
                            name='max_output_tokens'
                            type='number'
                            min={1}
                            max={modelInfo?.maxOutputTokens}
                            value={node.data.max_output_tokens ?? ''}
                            placeholder='Model default'
                            onChange={(e) => {
                                const value = parseInt(e.target.value, 10)
                                setValue('max_output_tokens', Number.isFinite(value) && value > 0 ? value : undefined)
                            }}
                        />
                        {reasons ? <p className='text-xs text-muted-foreground'>Includes the tokens the model uses to think.</p> : null}
                    </div>
                    {showSampling ? <>
                        <div className='flex flex-col gap-1'>
                            <Label className='text-sm font-semibold flex items-center' id='temperature-label'>
                                Temperature
                                <div className='ml-auto flex items-center gap-2'>
                                    {node.data.temperature !== undefined ? <button className='text-xs font-normal text-muted-foreground underline' onClick={() => setValue('temperature', undefined)}>Reset</button> : null}
                                    {node.data.temperature ?? 'Default'}
                                </div>
                            </Label>
                            <Slider aria-labelledby='temperature-label' value={[node.data.temperature ?? 1]} max={2} min={0} step={0.01} onValueChange={(e) => setValue('temperature', e[0])} />
                        </div>
                        <div className='flex flex-col gap-1'>
                            <Label className='text-sm font-semibold flex items-center' id='top-p-label'>
                                Top P
                                <div className='ml-auto flex items-center gap-2'>
                                    {node.data.top_p !== undefined ? <button className='text-xs font-normal text-muted-foreground underline' onClick={() => setValue('top_p', undefined)}>Reset</button> : null}
                                    {node.data.top_p ?? 'Default'}
                                </div>
                            </Label>
                            <Slider aria-labelledby='top-p-label' value={[node.data.top_p ?? 1]} max={1} min={0} step={0.01} onValueChange={(e) => setValue('top_p', e[0])} />
                        </div>
                    </> : modelInfo?.reasoningEfforts?.includes('none') ? (
                        <p className='text-xs text-muted-foreground'>Set reasoning effort to None to use temperature and top P with this model.</p>
                    ) : null}
                    <ImageInputs node={node} />
                    <ToolsSection node={node} />
                    <ViewAsCode request={() => buildRequest(node, (text) => text)} />
                </div>
            </details>
            <TestOutputField
                node={node as AppNode}
                type={['json_schema', 'json_object'].includes(node.data.response_format || 'text') ? 'json' : 'text'}
            />
            <ConfirmAlert
                open={deletePrompt != undefined}
                title="Delete this message?"
                description="Its text is removed from this step."
                confirmLabel="Delete message"
                destructive
                onConfirm={() => handleDelete(deletePrompt, true)}
                onCancel={() => setDeletePrompt(undefined)}
            />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} summary={modelSummary(props.data as ModelNodeData)} />
}
