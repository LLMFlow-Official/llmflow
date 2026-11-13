import { ImageIcon, Plus, ScrollText, Trash } from 'lucide-react';
import { AppContext, NodeMetaData, NodeOutput, OutputExtra, Controller, NodeLogViewProps } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp, NodeData, useRuntimeStore } from '@/lib/store';
import { capitalize, cloneDeep, get, set } from 'lodash';
import { schemaOutputs } from '@/lib/schema_tools';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { useMemo, useState } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import NoteIcon from '../node_utils/node_icon';
import { ThreadSourceHandle, ThreadTargetHandle } from '../node_utils/thread_handle';
import DevMode from '../node_utils/dev_mode';
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
import { ModelNodeData, ModelSelect, nodeModel, nodeProvider, ReasoningEffortSelect, TierSelect, ToolsSection } from '../node_utils/model_select';
import { TestOutputField } from '../node_utils/node_shell';
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
        name: {
            title: 'Node name',
            description: 'Name used in the node',
            value: node.data.name
        },
        model_name: {
            title: 'Model Name',
            description: 'Model used in the node',
            value: nodeModel(node.data)
        },
        system_prompt: {
            title: 'System Prompt',
            description: 'System prompt used in the node',
            value: node.data.system_prompt
        },
        assistant_raw_output: {
            title: 'Assistant Raw Output',
            description: 'Raw assistant output that getting from the response',
            value: extra.assistant_raw_output
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
            title: 'Assistant Json Output',
            description: 'JSON formatted output from the assistant',
            value: extra.assistant_json_output as string
        }
    }

    if (node.data.response_format == 'json_schema') {
        const json = extra.assistant_json_output as Record<string, unknown> | undefined
        for (const field of schemaOutputs(node.data.response_schema?.schema)) {
            const last = field.path.split('.').at(-1)!
            outputs[`assistant_json_output.${field.path}`] = {
                title: field.title || `${capitalize(last)} Value`,
                description: field.description || 'This value will set from the output structure',
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
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 p-0.5 h-6 w-6" onClick={() => setImages(images.filter((_, i) => i != index))}>
                        <Trash className='w-4 h-4' />
                    </Button>
                </div>
            ))}
        </div>
    )
}

