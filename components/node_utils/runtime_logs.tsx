import { AppNode, FinalOutput, NodeLogs, useFlowStore, useRuntimeStore } from "@/lib/store"
import { Card, CardContent, CardDescription, CardHeader } from "../ui/card"
import { useMemo } from "react";
import { getNodeDetails, NodeLogView } from "@/lib/nodes";
import { Crosshair, Flag } from "lucide-react";
import MarkdownViewer from "../ui/markdown_viewer";
import StreamingCards from "./streaming_cards";
import { useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/shallow";
import { Badge } from "../ui/badge";
import { Stats, StatsProps } from "./stats";
import { capitalize } from "lodash";
import { MOD_KEY } from "@/lib/utils";

export function FinalOutputCards({ outputs }: { outputs: FinalOutput[] }) {
    return <>
        {outputs.map((x) => (
            <Card key={x.nodeId} className="border-2 border-success">
                <CardHeader className="p-3 pb-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-success"><Flag size={16} aria-hidden /> {x.name}</div>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                    <MarkdownViewer text={x.value} />
                </CardContent>
            </Card>
        ))}
    </>
}

/** Log entries of a run (live or from history). */
export function LogCards({ logs }: { logs: NodeLogs[] }) {
    const { nodes, onNodesChange } = useFlowStore(useShallow((state) => ({ nodes: state.nodes, onNodesChange: state.onNodesChange })))
    const { fitView } = useReactFlow()

    const logsWithDetails = useMemo(() => logs.map(x => ({
        ...x,
        node: nodes.find(y => y.id == x.id),
        details: getNodeDetails(x.nodeType)
    })), [logs, nodes]);

    const focusNode = (node: AppNode) => {
        fitView({ nodes: [node], maxZoom: 1.5, duration: 300 })
        onNodesChange([{ type: 'select', id: node.id, selected: true }])
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
                                {x.id != 'start' ? <CardDescription className="text-xs truncate">{x.id}</CardDescription> : null}
                            </div>
                            {x.type != 'info' ? <Badge size="small" variant={x.type} className="ml-auto">{capitalize(x.type)}</Badge> : null}
                            {x.node ? (
                                <button aria-label="Show this node" title="Show this node" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => focusNode(x.node as AppNode)}>
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
export function RunView({ stats, logs, finalOutputs, live, emptyText }: { stats: StatsProps, logs: NodeLogs[], finalOutputs: FinalOutput[], live?: boolean, emptyText?: string }) {
    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="border-b border-border px-3 pb-2"><Stats {...stats} /></div>
            <div className="flex-1 overflow-y-auto py-3 px-3 space-y-3">
                {live ? <StreamingCards /> : null}
                <FinalOutputCards outputs={finalOutputs} />
                {logs.length === 0 && !live ? (
                    <div className="text-center text-xs text-muted-foreground py-10">{emptyText || 'No logs.'}</div>
                ) : <LogCards logs={logs} />}
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
            live={state.isRunning}
            logs={state.logs}
            finalOutputs={state.finalOutputs}
            stats={{ startTime: state.startTime, endTime: state.endTime, inToken: state.inToken, outToken: state.outToken, amount: state.amount, costIncomplete: state.costIncomplete }}
            emptyText={`Press Run (${MOD_KEY}+Enter) to see what each node does here.`}
        />
    )
}
