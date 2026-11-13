import { useState } from "react";
import RuntimeLogs from "./runtime_logs";
import RunHistory from "./run_history";

/** The right-hand panel when no node is selected: the current run's log, or past runs. */
export default function SidePanel() {
    const [tab, setTab] = useState<'log' | 'history'>('log')
    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex gap-1 px-3 pt-2 border-b border-border" role="tablist">
                {([['log', 'Run log'], ['history', 'History']] as const).map(([id, label]) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab == id}
                        className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${tab == id ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
                        onClick={() => setTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 pt-2">
                {tab == 'log' ? <RuntimeLogs /> : <RunHistory />}
            </div>
        </div>
    )
}
