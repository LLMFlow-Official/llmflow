import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { checkFlow, FlowProblem } from "@/lib/flow_check";
import { useFlowProblems } from "./flow_problems_state";

export { useFlowProblems }
import { useFlowStore, useSettingStore } from "@/lib/store";
import { useLibraryStore } from "@/lib/library";
import { availableProviders } from "@/lib/providers";
import { getNodeDetails } from "@/lib/nodes";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { selectStepKeepingTab, showPanelTab } from "./panel_tab";

/** Checks the flow again. Cheap enough to run on every change of the flow, keys or saved flows. */
function recheck() {
    const { nodes, edges } = useFlowStore.getState()
    const usable = availableProviders()
    const problems = checkFlow(nodes, edges, {
        canUse: (provider) => usable.includes(provider),
        savedFlowIds: useLibraryStore.getState().flows.map(f => f.id),
    })
    const byNode: Record<string, FlowProblem[]> = {}
    for (const p of problems) if (p.nodeId) (byNode[p.nodeId] ||= []).push(p)
    useFlowProblems.setState({ problems, byNode, errors: problems.filter(p => p.severity == 'error').length })
}

if (typeof window != 'undefined') {
    let scheduled = false
    const schedule = () => {
        if (scheduled) return
        scheduled = true
        queueMicrotask(() => { scheduled = false; recheck() })
    }
    useFlowStore.subscribe((s, p) => { if (s.nodes !== p.nodes || s.edges !== p.edges) schedule() })
    useSettingStore.subscribe((s, p) => { if (s.apiKeys !== p.apiKeys || s.compatibleBaseUrl !== p.compatibleBaseUrl || s.devMode !== p.devMode) schedule() })
    useLibraryStore.subscribe((s, p) => { if (s.flows !== p.flows) schedule() })
}

/** Errors that would stop the run, checked right before running. */
export function blockingProblems(): FlowProblem[] {
    recheck()
    return useFlowProblems.getState().problems.filter(p => p.severity == 'error')
}

/** "2 problems" next to Run: the list, each problem taking you to its step. */
export function ProblemsButton() {
    const { problems, errors, open } = useFlowProblems()
    const nodes = useFlowStore(s => s.nodes)
    const { fitView } = useReactFlow()
    if (!problems.length) return null
    const warnings = problems.length - errors

    const show = (nodeId?: string) => {
        if (!nodeId) return
        useFlowProblems.setState({ open: false })
        fitView({ nodes: [{ id: nodeId }], maxZoom: 1.2, duration: 300 })
        // Select the step and show its settings, where the problem can be fixed.
        selectStepKeepingTab(nodeId)
        showPanelTab('step')
    }

    const label = errors ? `${errors} ${errors == 1 ? 'problem' : 'problems'}` : `${warnings} ${warnings == 1 ? 'warning' : 'warnings'}`
    return (
        <Popover open={open} onOpenChange={(o) => useFlowProblems.setState({ open: o })}>
            <PopoverTrigger asChild>
                <Button variant="outline" className={cn("h-12 rounded-full gap-2 shadow-lg bg-card", errors ? "text-warning border-warning/60" : "text-muted-foreground")} aria-label={`${label} in this flow`}>
                    <AlertTriangle size={18} aria-hidden /> <span className="hidden sm:inline">{label}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
                <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-semibold">{errors ? 'Fix these before running' : 'Worth a look'}</p>
                    <p className="text-xs text-muted-foreground">{errors ? 'The flow would fail at these steps.' : 'The flow can run, but these may not do what you expect.'}</p>
                </div>
                <ul className="max-h-80 overflow-y-auto py-1">
                    {problems.map((p, i) => {
                        const node = p.nodeId ? nodes.find(n => n.id == p.nodeId) : undefined
                        const name = node ? ((node.data.name as string) || getNodeDetails(node.type).name) : 'Flow'
                        return (
                            <li key={i}>
                                <button className="w-full text-left px-3 py-2 hover:bg-muted flex gap-2 items-start disabled:hover:bg-transparent" disabled={!node} onClick={() => show(p.nodeId)}>
                                    {p.severity == 'error'
                                        ? <CircleAlert size={16} className="text-warning shrink-0 mt-0.5" aria-label="Problem" />
                                        : <AlertTriangle size={16} className="text-muted-foreground shrink-0 mt-0.5" aria-label="Warning" />}
                                    <span className="flex flex-col">
                                        <span className="text-xs font-semibold">{name}</span>
                                        <span className="text-xs text-muted-foreground">{p.message}</span>
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            </PopoverContent>
        </Popover>
    )
}
