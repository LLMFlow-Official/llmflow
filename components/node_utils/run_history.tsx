import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardCopy, GitCompare, History, Play, Trash } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useFlowStore } from "@/lib/store";
import { MOD_KEY } from "@/lib/utils";
import { askToConfirm } from "../ui/confirm_host";
import { requestRun } from "../layout/controllers";
import { useShallow } from "zustand/shallow";
import { deleteRun, RunRecord, runsForFlow, useLibraryStore } from "@/lib/library";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import MarkdownViewer from "../ui/markdown_viewer";
import { RunView } from "./runtime_logs";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const money = (run: RunRecord) => `$${run.cost.toFixed(6)}${run.costIncomplete ? '+' : ''}`
const badge = (status: RunRecord['status']) => status == 'completed' ? 'success' : status == 'failed' ? 'error' : 'warning'

function Compare({ runs, onBack }: { runs: [RunRecord, RunRecord], onBack: () => void }) {
    const names = Array.from(new Set(runs.flatMap(r => r.finalOutputs.map(o => o.name))))
    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-3 pb-2 border-b border-border">
                <Button variant="ghost" size="sm" className="gap-1 -ml-2" onClick={onBack}><ArrowLeft size={14} /> All runs</Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                    {runs.map(r => (
                        <div key={r.id} className="border border-border rounded-md p-2 flex flex-col gap-1">
                            <span className="font-semibold">{when(r.startedAt)}</span>
                            <Badge size="small" variant={badge(r.status)} className="w-fit">{r.status}</Badge>
                            <span>{money(r)} · {(r.durationMs / 1000).toFixed(1)}s</span>
                            <span>{r.inTokens} in · {r.outTokens} out tokens</span>
                            {r.startValues && Object.keys(r.startValues).length ? (
                                <span className="text-muted-foreground whitespace-pre-wrap wrap-break-word">{Object.entries(r.startValues).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join('\n')}</span>
                            ) : null}
                        </div>
                    ))}
                </div>
                {names.length ? names.map(name => (
                    <div key={name} className="flex flex-col gap-1">
                        <span className="text-sm font-semibold">{name}</span>
                        <div className="grid grid-cols-2 gap-2">
                            {runs.map(r => (
                                <div key={r.id} className="border border-border rounded-md p-2 min-w-0">
                                    <MarkdownViewer text={r.finalOutputs.find(o => o.name == name)?.value ?? '(no value)'} />
                                </div>
                            ))}
                        </div>
                    </div>
                )) : <p className="text-xs text-muted-foreground">These runs have no Final Output values to compare. Add a Final Output node to compare results.</p>}
            </div>
        </div>
    )
}

/** Past runs of the open flow, kept in this browser (the last 50). */
/** Puts a past run's inputs into the Start step. */
function copyInputsToStart(values: Record<string, unknown>) {
    const { nodes, updateNode } = useFlowStore.getState()
    const start = nodes.find(n => n.type == 'start')
    if (!start) return
    updateNode({ ...start, data: { ...start.data, propertyValues: { ...((start.data.propertyValues as object) || {}), ...values } } })
}

/** Puts the flow back as it was when this run happened (Undo brings back the current one). */
async function restore(run: RunRecord) {
    if (!run.flow) return
    const yes = await askToConfirm({
        title: 'Restore this version?',
        description: `The flow goes back to how it was on ${when(run.startedAt)}. Undo (${MOD_KEY}+Z) brings back the current version.`,
        confirmLabel: 'Restore',
    })
    if (!yes) return
    useFlowStore.setState({ nodes: run.flow.nodes, edges: run.flow.edges })
    toast({ title: 'Version restored', duration: 2500 })
}

