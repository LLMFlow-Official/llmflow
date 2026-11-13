import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import RuntimeLogs from "./runtime_logs";
import RunHistory from "./run_history";
import FlowAssistantPanel from "./flow_assistant_panel";
import Properties from "./properties";
import { useFlowStore } from "@/lib/store";
import { PanelTab, showPanelTab, usePanelTab } from "./panel_tab";
import { getNodeDetails } from "@/lib/nodes";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import ErrorBoundary from "../ui/error_boundary";

/** Escape deselects the step (unless focus is in a text box or a dialog is open). */
function useEscapeToDeselect() {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key != 'Escape' || e.defaultPrevented) return
            const target = e.target instanceof Element ? e.target : null
            if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return
            if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
            if (useFlowStore.getState().selectedNode) useFlowStore.getState().clearSelection()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [])
}

const TABS: { id: PanelTab, label: string }[] = [
    { id: 'build', label: 'Build' },
    { id: 'log', label: 'Run log' },
    { id: 'history', label: 'History' },
    { id: 'step', label: 'Step' },
]

/**
 * The right-hand panel: the build assistant, the current run's log, past runs and, when a step is
 * selected, that step's settings. The tabs stay mounted so each keeps its place.
 */
export default function SidePanel() {
    const tab = usePanelTab(s => s.tab)
    const logUnread = usePanelTab(s => s.logUnread)
    const selectedNode = useFlowStore((state) => state.selectedNode)
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
    useEscapeToDeselect()

    const visible = TABS.filter(t => t.id != 'step' || selectedNode)
    const active = tab == 'step' && !selectedNode ? 'build' : tab
    const stepName = selectedNode ? ((selectedNode.data.name as string) || getNodeDetails(selectedNode.type).name) : ''

    const onTabKey = (e: React.KeyboardEvent) => {
        if (e.key != 'ArrowRight' && e.key != 'ArrowLeft') return
        const index = visible.findIndex(t => t.id == active)
        const next = visible[(index + (e.key == 'ArrowRight' ? 1 : visible.length - 1)) % visible.length]
        showPanelTab(next.id)
        tabRefs.current[next.id]?.focus()
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center gap-1 px-3 pt-2 border-b border-border" role="tablist" aria-label="Panel" onKeyDown={onTabKey}>
                {visible.map(({ id, label }) => (
                    <button
                        key={id}
                        ref={el => { tabRefs.current[id] = el }}
                        id={`panel-tab-${id}`}
                        role="tab"
                        aria-selected={active == id}
                        aria-controls={`panel-${id}`}
                        tabIndex={active == id ? 0 : -1}
                        title={id == 'step' ? stepName : undefined}
                        className={cn('px-3 py-1.5 text-sm -mb-px border-b-2 whitespace-nowrap', active == id ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground')}
                        onClick={() => showPanelTab(id)}
                    >
                        {label}
                        {id == 'log' && logUnread && active != 'log' ? <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-info align-middle" aria-label="(new)" /> : null}
                    </button>
                ))}
                {selectedNode && active == 'step' ? (
                    <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" toolTip="Close (Esc)" aria-label="Close step settings" onClick={() => useFlowStore.getState().clearSelection()}>
                        <X size={16} />
                    </Button>
                ) : null}
            </div>
            {visible.map(({ id }) => (
                <div key={id} id={`panel-${id}`} role="tabpanel" aria-labelledby={`panel-tab-${id}`} hidden={active != id} className={cn('flex-1 min-h-0', id == 'step' ? '' : 'pt-2')}>
                    {id == 'build' ? <FlowAssistantPanel />
                        : id == 'log' ? <RuntimeLogs />
                            : id == 'history' ? <RunHistory />
                                : (
                                    // A crash in one step's settings shows a message here instead of breaking the app.
                                    <ErrorBoundary label="this panel" compact resetKey={selectedNode?.id}>
                                        <Properties />
                                    </ErrorBoundary>
                                )}
                </div>
            ))}
        </div>
    )
}
