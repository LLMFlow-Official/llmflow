import { useMemo, useRef, useState } from "react";
import { Download, Play, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useFlowStore, useRuntimeStore } from "@/lib/store";
import { useLibraryStore } from "@/lib/library";
import { runInEditor, startInputs } from "@/lib/run_flow";
import { csvToRecords, toCsv } from "@/lib/csv";
import { CheckKind, CheckResult, simpleCheck } from "@/lib/evals";
import { runStatement } from "@/lib/logics";
import { track } from "@/lib/analytics";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type Saved = { csv: string, check: CheckKind, expression?: string, output?: string }
type Result = { index: number, status: string, output: string, check: CheckResult, cost: number, seconds: number }

const storageKey = (flowId?: string) => `llmflow-tests-${flowId}`
const EXPECTED = 'expected'

function load(flowId?: string): Saved {
    try { return { check: 'contains', ...JSON.parse(localStorage.getItem(storageKey(flowId)) || '{}') } } catch { return { csv: '', check: 'contains' } }
}

/** Runs the flow once per CSV row and checks each result. */
export default function TestCasesDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const { toast } = useToast()
    const flowId = useLibraryStore(s => s.currentId)
    const nodes = useFlowStore(s => s.nodes)
    const [saved, setSaved] = useState<Saved>(() => load(flowId))
    const [results, setResults] = useState<Result[]>([])
    const [progress, setProgress] = useState<{ done: number, total: number }>()
    const cancelled = useRef(false)

    // Reload the saved cases (and clear old results) each time the dialog opens or the flow changes.
    const [openedFor, setOpenedFor] = useState<string | undefined>(open ? flowId : undefined)
    const openKey = open ? flowId : undefined
    if (openKey !== openedFor) {
        setOpenedFor(openKey)
        if (open) { setSaved(load(flowId)); setResults([]) }
    }
    const update = (patch: Partial<Saved>) => setSaved(s => {
        const next = { ...s, ...patch }
        try { localStorage.setItem(storageKey(flowId), JSON.stringify(next)) } catch { /* ignore */ }
        return next
    })

    const inputs = useMemo(() => startInputs(nodes), [nodes])
    const finalNames = useMemo(() => nodes.filter(n => n.type == 'final_output').map(n => (n.data.name as string) || 'Final Output'), [nodes])
    const { columns, records } = useMemo(() => csvToRecords(saved.csv || ''), [saved.csv])
    const used = columns.filter(c => inputs.includes(c))
    const unknown = columns.filter(c => !inputs.includes(c) && c.toLowerCase() != EXPECTED)
    const hasExpected = columns.some(c => c.toLowerCase() == EXPECTED)
    const outputName = saved.output && finalNames.includes(saved.output) ? saved.output : finalNames[0]

    const check = async (output: string, row: Record<string, string>): Promise<CheckResult> => {
        const expected = row[columns.find(c => c.toLowerCase() == EXPECTED) || ''] || ''
        if (saved.check == 'expression') {
            if (!saved.expression?.trim()) return { passed: null }
            try {
                return { passed: !!(await runStatement(saved.expression, { test: { output, expected, row } } as never)) }
            } catch (error) {
                return { passed: false, detail: (error as Error).message }
            }
        }
        if (saved.check != 'none' && !hasExpected) return { passed: null, detail: 'No "expected" column' }
        return simpleCheck(saved.check, output, expected)
    }

    const hasHumanInput = useFlowStore(st => st.nodes.some(n => n.type == 'human_input'))

    const runAll = async () => {
        if (!records.length) return
        cancelled.current = false
        setResults([])
        track('test_cases_run', { rows: records.length })
        for (let i = 0; i < records.length; i++) {
            if (cancelled.current) break
            setProgress({ done: i, total: records.length })
            const row = records[i]
            let reason = ''
            const summary = await runInEditor({
                startValues: Object.fromEntries(used.map(c => [c, row[c]])),
                // Remember why the flow could not start; errors of single rows are shown in the table.
                notify: (title, description) => { if (!reason) reason = description || title },
                saveHistory: false,
            })
            if (!summary) {
                toast({ title: 'The flow could not start', description: reason || 'Fix the flow and try again.', variant: 'destructive' })
                break
            }
            const output = summary.finalOutputs.find(f => f.name == outputName)?.value ?? summary.finalOutputs[0]?.value ?? ''
            const result: Result = {
                index: i + 1,
                status: summary.status,
                output,
                check: summary.status == 'completed' ? await check(output, row) : { passed: false, detail: summary.errors[0]?.message || summary.status },
                cost: summary.cost,
                seconds: (summary.endedAt - summary.startedAt) / 1000,
            }
            setResults(r => [...r, result])
            if (summary.status == 'stopped') break
        }
        setProgress(undefined)
    }

    const stop = () => {
        cancelled.current = true
        useRuntimeStore.getState().stop()
    }

    const download = () => {
        const rows = [[...columns, 'output', 'passed', 'note', 'cost_usd', 'seconds'], ...results.map(r => [
            ...columns.map(c => records[r.index - 1][c]), r.output, r.check.passed === null ? '' : r.check.passed ? 'yes' : 'no', r.check.detail || '', r.cost.toFixed(6), r.seconds.toFixed(1),
        ])]
        const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }))
        const a = document.createElement('a')
        a.href = url
        a.download = 'test_results.csv'
        a.click()
        URL.revokeObjectURL(url)
    }

    const chooseFile = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,text/csv'
        input.onchange = async () => { const f = input.files?.[0]; if (f) update({ csv: await f.text() }) }
        input.click()
    }

    const passed = results.filter(r => r.check.passed === true).length
    const checked = results.filter(r => r.check.passed !== null).length
    const totalCost = results.reduce((s, r) => s + r.cost, 0)

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o && progress) stop(); onOpenChange(o) }}>
            <DialogContent className="max-w-(--breakpoint-lg) max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Test cases</DialogTitle>
                    <DialogDescription>
                        Run this flow once per row. Columns named like the Start inputs ({inputs.length ? inputs.join(', ') : 'none yet'}) fill them; an &quot;expected&quot; column is used by the check.
                    </DialogDescription>
                    {hasHumanInput ? <p className="text-xs text-warning">This flow has a Human Input step, which waits for an answer. Test runs can&apos;t answer it, so remove it (or test a copy without it).</p> : null}
                </DialogHeader>
                <div className="flex flex-col gap-1">
                    <div className="flex items-center">
                        <Label htmlFor="tests-csv">Test cases (CSV with a header row)</Label>
                        <Button variant="link" size="sm" className="ml-auto h-6" onClick={chooseFile}>Choose CSV file…</Button>
                    </div>
                    <textarea
                        id="tests-csv"
                        className="min-h-[110px] rounded-md border border-input bg-background p-2 text-xs font-mono"
                        placeholder={`${inputs[0] || 'topic'},expected\ncats,meow\ndogs,woof`}
                        value={saved.csv}
                        onChange={(e) => update({ csv: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">
                        {records.length} row{records.length == 1 ? '' : 's'}.
                        {used.length ? ` Inputs: ${used.join(', ')}.` : ' No column matches a Start input.'}
                        {unknown.length ? ` Ignored columns: ${unknown.join(', ')}.` : ''}
                    </span>
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                    {finalNames.length > 1 ? (
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="test-output">Output to check</Label>
                            <Select value={outputName} onValueChange={(v) => update({ output: v })}>
                                <SelectTrigger id="test-output" className="w-48"><SelectValue /></SelectTrigger>
                                <SelectContent>{finalNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    ) : null}
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="test-check">Check</Label>
                        <Select value={saved.check} onValueChange={(v) => update({ check: v as CheckKind })}>
                            <SelectTrigger id="test-check" className="w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="contains">Output contains expected</SelectItem>
                                <SelectItem value="equals">Output equals expected</SelectItem>
                                <SelectItem value="regex">Output matches pattern (regex)</SelectItem>
                                <SelectItem value="expression">JavaScript check</SelectItem>
                                <SelectItem value="none">No check, just run</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {saved.check == 'expression' ? (
                        <div className="flex flex-col gap-1 flex-1 min-w-[16rem]">
                            <Label htmlFor="tests-expr">Expression</Label>
                            <Input id="tests-expr" className="font-mono text-xs" value={saved.expression || ''} placeholder="test.output.length < 200 && test.output.includes(test.row.topic)" onChange={(e) => update({ expression: e.target.value })} />
                        </div>
                    ) : null}
                    <div className="ml-auto flex gap-2">
                        {progress ? (
                            <Button variant="destructive" onClick={stop}><Square size={14} className="mr-1" /> Stop</Button>
                        ) : (
                            <Button onClick={runAll} disabled={!records.length || !finalNames.length}><Play size={14} className="mr-1" /> Run {records.length || ''} test{records.length == 1 ? '' : 's'}</Button>
                        )}
                        <Button variant="outline" onClick={download} disabled={!results.length} aria-label="Download results"><Download size={14} /></Button>
                    </div>
                </div>
                {!finalNames.length ? <p className="text-xs text-warning">Add a Final Output node to the flow: its value is what each test checks.</p> : null}
                {progress ? <p className="text-sm">Running {progress.done + 1} of {progress.total}…</p> : null}
                {results.length ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-semibold">{checked ? `${passed} of ${checked} passed` : `${results.length} ran`} · ${totalCost.toFixed(6)}</p>
                        <div className="overflow-x-auto border border-border rounded-md">
                            <table className="w-full text-xs">
                                <thead className="bg-muted text-left">
                                    <tr><th className="p-2">#</th><th className="p-2">Inputs</th><th className="p-2">Output</th><th className="p-2">Result</th><th className="p-2">Cost</th><th className="p-2">Time</th></tr>
                                </thead>
                                <tbody>
                                    {results.map(r => (
                                        <tr key={r.index} className="border-t border-border align-top">
                                            <td className="p-2">{r.index}</td>
                                            <td className="p-2 max-w-48">{used.map(c => <div key={c} className="truncate"><b>{c}:</b> {records[r.index - 1][c]}</div>)}</td>
                                            <td className="p-2 max-w-[24rem] whitespace-pre-wrap">{r.output.length > 400 ? `${r.output.slice(0, 400)}…` : r.output}</td>
                                            <td className="p-2">
                                                {r.check.passed === null ? <span className="text-muted-foreground">{r.status}</span> : r.check.passed ? <span className="text-success font-semibold">Pass</span> : <span className="text-danger font-semibold">Fail</span>}
                                                {r.check.detail ? <div className="text-muted-foreground">{r.check.detail}</div> : null}
                                            </td>
                                            <td className="p-2">${r.cost.toFixed(6)}</td>
                                            <td className="p-2">{r.seconds.toFixed(1)}s</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
