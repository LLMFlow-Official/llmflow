import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { capitalize, cloneDeep, set, unset } from 'lodash';
import { useMemo, useState } from 'react';
import { AxiosError } from 'axios';
import { AppNode, useFlowStore, useSettingStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    DEFAULT_MODEL_ID, findModel, getModelStatus, listAccountModels, models, ReasoningEffort, retiredModels
} from '@/lib/openai';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select';

const ALL_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_OPTION = '__default__'
const CUSTOM_OPTION = '__custom__'

type ModelNodeData = {
    model?: string
    reasoning_effort?: ReasoningEffort
    max_output_tokens?: number
}

/** Sets the node's model and drops settings the new model does not accept. */
function useSetModel(node: AppNode) {
    const updateNode = useFlowStore(state => state.updateNode);
    return (id: string) => {
        const clonedNode = cloneDeep(node) as AppNode<ModelNodeData>;
        set(clonedNode, 'data.model', id);
        const info = findModel(id)
        if (info && clonedNode.data.reasoning_effort && !info.reasoningEfforts?.includes(clonedNode.data.reasoning_effort)) {
            unset(clonedNode, 'data.reasoning_effort');
        }
        if (info?.maxOutputTokens && (clonedNode.data.max_output_tokens || 0) > info.maxOutputTokens) {
            unset(clonedNode, 'data.max_output_tokens');
        }
        updateNode(clonedNode as AppNode);
    }
}

function ModelNotice({ model, onSwitch }: { model: string, onSwitch: (id: string) => void }) {
    const status = getModelStatus(model)
    if (status.kind == 'ok') return null

    if (status.kind == 'unknown') {
        return (
            <div className='flex gap-2 items-start text-xs text-gray-600 bg-accent border border-gray-300 rounded-md p-2'>
                <Info className='w-4 h-4 shrink-0' />
                <span>This model is not in the built-in price list, so its cost is shown as unknown.</span>
            </div>
        )
    }

    const switchTarget = status.replacement && findModel(status.replacement) ? status.replacement : undefined
    const retired = status.kind == 'retired'

    return (
        <div className={cn('flex gap-2 items-start text-xs rounded-md p-2 border', retired ? 'text-red-700 bg-red-50 border-red-300' : 'text-amber-800 bg-amber-50 border-amber-300')}>
            <AlertTriangle className='w-4 h-4 shrink-0' />
            <div className='flex flex-col gap-1'>
                <span>
                    {retired
                        ? <>OpenAI shut down <b>{model}</b> on {status.shutdownDate}. This node will fail until you choose another model.</>
                        : <>OpenAI will shut down <b>{model}</b> on {status.shutdownDate}.</>}
                    {status.replacement && !switchTarget ? <> OpenAI suggests {status.replacement}.</> : null}
                </span>
                {switchTarget ? (
                    <Button size='sm' variant='outline' className='h-6 w-fit px-2 text-xs' onClick={() => onSwitch(switchTarget)}>
                        Switch to {findModel(switchTarget)?.label}
                    </Button>
                ) : null}
            </div>
        </div>
    )
}

/**
 * Model picker for nodes that call the Responses API: built-in models grouped by family, models
 * loaded from the user's account, a custom ID, and a notice for deprecated or shut-down models.
 */
