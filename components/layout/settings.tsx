import { useState } from "react";
import { create } from "zustand";
import { Check, ExternalLink, Eye, EyeOff, FlaskConical, Loader2, Settings as SettingsIcon, X } from "lucide-react";
import { Card } from "../ui/card";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "../ui/dialog";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import ThemeToggle from "./theme_toggle";
import { ShortcutsButton } from "./shortcuts";
import { sampleAnswersOn, useSettingStore } from "@/lib/store";
import { track } from "@/lib/analytics";
import { ProviderId, PROVIDERS } from "@/lib/openai/models";
import { listProviderModels } from "@/lib/providers/list_models";

/** Where each provider hands out API keys. */
const KEY_PAGES: Partial<Record<ProviderId, string>> = {
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    google: 'https://aistudio.google.com/apikey',
}

/** Lets other parts of the app open Settings, e.g. "Open Settings" on a missing-key error. */
export const useSettingsDialog = create<{ open: boolean }>()(() => ({ open: false }))
export const openSettings = () => useSettingsDialog.setState({ open: true })

type TestState = { state: 'idle' | 'testing' | 'ok' | 'error', message?: string }

/** Checks a key by asking the provider for its model list (nothing is generated, nothing is charged). */
function TestKeyButton({ provider }: { provider: ProviderId }) {
    const [test, setTest] = useState<TestState>({ state: 'idle' })
    const run = async () => {
        const { apiKeys, compatibleBaseUrl } = useSettingStore.getState()
        setTest({ state: 'testing' })
        try {
            const models = await listProviderModels(provider, apiKeys[provider], compatibleBaseUrl)
            setTest({ state: 'ok', message: `Works (${models.length} models)` })
        } catch (error) {
            setTest({ state: 'error', message: (error as Error).message })
        }
    }
    return (
        <div className="flex items-center gap-2 min-w-0">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={test.state == 'testing'} onClick={run}>
                {test.state == 'testing' ? <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden /> : null} Test
            </Button>
            <span role="status" className="min-w-0">
                {test.state == 'ok' ? <span className="text-xs text-success flex items-center gap-1"><Check size={12} aria-hidden /> {test.message}</span> : null}
                {test.state == 'error' ? <span className="text-xs text-danger flex items-center gap-1 min-w-0" title={test.message}><X size={12} aria-hidden className="shrink-0" /> <span className="truncate">{test.message}</span></span> : null}
            </span>
        </div>
    )
}

function ApiKeyInput({ provider, id, label, placeholder }: { provider: ProviderId, id: string, label: string, placeholder?: string }) {
    const value = useSettingStore(s => s.apiKeys[provider])
    const [visible, setVisible] = useState(false)
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <Label htmlFor={id}>{label}</Label>
                {KEY_PAGES[provider] ? (
                    <a href={KEY_PAGES[provider]} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-info underline flex items-center gap-1">
                        Get a key <ExternalLink size={11} aria-hidden />
                    </a>
                ) : null}
            </div>
            <div className="flex gap-1">
                <Input
                    id={id}
                    type={visible ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => useSettingStore.getState().setApiKey(provider, e.target.value.trim())}
                />
                <Button type="button" variant="ghost" size="icon" toolTip={visible ? 'Hide key' : 'Show key'} aria-label={visible ? 'Hide key' : 'Show key'} onClick={() => setVisible(x => !x)}>
                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
            </div>
            {value || provider == 'compatible' ? <TestKeyButton provider={provider} /> : null}
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

/** A number setting, checked and saved when the field is left. */
function NumberSetting({ id, label, value, min, max, onSave }: { id: string, label: string, value: number, min: number, max: number, onSave: (value: number) => void }) {
    const [draft, setDraft] = useState(String(value))
    const parsed = parseInt(draft, 10)
    const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max
    return (
        <div className="flex flex-col gap-1 flex-1">
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} type="number" min={min} max={max} value={draft} aria-invalid={!valid}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (valid) onSave(parsed); else setDraft(String(value)) }}
            />
            {!valid ? <span className="text-xs text-danger">Use a number from {min} to {max}.</span> : null}
        </div>
    )
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {children}
        </section>
    )
}

