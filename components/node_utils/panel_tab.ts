import { create } from "zustand";
import { useFlowStore, useRuntimeStore } from "@/lib/store";

export type PanelTab = 'build' | 'log' | 'history' | 'step'

type TabState = {
    tab: PanelTab
    /** The tab to return to when the step is deselected. */
    back: PanelTab
    /** Set by "Show this step" in the log: select the step but stay on the current tab. */
    keepTab: boolean
    /** Something new happened in the run log while another tab was showing. */
    logUnread: boolean
}

/** Kept outside the components so the open tab survives re-renders and the phone drawer closing. */
export const usePanelTab = create<TabState>()(() => ({ tab: 'build', back: 'build', keepTab: false, logUnread: false }))

export const showPanelTab = (tab: PanelTab) => usePanelTab.setState(tab == 'log' ? { tab, logUnread: false } : { tab })

/** Selects a step on the canvas without leaving the current tab (used by the run log). */
export function selectStepKeepingTab(id: string) {
    usePanelTab.setState({ keepTab: true })
    const { nodes, onNodesChange } = useFlowStore.getState()
    onNodesChange(nodes.map(n => ({ type: 'select' as const, id: n.id, selected: n.id == id })))
}

// Show the log when a run starts; mark it unread when entries arrive while it is hidden.
useRuntimeStore.subscribe((state, previous) => {
    if (state.isRunning && !previous.isRunning) usePanelTab.setState({ tab: 'log', logUnread: false })
    else if ((state.logs !== previous.logs || state.lastRun !== previous.lastRun) && usePanelTab.getState().tab != 'log') usePanelTab.setState({ logUnread: true })
})

// Selecting a step opens its settings; deselecting goes back to where the user was.
useFlowStore.subscribe((state, previous) => {
    const id = state.nodes.find(n => n.selected)?.id
    if (id == previous.nodes.find(n => n.selected)?.id) return
    const current = usePanelTab.getState()
    if (id) {
        if (current.keepTab) usePanelTab.setState({ keepTab: false })
        else if (current.tab != 'step') usePanelTab.setState({ tab: 'step', back: current.tab })
    } else if (current.tab == 'step') {
        usePanelTab.setState({ tab: current.back == 'step' ? 'build' : current.back })
    }
})

// Opening the log (by any route) marks it read.
usePanelTab.subscribe((state) => {
    if (state.tab == 'log' && state.logUnread) usePanelTab.setState({ logUnread: false })
})