export function ModelSelect({ node }: { node: AppNode }) {
    const { toast } = useToast()
    const accountModels = useSettingStore((s) => s.accountModels)
    const setAccountModels = useSettingStore((s) => s.setAccountModels)
    const setModel = useSetModel(node)
    const [loadingModels, setLoadingModels] = useState(false)

    const data = node.data as ModelNodeData
    const model = data.model || DEFAULT_MODEL_ID
    const modelInfo = findModel(model)
    const extraAccountModels = useMemo(() => accountModels.filter(x => !findModel(x) && !retiredModels[x]), [accountModels])
    const isListedModel = !!modelInfo || !!retiredModels[model] || extraAccountModels.includes(model)
    const [customMode, setCustomMode] = useState(!isListedModel)

    const onSelect = (value: string) => {
        if (value == CUSTOM_OPTION) {
            setCustomMode(true)
            return
        }
        setCustomMode(false)
        setModel(value)
    }

    const loadAccountModels = async () => {
        const token = useSettingStore.getState().openAIKey
        if (!token) {
            toast({ title: 'Add your OpenAI API key in Settings first', duration: 3000 })
            return
        }
        setLoadingModels(true)
        try {
            const ids = await listAccountModels(token)
            setAccountModels(ids)
            toast({ title: `Loaded ${ids.length} models from your OpenAI account`, duration: 3000 })
        } catch (error) {
            const message = error instanceof AxiosError ? error.response?.data?.error?.message || error.message : (error as Error).message
            toast({ title: 'Could not load models', description: message, duration: 3000 })
        } finally {
            setLoadingModels(false)
        }
    }

    const groups = ['GPT-6', 'GPT-5', 'GPT-4.1'] as const

    return (
        <div className='flex flex-col gap-1'>
            <div className='flex items-center'>
                <Label className='text-sm font-semibold' htmlFor="model">Model</Label>
                <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6 p-1 ml-auto'
                    toolTip='Load models from your OpenAI account'
                    disabled={loadingModels}
                    onClick={loadAccountModels}
                >
                    <RefreshCw className={cn('w-4 h-4', loadingModels && 'animate-spin')} />
                </Button>
            </div>
            <Select name="model" value={customMode ? CUSTOM_OPTION : model} onValueChange={onSelect}>
                <SelectTrigger>
                    <SelectValue id="model" placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                    {groups.map(group => (
                        <SelectGroup key={group}>
                            <SelectLabel>{group}</SelectLabel>
                            {models.filter(x => x.group == group).map(x => (
                                <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>
                            ))}
                        </SelectGroup>
                    ))}
                    {modelInfo?.group == 'Deprecated' ? (
                        <SelectGroup>
                            <SelectLabel>Deprecated</SelectLabel>
                            {models.filter(x => x.group == 'Deprecated').map(x => (
                                <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>
                            ))}
                        </SelectGroup>
                    ) : null}
                    {retiredModels[model] ? (
                        <SelectGroup>
                            <SelectLabel>Shut down</SelectLabel>
                            <SelectItem value={model}>{model}</SelectItem>
                        </SelectGroup>
                    ) : null}
                    {extraAccountModels.length ? (
                        <SelectGroup>
                            <SelectLabel>Other models on your account</SelectLabel>
                            {extraAccountModels.map(x => (
                                <SelectItem key={x} value={x}>{x}</SelectItem>
                            ))}
                        </SelectGroup>
                    ) : null}
                    <SelectGroup>
                        <SelectItem value={CUSTOM_OPTION}>Custom model ID…</SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
            {customMode ? (
                <Input
                    name="custom_model"
                    value={data.model || ''}
                    placeholder="e.g. gpt-6.1-sol-2026-09-01"
                    onChange={(e) => setModel(e.target.value.trim())}
                />
            ) : modelInfo?.description ? (
                <p className='text-xs text-gray-500'>{modelInfo.description}</p>
            ) : null}
            <ModelNotice model={model} onSwitch={(id) => { setCustomMode(false); setModel(id) }} />
        </div>
    )
}

/** Reasoning effort options the node's model accepts. Hidden for models that do not reason. */
export function ReasoningEffortSelect({ node }: { node: AppNode }) {
    const updateNode = useFlowStore(state => state.updateNode);
    const data = node.data as ModelNodeData
    const modelInfo = findModel(data.model || DEFAULT_MODEL_ID)
    const options = modelInfo ? modelInfo.reasoningEfforts : ALL_EFFORTS
    if (!options) return null

    const onChange = (value: string) => {
        const clonedNode = cloneDeep(node)
        if (value == DEFAULT_OPTION) unset(clonedNode, 'data.reasoning_effort')
        else set(clonedNode, 'data.reasoning_effort', value)
        updateNode(clonedNode)
    }

    return (
        <div className='flex flex-col gap-1'>
            <Label className='text-sm font-semibold flex'>Reasoning Effort</Label>
            <Select name='reasoning_effort' value={data.reasoning_effort || DEFAULT_OPTION} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue className='w-full' placeholder="Model default" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={DEFAULT_OPTION}>Model default</SelectItem>
                    {options.map(x => (
                        <SelectItem key={x} value={x}>{capitalize(x)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
