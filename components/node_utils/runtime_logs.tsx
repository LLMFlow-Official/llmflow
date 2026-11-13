import { AppNode, FinalOutput, NodeLogs, useFlowStore, useRuntimeStore, useSettingStore } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader } from "../ui/card"
import { useEffect, useMemo, useRef } from "react";
import { getNodeDetails, NodeLogView } from "@/lib/nodes";
import { CheckCircle2, Copy, Crosshair, Download, Flag, Loader2, MessageCircleQuestion, Square, XCircle } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "@/hooks/use-toast";
import MarkdownViewer from "../ui/markdown_viewer";
import StreamingCards from "./streaming_cards";
import { useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/shallow";
import { Badge } from "../ui/badge";
import { Stats, StatsProps } from "./stats";
import { capitalize } from "lodash";
import { MOD_KEY } from "@/lib/utils";
import { selectStepKeepingTab } from "./panel_tab";

export function FinalOutputCards({ outputs }: { outputs: FinalOutput[] }) {
    const download = (output: FinalOutput) => {
        const url = URL.createObjectURL(new Blob([output.value], { type: 'text/markdown' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `${output.name.replace(/[^\w-]+/g, '_') || 'result'}.md`
        a.click()
        URL.revokeObjectURL(url)
    }
    const copy = (output: FinalOutput) => navigator.clipboard.writeText(output.value)
        .then(() => toast({ title: 'Copied', duration: 1500 }))
        .catch(() => toast({ title: "Couldn't copy", description: 'Your browser blocked the clipboard.', variant: 'destructive' }))
    return <>
        {outputs.map((x) => (
            <Card key={x.nodeId} className="border-2 border-success">
                <CardHeader className="p-3 pb-2 flex flex-row items-center gap-2 space-y-0">
                    <div className="flex items-center gap-2 text-sm font-bold text-success min-w-0"><Flag size={16} aria-hidden /> <span className="truncate">{x.name}</span></div>
                    <div className="ml-auto flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => copy(x)}><Copy size={12} aria-hidden /> Copy</Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => download(x)}><Download size={12} aria-hidden /> Download</Button>
                    </div>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                    <MarkdownViewer text={x.value} size="large" />
                </CardContent>
            </Card>
        ))}
    </>
}

/** How the run is going or how it ended, in one line at the top of the log. Announced to screen readers. */
export function RunSummaryBanner() {
    const { isRunning, waiting, lastRun, hasOutputs } = useRuntimeStore(useShallow(s => ({ isRunning: s.isRunning, waiting: s.pendingInputs.length > 0, lastRun: s.lastRun, hasOutputs: s.finalOutputs.length > 0 })))
    const nodes = useFlowStore(s => s.nodes)
    const { fitView } = useReactFlow()
    const nameOf = (id: string) => {
        const node = nodes.find(n => n.id == id)
        return node ? ((node.data.name as string) || getNodeDetails(node.type).name) : id
    }
    const show = (id: string) => { fitView({ nodes: [{ id }], maxZoom: 1.5, duration: 300 }); selectStepKeepingTab(id) }

    let content: React.ReactNode = null
    let tone = 'border-border bg-muted/50'
    if (isRunning) {
        content = waiting
            ? <><MessageCircleQuestion size={16} className="text-info shrink-0" aria-hidden /> Waiting for your answer</>
            : <><Loader2 size={16} className="motion-safe:animate-spin text-running shrink-0" aria-hidden /> Running…</>
    } else if (lastRun?.status == 'completed') {
        tone = 'border-success/40 bg-success/10'
        content = <><CheckCircle2 size={16} className="text-success shrink-0" aria-hidden /> Completed{hasOutputs ? '. The result is below.' : '.'}</>
    } else if (lastRun?.status == 'stopped') {
        content = <><Square size={14} className="text-muted-foreground shrink-0" aria-hidden /> Stopped. Steps that had not finished were skipped.</>
    } else if (lastRun?.status == 'failed') {
        tone = 'border-danger/40 bg-danger/10'
        const first = lastRun.errors[0]
        content = <>
            <XCircle size={16} className="text-danger shrink-0" aria-hidden />
            <span>Failed at{' '}
                <button className="underline font-semibold" onClick={() => show(first.nodeId)}>{nameOf(first.nodeId)}</button>
                {lastRun.errors.length > 1 ? ` and ${lastRun.errors.length - 1} more` : ''}. See the red entries below.
            </span>
        </>
    }
    return (
        <div role="status" aria-live="polite" className="empty:hidden">
            {content ? <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${tone}`}>{content}</div> : null}
        </div>
    )
}

/** Log entries of a run (live or from history). */
export function LogCards({ logs }: { logs: NodeLogs[] }) {
    const nodes = useFlowStore((state) => state.nodes)
    const devMode = useSettingStore((state) => !!state.devMode)
    const { fitView } = useReactFlow()

    const logsWithDetails = useMemo(() => logs.map(x => ({
        ...x,
        node: nodes.find(y => y.id == x.id),
        details: getNodeDetails(x.nodeType)
    })), [logs, nodes]);

    // Centres and selects the step but keeps the log open (the Step tab shows its settings).
    const focusNode = (node: AppNode) => {
        fitView({ nodes: [node], maxZoom: 1.5, duration: 300 })
        selectStepKeepingTab(node.id)
    }

    return <>
        {logsWithDetails.map((x, index) => {
            const NodeLogViewComponent = x.details.logView as NodeLogView
            return (
                <Card key={index}>
                    <CardHeader className="p-3">
                        <div className="flex flex-row items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold wrap-break-word w-full">{x.id == 'start' ? "Start" : (x.node?.data.name as string) || x.details.name}</div>
                                {x.id != 'start' && devMode ? <CardDescription className="text-xs truncate font-mono">{x.id}</CardDescription> : null}
                            </div>
                            {x.type != 'info' ? <Badge size="small" variant={x.type} className="ml-auto">{capitalize(x.type)}</Badge> : null}
                            {x.node ? (
                                <button aria-label="Show this step on the canvas" title="Show this step on the canvas" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => focusNode(x.node as AppNode)}>
                                    <Crosshair size={16} />
                                </button>
                            ) : null}
                        </div>
                        <CardDescription className="text-xs mt-2 text-foreground whitespace-pre-wrap">{x.title}</CardDescription>
                    </CardHeader>
                    {x.payload ? <CardContent className="p-3 pt-0">
                        {x.details.logView ? <NodeLogViewComponent node={x.node} payload={x.payload} /> : (
                            <div className='bg-accent p-2 text-xs rounded-md whitespace-pre-wrap max-h-28 overflow-y-auto relative border border-border'>
                                {typeof x.payload == 'string' ? x.payload : JSON.stringify(x.payload)}
                            </div>
                        )}
                    </CardContent> : null}
                </Card>
            )
        })}
    </>
}

/** A run's totals, final outputs and logs, with the totals pinned at the top. */
export function RunView({ stats, logs, finalOutputs, live, current, emptyText }: { stats: StatsProps, logs: NodeLogs[], finalOutputs: FinalOutput[], live?: boolean, current?: boolean, emptyText?: string }) {
    const scroller = useRef<HTMLDivElement>(null)
    // Follow new entries while running, unless the user scrolled up to read.
    useEffect(() => {
        const el = scroller.current
        if (!el || !live) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }, [logs.length, live])
    // When the run ends, show the result (it is at the top).
    const hasOutputs = finalOutputs.length > 0
    useEffect(() => {
        if (!live && hasOutputs && current) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }, [live, hasOutputs, current])
    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="border-b border-border px-3 pb-2 flex flex-col gap-2">
                {current ? <RunSummaryBanner /> : null}
                <Stats {...stats} testNotice />
            </div>
            <div ref={scroller} className="flex-1 overflow-y-auto py-3 px-3 space-y-3">
                <FinalOutputCards outputs={finalOutputs} />
                {logs.length === 0 && !live ? (
                    <div className="text-center text-xs text-muted-foreground py-10">{emptyText || 'No logs.'}</div>
                ) : <LogCards logs={logs} />}
                {live ? <StreamingCards /> : null}
            </div>
        </div>
    )
}

/** The log of the current (or last) run. */
export default function RuntimeLogs() {
    const state = useRuntimeStore(useShallow((s) => ({
        isRunning: s.isRunning,
        finalOutputs: s.finalOutputs,
        logs: s.logs,
        startTime: s.startTime,
        endTime: s.endTime,
        inToken: s.inToken,
        outToken: s.outToken,
        amount: s.amount,
        costIncomplete: s.costIncomplete
    })))

    return (
        <RunView
            current
            live={state.isRunning}
            logs={state.logs}
            finalOutputs={state.finalOutputs}
            stats={{ startTime: state.startTime, endTime: state.endTime, inToken: state.inToken, outToken: state.outToken, amount: state.amount, costIncomplete: state.costIncomplete }}
            emptyText={`Press Run (${MOD_KEY}+Enter) to see what each step does here.`}
        />
    )
}