export function SettingsDialog() {
    const open = useSettingsDialog(s => s.open)
    const s = useSettingStore()
    const devMode = s.devMode
    const setDev = (key: 'showTreads' | 'showPropData', value: boolean) => {
        const next = { showTreads: false, showPropData: false, ...devMode, [key]: value }
        s.setDevMode(next.showTreads || next.showPropData ? next : undefined)
        track('toggle_dev_mode')
    }

    return (
        <Dialog open={open} onOpenChange={(next) => useSettingsDialog.setState({ open: next })}>
            <DialogTrigger asChild>
                <Button toolTip="Settings" size="icon" variant="ghost" aria-label="Settings">
                    <SettingsIcon size={18} />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Changes are saved as you make them. Settings stay in this browser; API keys are only sent to the AI provider they belong to.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 my-2">
                    <Section title="Try without a key">
                        <SettingSwitch
                            id="sample-answers"
                            label="Sample answers"
                            help="Steps return a sample answer instead of calling a model, so you can try flows for free. Turn it off to use your API keys."
                            checked={s.sampleAnswers}
                            onChange={(value) => { s.setSettings({ sampleAnswers: value }); track('toggle_sample_answers') }}
                        />
                    </Section>
                    <Section title="API keys">
                        {PROVIDERS.filter(x => x.id != 'compatible').map(provider => (
                            <ApiKeyInput key={provider.id} provider={provider.id} id={`${provider.id}-key`} label={provider.label} placeholder={provider.keyPlaceholder} />
                        ))}
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="compatible-url">Your own server (OpenAI-compatible)</Label>
                            <Input
                                id="compatible-url"
                                value={s.compatibleBaseUrl}
                                placeholder="e.g. http://localhost:11434/v1 (Ollama) or https://openrouter.ai/api/v1"
                                onChange={(e) => s.setSettings({ compatibleBaseUrl: e.target.value.trim() })}
                            />
                        </div>
                        {s.compatibleBaseUrl ? <ApiKeyInput provider="compatible" id="compatible-key" label="Server API key (optional)" /> : null}
                        <SettingSwitch
                            id="remember-keys"
                            label="Remember keys on this device"
                            help="On: keys are stored in this browser (not encrypted) so they are there next time. Off: they are forgotten when you close or reload the page."
                            checked={s.rememberKeys}
                            onChange={(value) => s.setRememberKeys(value)}
                        />
                    </Section>
                    <Section title="Running flows">
                        <div className="flex gap-3">
                            <NumberSetting id="parallel" label="AI requests at the same time" value={s.maxParallelRequests} min={1} max={20} onSave={(v) => s.setSettings({ maxParallelRequests: v })} />
                            <NumberSetting id="timeout" label="Request time limit (s)" value={s.requestTimeoutSeconds} min={10} max={3600} onSave={(v) => s.setSettings({ requestTimeoutSeconds: v })} />
                        </div>
                        <span className="text-xs text-muted-foreground">Extra requests wait their turn. Rate-limit and server errors are retried twice.</span>
                    </Section>
                    <Section title="Appearance">
                        <div className="flex items-center justify-between gap-4">
                            <Label htmlFor="theme">Theme</Label>
                            <Select value={s.theme} onValueChange={(value) => s.setSettings({ theme: value as typeof s.theme })}>
                                <SelectTrigger id="theme" className="w-48"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="system">Same as this device</SelectItem>
                                    <SelectItem value="light">Light</SelectItem>
                                    <SelectItem value="dark">Dark</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </Section>
                    <Section title="Privacy">
                        <SettingSwitch
                            id="analytics"
                            label="Share anonymous usage data"
                            help="Which buttons and step types are used, to improve the app. Never prompts, outputs, error messages or keys."
                            checked={s.analyticsEnabled}
                            onChange={(value) => s.setSettings({ analyticsEnabled: value, analyticsAsked: true })}
                        />
                    </Section>
                    <Section title="Developer">
                        <SettingSwitch id="show-ids" label="Show step ids and branch threads" help="On the canvas, in step settings and in the run log." checked={!!devMode?.showTreads} onChange={(v) => setDev('showTreads', v)} />
                        <SettingSwitch id="show-data" label="Show raw step data" help="The stored settings of the selected step, as JSON." checked={!!devMode?.showPropData} onChange={(v) => setDev('showPropData', v)} />
                    </Section>
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

export default function Settings() {
    const sampleAnswers = useSettingStore(sampleAnswersOn)
    return (
        <Card className="p-1 flex items-center gap-1 pointer-events-auto ml-auto">
            {sampleAnswers ? (
                // Always visible while on, so nobody mistakes sample answers for real ones.
                <Button variant="ghost" size="sm" className="h-8 px-2 gap-1 text-xs font-semibold text-warning hover:text-warning" toolTip="Steps return sample answers instead of calling a model. Click to change." onClick={openSettings}>
                    <FlaskConical size={14} aria-hidden /> <span className="hidden @2xl:inline">Sample answers</span><span className="sr-only @2xl:hidden">Sample answers are on</span>
                </Button>
            ) : null}
            <ShortcutsButton />
            <ThemeToggle />
            <SettingsDialog />
        </Card>
    );
}
