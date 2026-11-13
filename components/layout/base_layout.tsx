import { useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useMediaQuery } from "@/hooks/use-browser";
import { ReactFlowProvider } from "@xyflow/react";
import { PanelBottomOpen, PanelRightOpen, X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import Topbar from "./topbar";
import { useFlowStore, useRuntimeStore } from "@/lib/store";
import SidePanel from "../node_utils/side_panel";
import { showPanelTab } from "../node_utils/panel_tab";
import { TooltipProvider } from "../ui/tooltip";
import HumanInputPanel from "../node_utils/human_input_panel";
import { RunButton } from "./controllers";
import { ThemeController } from "./theme_toggle";
import { Button } from "../ui/button";
import { ConfirmHost } from "../ui/confirm_host";
import { ShortcutsDialog } from "./shortcuts";


export default function BaseLayout({ children }: { children: React.ReactNode }) {
    const selectedNode = useFlowStore((state) => state.selectedNode)
    const narrow = useMediaQuery('(max-width: 767px)')
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    const sidePanel = useRef<ImperativePanelHandle>(null)
    // A question from a Human Input step needs an answer: keep the panel out of its way.
    const waitingForInput = useRuntimeStore((state) => state.pendingInputs.length > 0)
    const running = useRuntimeStore((state) => state.isRunning)
    // On phones, starting a run opens the panel on the run log so the run can be followed.
    const [wasRunning, setWasRunning] = useState(running)
    if (running != wasRunning) {
        setWasRunning(running)
        if (running && narrow) setDrawerOpen(true)
    }
    const showDrawer = (drawerOpen || !!selectedNode) && !waitingForInput

    const canvas = <>
        <Topbar />
        {children}
        <HumanInputPanel />
        <RunButton />
    </>

    return (
        <TooltipProvider>
            <ReactFlowProvider>
                <ThemeController />
                <ConfirmHost />
                <ShortcutsDialog />
                {narrow ? (
                    // Phones and narrow windows: the canvas fills the screen and the panel opens from the bottom.
                    // --drawer-h lifts the Run button above the open panel.
                    <div className="relative h-dvh w-full overflow-hidden" style={{ '--drawer-h': showDrawer ? '65dvh' : '0px' } as React.CSSProperties}>
                        {canvas}
                        {!showDrawer ? (
                            <Button variant="outline" className="absolute left-14 bottom-6 z-40 gap-2 shadow-md bg-card" onClick={() => { if (running) showPanelTab('log'); setDrawerOpen(true) }}>
                                <PanelBottomOpen size={16} /> Panel
                            </Button>
                        ) : null}
                        {showDrawer ? (
                            // Below dialogs, menus and tooltips (z-50), which open from inside it.
                            <div className="absolute inset-x-0 bottom-0 h-[65dvh] z-40 bg-background border-t border-border rounded-t-xl shadow-2xl flex flex-col">
                                <div className="flex justify-end px-2 pt-1">
                                    <Button variant="ghost" size="icon" aria-label="Close panel" onClick={() => { setDrawerOpen(false); useFlowStore.getState().clearSelection() }}>
                                        <X size={18} />
                                    </Button>
                                </div>
                                <div className="flex-1 min-h-0"><SidePanel /></div>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    // The panel width is remembered in this browser (autoSaveId).
                    <ResizablePanelGroup direction="horizontal" className="h-dvh!" autoSaveId="llmflow-layout">
                        <ResizablePanel id="canvas-panel" order={1} defaultSize={72} className="relative h-full">
                            {canvas}
                            {collapsed ? (
                                <Button variant="outline" size="sm" className="absolute right-4 top-20 z-40 gap-2 shadow-md bg-card" onClick={() => sidePanel.current?.expand()}>
                                    <PanelRightOpen size={16} /> Show panel
                                </Button>
                            ) : null}
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel
                            ref={sidePanel}
                            id="side-panel"
                            order={2}
                            collapsible
                            maxSize={50}
                            defaultSize={28}
                            minSize={20}
                            onCollapse={() => setCollapsed(true)}
                            onExpand={() => setCollapsed(false)}
                            className="h-full bg-background"
                        >
                            <SidePanel />
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )}
            </ReactFlowProvider>
        </TooltipProvider>
    );
}