export default function RunHistory() {
    const { currentId, historyRevision } = useLibraryStore(useShallow(s => ({ currentId: s.currentId, historyRevision: s.historyRevision })))
    const [runs, setRuns] = useState<RunRecord[]>([])
    const [open, setOpen] = useState<RunRecord>()
    const [selected, setSelected] = useState<string[]>([])
    const [comparing, setComparing] = useState(false)

    useEffect(() => {
        if (!currentId) return
        let cancelled = false
        runsForFlow(currentId).then(r => { if (!cancelled) setRuns(r) })
        return () => { cancelled = true }
    }, [currentId, historyRevision])

    if (comparing && selected.length == 2) {
        const pair = selected.map(id => runs.find(r => r.id == id)).filter((x): x is RunRecord => !!x)
        if (pair.length == 2) return <Compare runs={pair as [RunRecord, RunRecord]} onBack={() => setComparing(false)} />
    }

    if (open) {
        const inputs = open.startValues && Object.keys(open.startValues).length ? open.startValues : undefined
        return (
            <div className="flex flex-col h-full min-h-0">
                <div className="px-3 border-b border-border flex items-center">
                    <Button variant="ghost" size="sm" className="gap-1 -ml-2" onClick={() => setOpen(undefined)}><ArrowLeft size={14} /> All runs</Button>
                    <span className="ml-auto text-xs text-muted-foreground">{when(open.startedAt)}</span>
                </div>
                <div className="px-3 py-2 border-b border-border flex flex-col gap-2">
                    {inputs ? (
                        <details className="text-xs">
                            <summary className="cursor-pointer font-semibold">Inputs</summary>
                            <div className="mt-1 flex flex-col gap-1">{Object.entries(inputs).map(([k, v]) => <div key={k} className="whitespace-pre-wrap wrap-break-word"><b>{k}:</b> {String(v)}</div>)}</div>
                        </details>
                    ) : null}
                    <div className="flex flex-wrap gap-1">
                        {inputs ? <>
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { copyInputsToStart(inputs); requestRun() }}><Play size={12} /> Run again with these inputs</Button>
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { copyInputsToStart(inputs); toast({ title: 'Inputs copied to Start', duration: 2000 }) }}><ClipboardCopy size={12} /> Copy inputs to Start</Button>
                        </> : null}
                        {open.flow ? <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => restore(open)}><History size={12} /> Restore this version</Button> : null}
                    </div>
                </div>
                <div className="flex-1 min-h-0">
                    <RunView
                        logs={open.logs}
                        finalOutputs={open.finalOutputs}
                        stats={{ startTime: open.startedAt, endTime: open.startedAt + open.durationMs, inToken: open.inTokens, outToken: open.outTokens, amount: open.cost, costIncomplete: open.costIncomplete }}
                    />
                </div>
            </div>
        )
    }

    const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x != id) : [...s.slice(-1), id])
    const remove = async (id: string) => {
        const run = runs.find(r => r.id == id)
        if (!(await askToConfirm({ title: 'Delete this run?', description: `The run from ${run ? when(run.startedAt) : 'this time'} is removed from the history. This cannot be undone.`, confirmLabel: 'Delete run', destructive: true }))) return
        await deleteRun(id)
        setRuns(x => x.filter(y => y.id != id))
        setSelected(s => s.filter(x => x != id))
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-3 pb-2 border-b border-border flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex-1">{runs.length ? 'Tick two runs to compare them.' : ''}</span>
                <Button size="sm" variant="outline" className="gap-1 h-7" disabled={selected.length != 2} onClick={() => setComparing(true)}><GitCompare size={14} /> Compare</Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                {runs.length == 0 ? <p className="text-center text-xs text-muted-foreground py-10">Runs of this flow appear here.</p> : runs.map(r => (
                    <div key={r.id} className="flex items-start gap-2 rounded-md border border-border p-2 hover:bg-muted">
                        <input type="checkbox" aria-label={`Select run from ${when(r.startedAt)}`} className="mt-1" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                        <button className="flex-1 text-left min-w-0" onClick={() => setOpen(r)}>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{when(r.startedAt)}</span>
                                <Badge size="small" variant={badge(r.status)}>{r.status}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">{money(r)} · {(r.durationMs / 1000).toFixed(1)}s · {r.inTokens + r.outTokens} tokens</div>
                            {r.finalOutputs[0] ? <div className="text-xs truncate mt-0.5">{r.finalOutputs[0].value}</div> : null}
                        </button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete this run" onClick={() => remove(r.id)}><Trash size={14} /></Button>
                    </div>
                ))}
            </div>
        </div>
    )
}
