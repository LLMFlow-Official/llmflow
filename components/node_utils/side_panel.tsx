import { create } from "zustand";
import RuntimeLogs from "./runtime_logs";
import RunHistory from "./run_history";
import FlowAssistantPanel from "./flow_assistant_panel";
import { useRuntimeStore } from "@/lib/store";

type Tab = 'build' | 'log' | 'history'

/** Kept outside the component so the tab survives selecting a node (which replaces this panel). */
const useTab = create<{ tab: Tab }>()(() => ({ tab: 'build' }))

// Show the log when a run starts.
useRuntimeStore.subscribe((state, previous) => {
    if (state.isRunning && !previous.isRunning) useTab.setState({ tab: 'log' })
})

const TABS: [Tab, string][] = [['build', 'Build'], ['log', 'Run log'], ['history', 'History']]

/** The right-hand panel when no node is selected: the build assistant, the current run's log, or past runs. */
export default function SidePanel() {
    const tab = useTab(s => s.tab)
    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex gap-1 px-3 pt-2 border-b border-border" role="tablist">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab == id}
                        className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${tab == id ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
                        onClick={() => useTab.setState({ tab: id })}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 pt-2">
                {tab == 'build' ? <FlowAssistantPanel /> : tab == 'log' ? <RuntimeLogs /> : <RunHistory />}
            </div>
        </div>
    )
}
