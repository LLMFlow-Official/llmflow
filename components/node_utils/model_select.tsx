import { AlertTriangle, Info, Plus, RefreshCw, Trash } from 'lucide-react';
import { capitalize, cloneDeep, set, unset } from 'lodash';
import { useMemo, useState } from 'react';
import { AppNode, useFlowStore, useSettingStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    DEFAULT_MODELS, findModel, getModelStatus, modelsFor, ProcessingTier, PROVIDERS, ProviderId, ReasoningEffort, retiredModels
} from '@/lib/openai/models';
import { listProviderModels } from '@/lib/providers/list_models';
import { McpServer, PROVIDER_TOOLS, ToolOptions } from '@/lib/providers/types';
import { parseList } from '@/lib/text_utils';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select';

const ALL_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_OPTION = '__default__'
const CUSTOM_OPTION = '__custom__'

export type ModelNodeData = {
    provider?: ProviderId
    model?: string
    reasoning_effort?: ReasoningEffort
    max_output_tokens?: number
    tier?: ProcessingTier
    tools?: ToolOptions & { allowed_domains_text?: string }
}

/** The node's provider: saved explicitly, or (for flows made before providers existed) from the model. */
export function nodeProvider(data: ModelNodeData): ProviderId {
    return data.provider || findModel(data.model)?.provider || 'openai'
}

/** The node's model, or the provider's default. */
export function nodeModel(data: ModelNodeData): string {
    return data.model ?? DEFAULT_MODELS[nodeProvider(data)]
}

/** Writes changes to a node, removing keys whose value is undefined. */
function useUpdate(node: AppNode) {
    const updateNode = useFlowStore(state => state.updateNode);
    return (changes: Record<string, unknown>) => {
        const clonedNode = cloneDeep(node) as AppNode<ModelNodeData>;
        for (const [key, value] of Object.entries(changes)) {
            if (value === undefined) unset(clonedNode, `data.${key}`)
            else set(clonedNode, `data.${key}`, value)
        }
        // Drop settings the new model does not accept.
        const info = findModel(clonedNode.data.model)
        if (info && clonedNode.data.reasoning_effort && !info.reasoningEfforts?.includes(clonedNode.data.reasoning_effort)) unset(clonedNode, 'data.reasoning_effort')
        if (info?.maxOutputTokens && (clonedNode.data.max_output_tokens || 0) > info.maxOutputTokens) unset(clonedNode, 'data.max_output_tokens')
        if (clonedNode.data.tier && !(info?.tiers || []).includes(clonedNode.data.tier)) unset(clonedNode, 'data.tier')
        updateNode(clonedNode as AppNode);
    }
}

