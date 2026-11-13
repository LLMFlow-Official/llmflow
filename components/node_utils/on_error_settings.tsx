import { AppNode } from "@/lib/store";
import { OnErrorSettings } from "@/lib/engine";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { useNodeSetter } from "./node_shell";
import { multiSourceTypes } from "./thread_handle";

/** Retry and continue-on-error settings, shown under every node's properties (except Start). */
export default function OnErrorSettingsSection({ node }: { node: AppNode }) {
    const setValue = useNodeSetter(node)
    const settings = (node.data as { on_error?: OnErrorSettings }).on_error || {}
    // Branching nodes can't "continue" because there is no single next step to continue to.
    const canContinue = !multiSourceTypes.includes(node.type)

    const update = (patch: Partial<OnErrorSettings>) => {
        const next = { ...settings, ...patch }
        for (const key of Object.keys(next) as (keyof OnErrorSettings)[]) {
            if (next[key] === undefined || next[key] === false || next[key] === 0) delete next[key]
        }
        setValue('on_error', Object.keys(next).length ? next : undefined)
    }

    const setNumber = (key: 'retries' | 'retry_delay', raw: string, max: number) => {
        const value = parseFloat(raw)
        update({ [key]: Number.isFinite(value) && value > 0 ? Math.min(value, max) : undefined })
    }

    return (
        <details className="mx-3 mt-4 rounded-md border border-border p-2 text-sm" open={!!node.data.on_error}>
            <summary className="cursor-pointer font-semibold">On failure</summary>
            <div className="flex flex-col gap-3 mt-3">
                <div className="flex gap-2">
                    <div className="flex flex-col gap-1 flex-1">
                        <Label htmlFor="retries">Retries</Label>
                        <Input id="retries" type="number" min={0} max={5} value={settings.retries ?? ''} placeholder="0" onChange={(e) => setNumber('retries', e.target.value, 5)} />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                        <Label htmlFor="retry_delay">Wait between (s)</Label>
                        <Input id="retry_delay" type="number" min={0} max={60} step={0.5} value={settings.retry_delay ?? ''} placeholder="2" onChange={(e) => setNumber('retry_delay', e.target.value, 60)} />
                    </div>
                </div>
                {canContinue ? (
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col">
                            <Label htmlFor="continue_on_error">Continue if it still fails</Label>
                            <span className="text-xs text-muted-foreground">The next step runs anyway and can check {`{${node.id}.error}`}, e.g. with a Decision.</span>
                        </div>
                        <Switch id="continue_on_error" checked={!!settings.continue} onCheckedChange={(e) => update({ continue: e })} />
                    </div>
                ) : null}
            </div>
        </details>
    )
}
