import { Download, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import {
    DEFAULT_IMAGE_MODEL_ID, ImagePayload, imageModels, imageResponseToUrl, imageUsageToCost, OpenAi
} from '@/lib/openai';
import { getApiKey, toOpenAiError } from '@/lib/openai/run';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Stats } from '../node_utils/stats';
import { NameField, NodeShell, onFlowStop, TemplateField, TestOutputField, useNodeSetter } from '../node_utils/node_shell';

const CUSTOM_OPTION = '__custom__'
const AUTO = 'auto'

type ImageGenerationData = NodeData & {
    model?: string
    prompt?: string
    size?: string
    quality?: ImagePayload['quality']
    output_format?: ImagePayload['output_format']
    background?: ImagePayload['background']
    test_output?: string
}

export const Metadata: NodeMetaData = {
    type: 'image_generation',
    name: 'Image Generation',
    description: 'Create an image from a text prompt with an OpenAI image model',
    tags: ['image', 'picture', 'draw', 'generate', 'art', 'OpenAI'],
}

export const Outputs = (node: AppNode<ImageGenerationData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    image: { title: 'Image', description: 'The image as a data URL. Use it in a prompt node\'s Images field.', value: extra.image as string },
    revised_prompt: { title: 'Revised prompt', description: 'The prompt the model actually used, when it returns one', value: extra.revised_prompt as string },
} as NodeOutput)

type LogViewPayload = {
    image: string
    format: string
    inToken: number
    outToken: number
    amount: number | null
    startTime: number
    endTime: number
}

export function LogView({ payload }: NodeLogViewProps<LogViewPayload>) {
    return <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={payload.image} alt='Generated image' className='max-h-64 w-auto rounded-md border border-gray-300 mx-auto' />
        <a href={payload.image} download={`image.${payload.format}`} className='mt-1 flex items-center gap-1 text-xs text-blue-600 underline w-fit'>
            <Download className='w-3 h-3' /> Download
        </a>
        <Stats amount={payload.amount} inToken={payload.inToken} outToken={payload.outToken} startTime={payload.startTime} endTime={payload.endTime} />
    </>
}

export const Process = async (context: AppContext, node: AppNode<ImageGenerationData>, nextNodes: AppNode[], controller: Controller) => {
    const prompt = renderTextTemplate(node.data.prompt || '', context)
    if (!prompt.trim()) throw Error("Prompt is required")

    const token = getApiKey()
    const model = node.data.model || DEFAULT_IMAGE_MODEL_ID
    const format = node.data.output_format || 'png'
    const startTime = Date.now()

    let image: string
    let revisedPrompt: string | undefined
    let inToken = 0
    let outToken = 0
    let amount: number | null = null

    if (token === null) {
        if (!node.data.test_output?.trim()) throw Error("Test Image URL is required")
        image = node.data.test_output.trim()
        controller.increaseAmount(null)
    } else {
        const payload: ImagePayload = {
            model,
            prompt,
            n: 1,
            ...(node.data.size ? { size: node.data.size } : {}),
            ...(node.data.quality ? { quality: node.data.quality } : {}),
            ...(node.data.output_format ? { output_format: node.data.output_format } : {}),
            ...(node.data.background ? { background: node.data.background } : {}),
        }

        const abort = new AbortController()
        const removeStopListener = onFlowStop(() => abort.abort())
        try {
            const response = (await OpenAi(token).generateImage(payload, abort.signal)).data
            image = imageResponseToUrl(response, format)
            revisedPrompt = response.data?.[0]?.revised_prompt
            inToken = response.usage?.input_tokens ?? 0
            outToken = response.usage?.output_tokens ?? 0
            const cost = imageUsageToCost(response.usage, model)
            amount = cost === null ? null : cost.toNumber()
            controller.increaseInToken(inToken)
            controller.increaseOutToken(outToken)
            controller.increaseAmount(cost)
        } catch (error) {
            if (abort.signal.aborted) return []
            throw toOpenAiError(error)
        } finally {
            removeStopListener()
        }
    }

    context[node.id] = { name: node.data.name, image, revised_prompt: revisedPrompt }
    controller.log({
        id: node.id,
        type: 'success',
        title: 'Image created',
        nodeType: node.type,
        payload: { image, format, inToken, outToken, amount, startTime, endTime: Date.now() } as LogViewPayload
    })
    return nextNodes
}

function OptionSelect({ label, value, options, onChange }: { label: string, value?: string, options: [string, string][], onChange: (value?: string) => void }) {
    return (
        <div className='flex flex-col gap-1 flex-1'>
            <Label className='text-sm font-semibold'>{label}</Label>
            <Select value={value || AUTO} onValueChange={(e) => onChange(e == AUTO ? undefined : e)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    {options.map(([v, text]) => <SelectItem key={v} value={v}>{text}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    )
}

export const Properties = ({ node }: { node: AppNode<ImageGenerationData> }) => {
    const setValue = useNodeSetter(node)
    const model = node.data.model || DEFAULT_IMAGE_MODEL_ID
    const known = imageModels.find(x => x.id == model)
    const [customMode, setCustomMode] = useState(!known)

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Model</Label>
                <Select
                    value={customMode ? CUSTOM_OPTION : model}
                    onValueChange={(e) => {
                        setCustomMode(e == CUSTOM_OPTION)
                        if (e != CUSTOM_OPTION) setValue('model', e)
                    }}
                >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {imageModels.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
                        <SelectItem value={CUSTOM_OPTION}>Custom model ID…</SelectItem>
                    </SelectContent>
                </Select>
                {customMode ? (
                    <Input value={node.data.model || ''} placeholder='e.g. gpt-image-2.6-flare' onChange={(e) => setValue('model', e.target.value.trim())} />
                ) : known?.description ? <p className='text-xs text-gray-500'>{known.description}</p> : null}
                {!known?.prices ? <p className='text-xs text-gray-500'>Cost is shown as unknown for this model.</p> : null}
            </div>
            <TemplateField node={node} field='prompt' label='Prompt' rich className='h-28' placeholder='A watercolor of {start.topic} at sunrise' />
            <div className='flex gap-2'>
                <OptionSelect label='Size' value={node.data.size} onChange={(v) => setValue('size', v)} options={[
                    [AUTO, 'Auto'], ['1024x1024', 'Square'], ['1536x1024', 'Landscape'], ['1024x1536', 'Portrait'],
                ]} />
                <OptionSelect label='Quality' value={node.data.quality} onChange={(v) => setValue('quality', v)} options={[
                    [AUTO, 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'],
                ]} />
            </div>
            <div className='flex gap-2'>
                <OptionSelect label='Format' value={node.data.output_format} onChange={(v) => setValue('output_format', v)} options={[
                    [AUTO, 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'],
                ]} />
                <OptionSelect label='Background' value={node.data.background} onChange={(v) => setValue('background', v)} options={[
                    [AUTO, 'Auto'], ['opaque', 'Opaque'], ['transparent', 'Transparent'],
                ]} />
            </div>
            {node.data.background == 'transparent' && node.data.output_format == 'jpeg' ? (
                <p className='text-xs text-red-600'>Transparent backgrounds need PNG or WebP.</p>
            ) : null}
            <TestOutputField node={node as AppNode} label='Test Image URL' help='In Test API mode, this URL is used as the image.' />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={ImageIcon} defaultName={Metadata.name} />
}
