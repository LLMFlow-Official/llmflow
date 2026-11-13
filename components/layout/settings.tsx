import { Card } from "../ui/card";
import {
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Bolt, Eye, EyeOff, SquareArrowDownIcon, SquareArrowOutUpRight } from "lucide-react";
import { AppNode, DevMode, useFlowStore, useSettingStore } from "@/lib/store";
import { useShallow } from "zustand/shallow";
import { Switch } from "../ui/switch";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { track } from "@/lib/analytics";
import { nodeMetaDetails } from "@/lib/nodes";
import { FlowEdge, FlowNode, parseFlow, ParsedFlow, riskyNodes, serializeFlow } from "@/lib/flow_file";
import { Edge } from "@xyflow/react";
import ConfirmAlert from "../ui/confirm_alert";

const devModeInputs = {
    testOpenAPI: "Use Test API (no real requests)",
    showTreads: "Show Thread Names",
    showPropData: "Show Node Data"
}

/** Reads a flow file, asks for confirmation when it contains nodes that run code, then loads it. */
export function useFlowImport() {
    const { toast } = useToast()
    const [pending, setPending] = useState<ParsedFlow & { risky: ReturnType<typeof riskyNodes> }>()

    const load = (flow: ParsedFlow) => {
        const { setNodes, setEdges } = useFlowStore.getState();
        setNodes(flow.nodes as unknown as AppNode[])
        setEdges(flow.edges as unknown as Edge[])
        track('import_a_file')
        window.location.reload();
    }

    const open = (text: string) => {
        try {
            const flow = parseFlow(text, nodeMetaDetails.map(x => x.type))
            if (flow.warnings.length) {
                toast({ title: 'Some parts of the flow were fixed', description: flow.warnings.join('\n'), duration: 5000 })
            }
            const risky = riskyNodes(flow.nodes)
            if (risky.length) setPending({ ...flow, risky })
            else load(flow)
        } catch (error) {
            toast({ title: `This flow could not be opened`, description: (error as Error).message, duration: 5000 })
        }
    }

    const confirmDialog = (
        <ConfirmAlert
            open={!!pending}
            title="This flow runs code"
            description={pending ? `${pending.risky.map(x => `"${x.name}" ${x.reason}`).join(', ')} when you press Play. Only open flows from people you trust.` : ''}
            onConfirm={() => pending && load(pending)}
            onCancel={() => setPending(undefined)}
        />
    )

    return { open, confirmDialog }
}

function ApiKeyInput({ id, label, value, onChange, placeholder }: { id: string, label: string, value: string, onChange: (value: string) => void, placeholder?: string }) {
    const [visible, setVisible] = useState(false)
    return (
        <div className="flex flex-col gap-1">
            <Label htmlFor={id}>{label}</Label>
            <div className="flex gap-1">
                <Input
                    id={id}
                    type={visible ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value.trim())}
                />
                <Button type="button" variant="ghost" size="icon" toolTip={visible ? 'Hide key' : 'Show key'} aria-label={visible ? 'Hide key' : 'Show key'} onClick={() => setVisible(x => !x)}>
                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
            </div>
        </div>
    )
}

function SettingSwitch({ id, label, help, checked, onChange }: { id: string, label: string, help?: string, checked: boolean, onChange: (value: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
                <Label htmlFor={id}>{label}</Label>
                {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

export function SettingsDialog() {
    const settings = useSettingStore(useShallow(state => state))
    const [openAIKey, setOpenAIKey] = useState(settings.openAIKey)
    const [rememberKeys, setRememberKeys] = useState(settings.rememberKeys)
    const [analyticsEnabled, setAnalyticsEnabled] = useState(settings.analyticsEnabled)
    const [devMode, setDevMode] = useState<DevMode | undefined>(settings.devMode)

    const reset = () => {
        const s = useSettingStore.getState()
        setOpenAIKey(s.openAIKey)
        setRememberKeys(s.rememberKeys)
        setAnalyticsEnabled(s.analyticsEnabled)
        setDevMode(s.devMode)
    }

    const save = () => {
        const s = useSettingStore.getState()
        s.setRememberKeys(rememberKeys)
        s.setOpenAIKey(openAIKey)
        s.setAnalyticsEnabled(analyticsEnabled)
        const anyDevOption = devMode && Object.values(devMode).some(Boolean)
        s.setDevMode(anyDevOption ? devMode : undefined)
    }

    return (
        <Dialog onOpenChange={(open) => open && reset()}>
            <DialogTrigger asChild>
                <Button toolTip="Settings" size="icon" variant="ghost" aria-label="Settings">
                    <Bolt size={20} />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Settings stay in this browser. API keys are only sent to the AI provider they belong to.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-5 my-2">
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold">API keys</h3>
                        <ApiKeyInput id="openai-key" label="OpenAI" value={openAIKey} onChange={setOpenAIKey} placeholder="sk-…" />
                        <SettingSwitch
                            id="remember-keys"
                            label="Remember keys on this device"
                            help="When off, keys are forgotten when you close or reload the page."
                            checked={rememberKeys}
                            onChange={setRememberKeys}
                        />
                    </section>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold">Privacy</h3>
                        <SettingSwitch
                            id="analytics"
                            label="Share anonymous usage data"
                            help="Which buttons and node types are used. Never prompts, outputs, error messages or keys."
                            checked={analyticsEnabled}
                            onChange={setAnalyticsEnabled}
                        />
                    </section>
                    <section className="flex flex-col gap-3">
                        <SettingSwitch
                            id="dev-mode"
                            label="Developer mode"
                            checked={!!devMode}
                            onChange={(on) => {
                                setDevMode(on ? { testOpenAPI: false, showTreads: false, showPropData: false } : undefined)
                                track('toggle_dev_mode')
                            }}
                        />
                        {devMode ? <div className="flex flex-col gap-3 pl-4 border-l-2 border-border">
                            {Object.entries(devModeInputs).map(([key, label]) => (
                                <SettingSwitch
                                    key={key}
                                    id={key}
                                    label={label}
                                    checked={!!devMode[key as keyof DevMode]}
                                    onChange={(value) => setDevMode({ ...devMode, [key]: value })}
                                />
                            ))}
                        </div> : null}
                    </section>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button onClick={save}>Save changes</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function Settings() {
    const { open, confirmDialog } = useFlowImport()

    const onImport = () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.flow,application/json';
        fileInput.onchange = async (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) open(await file.text())
            fileInput.remove();
        };
        fileInput.click();
    }

    const onExport = () => {
        const { nodes, edges } = useFlowStore.getState();
        const data = serializeFlow(nodes as unknown as FlowNode[], edges as unknown as FlowEdge[]);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LLM_Flow_${new Date().toISOString().slice(0, 10)}.flow`;
        a.click();
        URL.revokeObjectURL(url);
        track('export_a_file')
    }

    return (
        <Card className="absolute top-2 right-2 p-1 flex gap-2 z-50">
            <Button toolTip="Import" size="icon" variant="ghost" aria-label="Import a flow file" onClick={onImport}>
                <SquareArrowDownIcon size={20} />
            </Button>
            <Button toolTip="Export" size="icon" variant="ghost" aria-label="Export this flow" onClick={onExport}>
                <SquareArrowOutUpRight size={20} />
            </Button>
            <SettingsDialog />
            {confirmDialog}
        </Card>
    );
}
