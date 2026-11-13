import { AudioLines } from 'lucide-react';
import { useState } from 'react';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, createStopSignal, NodeData } from '@/lib/store';
import { renderTextTemplate } from '@/lib/logics';
import { parseList } from '@/lib/text_utils';
import { AUDIO_TYPES, DEFAULT_TRANSCRIPTION_MODEL, loadAudio, transcribe, transcriptionModels } from '@/lib/openai/audio_embeddings';
import { getProviderKey, isTestApi } from '@/lib/providers';
import { StoppedError } from '@/lib/errors';
import MarkdownViewer from '../ui/markdown_viewer';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { askForFile, NameField, NodeShell, TemplateField, TestOutputField, useNodeSetter } from '../node_utils/node_shell';

const CUSTOM_OPTION = '__custom__'

type TranscriptionData = NodeData & {
    model?: string
    source?: 'ask' | 'url'
    audio_url?: string
    languages?: string
    hint?: string
    test_output?: string
}

export const Metadata: NodeMetaData = {
    type: 'transcription',
    category: 'ai',
    icon: AudioLines,
    name: 'Transcription',
    description: 'Turn speech in an audio file into text with OpenAI',
    tags: ['audio', 'speech', 'transcribe', 'voice', 'whisper', 'OpenAI'],
}

export const Outputs = (node: AppNode<TranscriptionData>, extra: OutputExtra) => ({
    name: { title: 'Node name', value: node.data.name },
    text: { title: 'Text', description: 'What was said', value: extra.text as string },
    languages: { title: 'Languages', description: 'Detected language codes', value: extra.languages as string },
} as NodeOutput)

export function LogView({ payload }: NodeLogViewProps<string>) {
    return <MarkdownViewer text={payload} />
}

export const Process = async (context: AppContext, node: AppNode<TranscriptionData>, nextNodes: AppNode[], controller: Controller) => {
    let text: string
    let languages: string[] = []

    if (isTestApi()) {
        if (!node.data.test_output) throw Error("Test Output is required")
        text = node.data.test_output
    } else {
        const apiKey = getProviderKey('openai')
        const { signal, dispose } = createStopSignal()
        try {
            let audio: { blob: Blob, filename: string }
            if ((node.data.source || 'ask') == 'ask') {
                const file = await askForFile(node.id, node.data.name || Metadata.name, 'Choose the audio to transcribe (up to 25 MB).', 'audio/*,video/mp4,video/webm')
                if (file === undefined) throw new StoppedError()
                if (file === null) throw Error("No audio file was chosen")
                audio = { blob: file, filename: file.name }
            } else {
                const url = renderTextTemplate(node.data.audio_url || '', context).trim()
                if (!url) throw Error("Audio URL is required")
                audio = await loadAudio(url, signal)
            }
            const result = await transcribe(apiKey, node.data.model || DEFAULT_TRANSCRIPTION_MODEL, audio.blob, {
                filename: audio.filename,
                prompt: renderTextTemplate(node.data.hint || '', context) || undefined,
                languages: parseList(node.data.languages),
                signal,
            })
            text = result.text
            languages = (result.languages || []).map(x => x.code)
        } catch (error) {
            if (signal.aborted) throw new StoppedError()
            throw error
        } finally {
            dispose()
        }
    }

    // The transcription API does not report usage, so the cost is not known.
    controller.increaseAmount(null)
    context[node.id] = { name: node.data.name, text, languages }
    controller.log({ id: node.id, type: 'success', title: `Transcribed${languages.length ? ` (${languages.join(', ')})` : ''}`, nodeType: node.type, payload: text })
    return nextNodes
}

export const Properties = ({ node }: { node: AppNode<TranscriptionData> }) => {
    const setValue = useNodeSetter(node)
    const model = node.data.model || DEFAULT_TRANSCRIPTION_MODEL
    const known = transcriptionModels.some(x => x.id == model)
    const [customMode, setCustomMode] = useState(!known)
    const source = node.data.source || 'ask'

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node} placeholder={Metadata.name} />
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Model</Label>
                <Select value={customMode ? CUSTOM_OPTION : model} onValueChange={(e) => { setCustomMode(e == CUSTOM_OPTION); if (e != CUSTOM_OPTION) setValue('model', e) }}>
                    <SelectTrigger aria-label='Model'><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {transcriptionModels.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
                        <SelectItem value={CUSTOM_OPTION}>Custom model ID…</SelectItem>
                    </SelectContent>
                </Select>
                {customMode ? <Input aria-label='Model ID' value={node.data.model || ''} placeholder='Model ID' onChange={(e) => setValue('model', e.target.value.trim())} /> : null}
            </div>
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold'>Audio</Label>
                <Select value={source} onValueChange={(e) => setValue('source', e == 'ask' ? undefined : e)}>
                    <SelectTrigger aria-label='Audio source'><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value='ask'>Ask for a file when the flow runs</SelectItem>
                        <SelectItem value='url'>From a URL</SelectItem>
                    </SelectContent>
                </Select>
                <p className='text-xs text-muted-foreground'>Up to 25 MB: {AUDIO_TYPES.join(', ')}.</p>
            </div>
            {source == 'url' ? <TemplateField node={node} field='audio_url' label='Audio URL' className='h-12 min-h-0' placeholder='https://example.com/talk.mp3' help='The site must allow downloads from the browser (CORS).' /> : null}
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor='languages'>Languages (optional)</Label>
                <Input id='languages' value={node.data.languages || ''} placeholder='e.g. en, si' onChange={(e) => setValue('languages', e.target.value || undefined)} />
            </div>
            <TemplateField node={node} field='hint' label='Hint (optional)' placeholder='Names or terms that appear in the audio' />
            <TestOutputField node={node as AppNode} label='Test Transcript' />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} />
}
