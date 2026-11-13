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
import { Eye, EyeOff, Settings as SettingsIcon } from "lucide-react";
import ThemeToggle from "./theme_toggle";
import { DevMode, useSettingStore } from "@/lib/store";
import { Switch } from "../ui/switch";
import { useState } from "react";
import { create } from "zustand";
import { track } from "@/lib/analytics";
import { PROVIDERS } from "@/lib/openai/models";

const devModeInputs = {
    testOpenAPI: "Use Test API (no real requests)",
    showTreads: "Show Thread Names",
    showPropData: "Show Node Data"
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

/** Lets other parts of the app open Settings, e.g. "Open Settings" on a missing-key error. */
export const useSettingsDialog = create<{ open: boolean }>()(() => ({ open: false }))
export const openSettings = () => useSettingsDialog.setState({ open: true })

export function SettingsDialog() {
    const open = useSettingsDialog(s => s.open)
    const [form, setForm] = useState(() => snapshot())
    // Load the current values each time the dialog opens (also when opened from elsewhere).
    const [wasOpen, setWasOpen] = useState(open)
    if (open != wasOpen) {
        setWasOpen(open)
        if (open) setForm(snapshot())
    }
    const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => setForm(f => ({ ...f, [key]: value }))

    const save = () => {
        const s = useSettingStore.getState()
        s.setRememberKeys(form.rememberKeys)
        for (const provider of PROVIDERS) s.setApiKey(provider.id, form.apiKeys[provider.id])
        s.setSettings({
            compatibleBaseUrl: form.compatibleBaseUrl.trim(),
            analyticsEnabled: form.analyticsEnabled,
            maxParallelRequests: Math.min(Math.max(form.maxParallelRequests || 4, 1), 20),
            requestTimeoutSeconds: Math.min(Math.max(form.requestTimeoutSeconds || 600, 10), 3600),
        })
        const anyDevOption = form.devMode && Object.values(form.devMode).some(Boolean)
        s.setDevMode(anyDevOption ? form.devMode : undefined)
    }

    return (
        // Changes are kept however the dialog is closed (Done, the X, Escape or a click outside),
        // so a pasted key is never lost.
        <Dialog open={open} onOpenChange={(next) => { if (!next) save(); useSettingsDialog.setState({ open: next }) }}>
            <DialogTrigger asChild>
                <Button toolTip="Settings" size="icon" variant="ghost" aria-label="Settings">
                    <SettingsIcon size={18} />
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
                        {PROVIDERS.filter(x => x.id != 'compatible').map(provider => (
                            <ApiKeyInput
                                key={provider.id}
                                id={`${provider.id}-key`}
                                label={provider.label}
                                value={form.apiKeys[provider.id]}
                                placeholder={provider.keyPlaceholder}
                                onChange={(value) => set('apiKeys', { ...form.apiKeys, [provider.id]: value })}
                            />
                        ))}
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="compatible-url">OpenAI-compatible server</Label>
                            <Input
                                id="compatible-url"
                                value={form.compatibleBaseUrl}
                                placeholder="e.g. http://localhost:11434/v1 (Ollama) or https://openrouter.ai/api/v1"
                                onChange={(e) => set('compatibleBaseUrl', e.target.value)}
                            />
                        </div>
                        <ApiKeyInput id="compatible-key" label="Server API key (optional)" value={form.apiKeys.compatible} onChange={(value) => set('apiKeys', { ...form.apiKeys, compatible: value })} />
                        <SettingSwitch
                            id="remember-keys"
                            label="Remember keys on this device"
                            help="When off, keys are forgotten when you close or reload the page."
                            checked={form.rememberKeys}
                            onChange={(value) => set('rememberKeys', value)}
                        />
                    </section>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold">Running flows</h3>
                        <div className="flex gap-3">
                            <div className="flex flex-col gap-1 flex-1">
                                <Label htmlFor="parallel">AI requests at the same time</Label>
                                <Input id="parallel" type="number" min={1} max={20} value={form.maxParallelRequests} onChange={(e) => set('maxParallelRequests', parseInt(e.target.value, 10) || 0)} />
                            </div>
                            <div className="flex flex-col gap-1 flex-1">
                                <Label htmlFor="timeout">Request time limit (s)</Label>
                                <Input id="timeout" type="number" min={10} max={3600} value={form.requestTimeoutSeconds} onChange={(e) => set('requestTimeoutSeconds', parseInt(e.target.value, 10) || 0)} />
                            </div>
                        </div>
                        <span className="text-xs text-muted-foreground">Extra requests wait their turn. Rate-limit and server errors are retried twice.</span>
                    </section>
                    <section className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold">Privacy</h3>
                        <SettingSwitch
                            id="analytics"
                            label="Share anonymous usage data"
                            help="Which buttons and node types are used. Never prompts, outputs, error messages or keys."
                            checked={form.analyticsEnabled}
                            onChange={(value) => set('analyticsEnabled', value)}
                        />
                    </section>
                    <section className="flex flex-col gap-3">
                        <SettingSwitch
                            id="dev-mode"
                            label="Developer mode"
                            checked={!!form.devMode}
                            onChange={(on) => {
                                set('devMode', on ? { testOpenAPI: false, showTreads: false, showPropData: false } : undefined)
                                track('toggle_dev_mode')
                            }}
                        />
                        {form.devMode ? <div className="flex flex-col gap-3 pl-4 border-l-2 border-border">
                            {Object.entries(devModeInputs).map(([key, label]) => (
                                <SettingSwitch
                                    key={key}
                                    id={key}
                                    label={label}
                                    checked={!!form.devMode![key as keyof DevMode]}
                                    onChange={(value) => set('devMode', { ...form.devMode!, [key]: value })}
                                />
                            ))}
                        </div> : null}
                    </section>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Done</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

type SettingsForm = ReturnType<typeof snapshot>

function snapshot() {
    const s = useSettingStore.getState()
    return {
        apiKeys: { ...s.apiKeys },
        compatibleBaseUrl: s.compatibleBaseUrl,
        rememberKeys: s.rememberKeys,
        analyticsEnabled: s.analyticsEnabled,
        maxParallelRequests: s.maxParallelRequests,
        requestTimeoutSeconds: s.requestTimeoutSeconds,
        devMode: s.devMode,
    }
}

export default function Settings() {
    return (
        <Card className="p-1 flex gap-1 pointer-events-auto ml-auto">
            <ThemeToggle />
            <SettingsDialog />
        </Card>
    );
}