export const Properties = ({ node }: { node: AppNode<PromptData> }) => {
    const updateNode = useFlowStore(state => state.updateNode);
    const [selectedType, setSelectedType] = useState<string>();
    const [deletePrompt, setDeletePrompt] = useState<number>();
    const [prompts, setPrompts] = useState(node.data.prompts || []);

    const model = nodeModel(node.data)
    const modelInfo = findModel(model)
    const showSampling = supportsSampling(model, node.data.reasoning_effort)
    const reasons = !modelInfo || !!modelInfo.reasoningEfforts

    const setValue = (key: string, value: string | number | SchemaType | undefined) => {
        const clonedNode = cloneDeep(node);
        if (value === undefined) delete (clonedNode.data as Record<string, unknown>)[key];
        else set(clonedNode, `data.${key}`, value);
        updateNode(clonedNode);
    }

    const setPromptValue = (index: number, value: string) => {
        const clonePrompts = cloneDeep(prompts);
        clonePrompts[index].content = value
        setPrompts(clonePrompts)
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.prompts.${index}.content`, value);
        updateNode(clonedNode);
    }

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        const newProperty = {
            role: formData.get('type') as 'user' | 'assistant'
        };
        setPrompts([...prompts, newProperty]);
        const clonedNode = cloneDeep(node);
        set(clonedNode, 'data.prompts', [...prompts, newProperty]);
        updateNode(clonedNode);
        setSelectedType(undefined);
        (e.target as HTMLFormElement).reset();
    };

    const handleDelete = (promptIndex?: number, force: boolean = false) => {
        if (!force && promptIndex != undefined && prompts[promptIndex].content) {
            setDeletePrompt(promptIndex);
            return;
        }

        const updatedPrompts = prompts.filter((_, i) => i != promptIndex);
        setDeletePrompt(undefined);
        setPrompts(updatedPrompts);
        const clonedNode = cloneDeep(node);
        set(clonedNode, 'data.prompts', updatedPrompts);
        updateNode(clonedNode);
    };

    return (
        <div className='flex flex-col gap-3 px-3'>
            <div className='flex flex-col gap-1'>
                <Label>Name</Label>
                <Input
                    name="name"
                    value={node.data.name}
                    placeholder={Metadata.name}
                    onChange={(e) => setValue('name', e.target.value)}
                />
            </div>
            <ModelSelect node={node} />
            <ViewAsCode request={() => buildRequest(node, (text) => text)} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold flex'>Response Format</Label>
                <Select
                    name='type'
                    required
                    value={node.data.response_format || 'text'}
                    onValueChange={(e) => setValue('response_format', e)}
                >
                    <SelectTrigger>
                        <SelectValue className='w-full' placeholder="Response Format" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="json_object">JSON Object</SelectItem>
                        <SelectItem value="json_schema">JSON Schema</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {node.data.response_format == 'json_schema' ? <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold flex'>Output structure</Label>
                <SchemaEditor defaultValue={node.data.response_schema} onSave={(e) => setValue('response_schema', e)} />
            </div> : null}
            <ReasoningEffortSelect node={node} />
            <TierSelect node={node} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold flex' htmlFor='max_output_tokens'>Max Output Tokens</Label>
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
                {reasons ? <p className='text-xs text-muted-foreground'>Includes reasoning tokens.</p> : null}
            </div>
            {showSampling ? <>
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold flex items-center'>
                        Temperature
                        <div className='ml-auto flex items-center gap-2'>
                            {node.data.temperature !== undefined ? <button className='text-xs font-normal text-muted-foreground underline' onClick={() => setValue('temperature', undefined)}>Reset</button> : null}
                            {node.data.temperature ?? 'Default'}
                        </div>
                    </Label>
                    <Slider value={[node.data.temperature ?? 1]} max={2} min={0} step={0.01} onValueChange={(e) => setValue('temperature', e[0])} />
                </div>
                <div className='flex flex-col gap-1'>
                    <Label className='text-sm font-semibold flex items-center'>
                        Top P
                        <div className='ml-auto flex items-center gap-2'>
                            {node.data.top_p !== undefined ? <button className='text-xs font-normal text-muted-foreground underline' onClick={() => setValue('top_p', undefined)}>Reset</button> : null}
                            {node.data.top_p ?? 'Default'}
                        </div>
                    </Label>
                    <Slider value={[node.data.top_p ?? 1]} max={1} min={0} step={0.01} onValueChange={(e) => setValue('top_p', e[0])} />
                </div>
            </> : modelInfo?.reasoningEfforts?.includes('none') ? (
                <p className='text-xs text-muted-foreground'>Set reasoning effort to None to use temperature and top P with this model.</p>
            ) : null}
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor="system_prompt">System Prompt</Label>
                <Textarea
                    id="system_prompt"
                    name="system_prompt"
                    value={node.data.system_prompt}
                    className='h-20'
                    placeholder='Enter your system prompt here (optional)...'
                    onChange={(e) => setValue('system_prompt', e.target.value)}
                    node={node}
                />
            </div>
            {prompts.map((prompt, index) => (
                <div key={index} className='flex flex-col gap-1'>
                    <div className='flex'>
                        <Label className='text-sm font-semibold' htmlFor="system_prompt">{prompt.role == 'user' ? "User" : "Assistant"} Prompt</Label>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(index)}
                            className="text-red-500 hover:text-red-700 p-0.5 h-6 w-6 ml-auto"
                        >
                            <Trash className='w-4 h-4' />
                        </Button>
                    </div>
                    <Textarea
                        id="prompt"
                        name="prompt"
                        value={prompt.content}
                        className='h-20'
                        placeholder='Enter your prompt here...'
                        onChange={(e) => setPromptValue(index, e.target.value)}
                        node={node}
                    />
                </div>
            ))}
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <span className='text-sm font-semibold'>Add Prompt section</span>
                <div className='flex gap-2'>
                    <Select
                        name='type'
                        required
                        value={selectedType}
                        onValueChange={(e) => setSelectedType(e)}
                    >
                        <SelectTrigger>
                            <SelectValue className='w-full' placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="assistant">Assistant</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button className='w-10' size={'icon'} type="submit">
                        <Plus className='w-4 h-4' />
                    </Button>
                </div>
            </form>
            <ImageInputs node={node} />
            <ToolsSection node={node} />
            <TestOutputField
                node={node as AppNode}
                type={['json_schema', 'json_object'].includes(node.data.response_format || 'text') ? 'json' : 'text'}
            />
            <ConfirmAlert
                open={deletePrompt != undefined}
                title="Delete this prompt?"
                description="The prompt text is removed from this step."
                confirmLabel="Delete prompt"
                destructive
                onConfirm={() => handleDelete(deletePrompt, true)}
                onCancel={() => setDeletePrompt(undefined)}
            />
        </div>
    )
}

const noteStateVariants = cva(
    "bg-card border-2 text-red-600 border-red-600 p-2 flex flex-col gap-2 rounded-md items-center  transition-all duration-300", //tw
    {
        variants: {
            state: {
                idle: '',
                faded: 'opacity-20', //tw
                waiting: 'opacity-20',
                running: 'opacity-40',
                completed: 'opacity-100',
                failed: 'opacity-80 outline-solid outline-offset-1 outline-red-500', //tw
                skipped: 'opacity-30 border-dashed', //tw
            }
        },
        defaultVariants: {
            state: 'idle'
        }
    }
)

export function Node({ id, selectable, isConnectable, data }: AppNodeProp) {
    const state = useRuntimeStore((state) => selectable != undefined && !selectable ? "faded" : state.nodeStates[id])
    const name = useMemo(() => {
        return (data?.name || Metadata.name) as string;
    }, [data?.name]);

    return (
        <div className={cn(noteStateVariants({ state }))}>
            <ThreadTargetHandle active={isConnectable} />
            <div className='flex gap-2'>
                <NoteIcon state={state} idleIcon={ScrollText} />
                <span className='text-sm font-semibold'>{name}</span>
            </div>
            <DevMode data={data} />
            <ThreadSourceHandle active={isConnectable} />
        </div>
    );
}