function ModelNotice({ model, onSwitch }: { model: string, onSwitch: (id: string) => void }) {
    const status = getModelStatus(model)
    if (status.kind == 'ok' || !model) return null

    if (status.kind == 'unknown') {
        return (
            <div className='flex gap-2 items-start text-xs text-muted-foreground bg-accent border border-border rounded-md p-2'>
                <Info className='w-4 h-4 shrink-0' />
                <span>This model is not in the built-in price list, so its cost is shown as unknown.</span>
            </div>
        )
    }

    const switchTarget = status.replacement && findModel(status.replacement) ? status.replacement : undefined
    const retired = status.kind == 'retired'

    return (
        <div className={cn('flex gap-2 items-start text-xs rounded-md p-2 border', retired ? 'text-red-700 bg-red-50 border-red-300 dark:bg-red-950 dark:text-red-200' : 'text-amber-800 bg-amber-50 border-amber-300 dark:bg-amber-950 dark:text-amber-200')}>
            <AlertTriangle className='w-4 h-4 shrink-0' />
            <div className='flex flex-col gap-1'>
                <span>
                    {retired
                        ? <><b>{model}</b> was shut down on {status.shutdownDate}. This node will fail until you choose another model.</>
                        : <><b>{model}</b> will be shut down on {status.shutdownDate}.</>}
                    {status.replacement && !switchTarget ? <> The provider suggests {status.replacement}.</> : null}
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
 * Provider and model picker for AI nodes: built-in models grouped by family, models loaded from the
 * user's account, a custom ID, and a notice for deprecated or shut-down models.
 */
export function ModelSelect({ node }: { node: AppNode }) {
    const { toast } = useToast()
    const accountModels = useSettingStore((s) => s.accountModels)
    const setAccountModels = useSettingStore((s) => s.setAccountModels)
    const update = useUpdate(node)
    const [loadingModels, setLoadingModels] = useState(false)

    const data = node.data as ModelNodeData
    const provider = nodeProvider(data)
    const model = nodeModel(data)
    const modelInfo = findModel(model)
    const builtIn = modelsFor(provider)
    const extraAccountModels = useMemo(() => (accountModels[provider] || []).filter(x => !findModel(x) && !retiredModels[x]), [accountModels, provider])
    const isListedModel = !!modelInfo || !!retiredModels[model] || extraAccountModels.includes(model)
    const [customMode, setCustomMode] = useState(!isListedModel || provider == 'compatible')
    const groups = Array.from(new Set(builtIn.filter(x => x.group != 'Deprecated').map(x => x.group)))

    const setModel = (id: string) => update({ provider, model: id })

    const onProviderChange = (value: string) => {
        const next = value as ProviderId
        const allowed = PROVIDER_TOOLS[next]
        const tools = Object.fromEntries(Object.entries(data.tools || {}).filter(([key]) => allowed.includes(key as keyof ToolOptions) || key == 'allowed_domains_text'))
        setCustomMode(next == 'compatible')
        update({ provider: next, model: DEFAULT_MODELS[next], reasoning_effort: undefined, tier: undefined, tools: Object.keys(tools).length ? tools : undefined })
    }

    const onSelect = (value: string) => {
        if (value == CUSTOM_OPTION) {
            setCustomMode(true)
            return
        }
        setCustomMode(false)
        setModel(value)
    }

    const loadAccountModels = async () => {
        const settings = useSettingStore.getState()
        const key = settings.apiKeys[provider]
        if (!key && provider != 'compatible') {
            toast({ title: `Add your ${PROVIDERS.find(x => x.id == provider)?.label} API key in Settings first`, duration: 3000 })
            return
        }
        setLoadingModels(true)
        try {
            const ids = await listProviderModels(provider, key, settings.compatibleBaseUrl)
            setAccountModels(provider, ids)
            toast({ title: `Loaded ${ids.length} models from your account`, duration: 3000 })
        } catch (error) {
            toast({ title: 'Could not load models', description: (error as Error).message, duration: 4000 })
        } finally {
            setLoadingModels(false)
        }
    }

    return (
        <div className='flex flex-col gap-2'>
            <div className='flex flex-col gap-1'>
                <Label className='text-sm font-semibold' htmlFor="provider">Provider</Label>
                <Select name="provider" value={provider} onValueChange={onProviderChange}>
                    <SelectTrigger id="provider"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {PROVIDERS.map(x => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className='flex flex-col gap-1'>
                <div className='flex items-center'>
                    <Label className='text-sm font-semibold' htmlFor="model">Model</Label>
                    <Button
                        variant='ghost'
                        size='icon'
                        className='h-6 w-6 p-1 ml-auto'
                        toolTip='Load models from your account'
                        aria-label='Load models from your account'
                        disabled={loadingModels}
                        onClick={loadAccountModels}
                    >
                        <RefreshCw className={cn('w-4 h-4', loadingModels && 'animate-spin')} />
                    </Button>
                </div>
                {provider != 'compatible' || extraAccountModels.length ? (
                    <Select name="model" value={customMode ? CUSTOM_OPTION : model} onValueChange={onSelect}>
                        <SelectTrigger id="model">
                            <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                            {groups.map(group => (
                                <SelectGroup key={group}>
                                    <SelectLabel>{group}</SelectLabel>
                                    {builtIn.filter(x => x.group == group).map(x => (
                                        <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>
                                    ))}
                                </SelectGroup>
                            ))}
                            {modelInfo?.group == 'Deprecated' ? (
                                <SelectGroup>
                                    <SelectLabel>Deprecated</SelectLabel>
                                    {builtIn.filter(x => x.group == 'Deprecated').map(x => (
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
                ) : null}
                {customMode ? (
                    <Input
                        name="custom_model"
                        aria-label="Model ID"
                        value={data.model || ''}
                        placeholder={provider == 'compatible' ? 'e.g. llama3.3 or openai/gpt-oss-120b' : 'Model ID'}
                        onChange={(e) => setModel(e.target.value.trim())}
                    />
                ) : modelInfo?.description ? (
                    <p className='text-xs text-muted-foreground'>{modelInfo.description}</p>
                ) : null}
                {provider == 'compatible' ? <p className='text-xs text-muted-foreground'>Uses the server address and key from Settings. Cost is not tracked.</p> : null}
                <ModelNotice model={model} onSwitch={(id) => { setCustomMode(false); setModel(id) }} />
            </div>
        </div>
    )
}

/** Reasoning effort options the node's model accepts. Hidden for models without an effort setting. */
export function ReasoningEffortSelect({ node }: { node: AppNode }) {
    const update = useUpdate(node)
    const data = node.data as ModelNodeData
    const provider = nodeProvider(data)
    const modelInfo = findModel(nodeModel(data))
    // Gemini thinking is left to the model; unknown OpenAI-style models get every option.
    const options = modelInfo ? modelInfo.reasoningEfforts : provider == 'google' ? undefined : ALL_EFFORTS
    if (!options) return null

    return (
        <div className='flex flex-col gap-1'>
            <Label className='text-sm font-semibold flex' htmlFor='reasoning_effort'>{provider == 'anthropic' ? 'Effort' : 'Reasoning Effort'}</Label>
            <Select name='reasoning_effort' value={data.reasoning_effort || DEFAULT_OPTION} onValueChange={(value) => update({ reasoning_effort: value == DEFAULT_OPTION ? undefined : value })}>
                <SelectTrigger id='reasoning_effort'>
                    <SelectValue className='w-full' placeholder="Model default" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={DEFAULT_OPTION}>Model default</SelectItem>
                    {options.map(x => (
                        <SelectItem key={x} value={x}>{x == 'xhigh' ? 'Extra high' : capitalize(x)}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}

const TIER_TEXT: Record<ProcessingTier, string> = {
    standard: 'Standard',
    flex: 'Flex: half price, slower, may be unavailable at busy times',
    fast: 'Fast: about 2.5x faster output, double price',
}

/** Processing tier, shown only when the model offers Flex (OpenAI) or fast mode (Claude). */
export function TierSelect({ node }: { node: AppNode }) {
    const update = useUpdate(node)
    const data = node.data as ModelNodeData
    const tiers = findModel(nodeModel(data))?.tiers || []
    if (!tiers.length) return null
    return (
        <div className='flex flex-col gap-1'>
            <Label className='text-sm font-semibold' htmlFor='tier'>Processing</Label>
            <Select value={data.tier || 'standard'} onValueChange={(value) => update({ tier: value == 'standard' ? undefined : value })}>
                <SelectTrigger id='tier'><SelectValue /></SelectTrigger>
                <SelectContent>
                    {(['standard', ...tiers] as ProcessingTier[]).map(x => <SelectItem key={x} value={x}>{TIER_TEXT[x]}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    )
}

function ToolSwitch({ id, label, help, checked, disabled, onChange }: { id: string, label: string, help?: string, checked: boolean, disabled?: boolean, onChange: (value: boolean) => void }) {
    return (
        <div className='flex items-start justify-between gap-3'>
            <div className='flex flex-col'>
                <Label htmlFor={id} className={cn(disabled && 'opacity-50')}>{label}</Label>
                {help ? <span className='text-xs text-muted-foreground'>{help}</span> : null}
            </div>
            <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        </div>
    )
}

/** Built-in tools the model may use while answering (web search, code execution, MCP servers). */
export function ToolsSection({ node }: { node: AppNode }) {
    const update = useUpdate(node)
    const data = node.data as ModelNodeData
    const provider = nodeProvider(data)
    const available = PROVIDER_TOOLS[provider]
    const tools = data.tools || {}
    if (!available.length) return null

    const setTools = (patch: Partial<NonNullable<ModelNodeData['tools']>>) => {
        const next: Record<string, unknown> = { ...tools, ...patch }
        for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === false) delete next[key]
        update({ tools: Object.keys(next).length ? next : undefined })
    }
    const servers = tools.mcpServers || []
    const setServers = (next: McpServer[]) => setTools({ mcpServers: next.length ? next : undefined })
    const webToolOn = !!tools.webSearch || !!tools.webFetch

    return (
        <details className='rounded-md border border-border p-2 text-sm' open={Object.keys(tools).length > 0}>
            <summary className='cursor-pointer font-semibold'>Tools</summary>
            <div className='flex flex-col gap-3 mt-3'>
                {available.includes('webSearch') ? <>
                    <ToolSwitch id='tool-web-search' label='Web search' help='Search the web and cite sources. Searches cost extra and are not included in the cost shown.' checked={!!tools.webSearch} onChange={(on) => setTools({ webSearch: on ? { allowedDomains: parseList(tools.allowed_domains_text) } : undefined })} />
                    {tools.webSearch ? (
                        <Input
                            aria-label='Only search these sites'
                            value={tools.allowed_domains_text || ''}
                            placeholder='Only these sites (optional): openai.com, python.org'
                            onChange={(e) => setTools({ allowed_domains_text: e.target.value || undefined, webSearch: { ...tools.webSearch, allowedDomains: parseList(e.target.value) } })}
                        />
                    ) : null}
                </> : null}
                {available.includes('webFetch') ? (
                    <ToolSwitch id='tool-web-fetch' label='Read web pages' help='Open URLs that appear in the prompt.' checked={!!tools.webFetch} onChange={(on) => setTools({ webFetch: on || undefined })} />
                ) : null}
                {available.includes('codeExecution') ? (
                    <ToolSwitch
                        id='tool-code'
                        label='Code execution'
                        help={provider == 'anthropic' && webToolOn ? 'Already included with the web tools.' : 'Run code in a sandbox hosted by the provider.'}
                        checked={!!tools.codeExecution}
                        disabled={provider == 'anthropic' && webToolOn}
                        onChange={(on) => setTools({ codeExecution: on || undefined })}
                    />
                ) : null}
                {available.includes('mcpServers') ? (
                    <div className='flex flex-col gap-2'>
                        <div className='flex items-center'>
                            <Label>MCP servers</Label>
                            <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip='Add MCP server' aria-label='Add MCP server' onClick={() => setServers([...servers, { label: '', url: '' }])}>
                                <Plus className='w-4 h-4' />
                            </Button>
                        </div>
                        {servers.length == 0 ? <p className='text-xs text-muted-foreground'>Remote MCP servers the model can call. Calls run without asking for approval.</p> : null}
                        {servers.map((server, index) => (
                            <div key={index} className='flex flex-col gap-1 border border-border rounded-md p-2'>
                                <div className='flex gap-1'>
                                    <Input aria-label='Server name' value={server.label} placeholder='Name, e.g. docs' onChange={(e) => setServers(servers.map((x, i) => i == index ? { ...x, label: e.target.value.replace(/[^\w-]/g, '_') } : x))} />
                                    <Button variant="ghost" size="sm" aria-label='Remove server' className="text-red-500 hover:text-red-700 p-0.5 h-8 w-8 shrink-0" onClick={() => setServers(servers.filter((_, i) => i != index))}>
                                        <Trash className='w-4 h-4' />
                                    </Button>
                                </div>
                                <Input aria-label='Server URL' value={server.url} placeholder='https://example.com/mcp' onChange={(e) => setServers(servers.map((x, i) => i == index ? { ...x, url: e.target.value.trim() } : x))} />
                                <Input aria-label='Access token' type='password' autoComplete='off' value={server.token || ''} placeholder='Access token (optional, saved in the flow)' onChange={(e) => setServers(servers.map((x, i) => i == index ? { ...x, token: e.target.value || undefined } : x))} />
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </details>
    )
}
