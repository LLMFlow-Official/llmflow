import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { PanelBottomOpen, X } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import Topbar from "./topbar";
import Properties from "../node_utils/properties";
import { useFlowStore } from "@/lib/store";
import SidePanel from "../node_utils/side_panel";
import { TooltipProvider } from "../ui/tooltip";
import HumanInputPanel from "../node_utils/human_input_panel";
import { RunButton } from "./controllers";
import { ThemeController } from "./theme_toggle";
import { Button } from "../ui/button";

function useIsNarrow() {
    const [narrow, setNarrow] = useState(false)
    useEffect(() => {
        const query = window.matchMedia('(max-width: 767px)')
        setNarrow(query.matches)
        const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
    }, [])
    return narrow
}

export default function BaseLayout({ children }: { children: React.ReactNode }) {
    const selectedNode = useFlowStore((state) => state.selectedNode)
    const narrow = useIsNarrow()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const panel = selectedNode ? <Properties /> : <SidePanel />

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
                {narrow ? (
                    // Phones and narrow windows: the canvas fills the screen and the panel opens from the bottom.
                    <div className="relative h-dvh w-full overflow-hidden">
                        {canvas}
                        {!drawerOpen && !selectedNode ? (
                            <Button variant="outline" className="absolute left-4 bottom-6 z-40 gap-2 shadow-md bg-card" onClick={() => setDrawerOpen(true)}>
                                <PanelBottomOpen size={16} /> Run log
                            </Button>
                        ) : null}
                        {drawerOpen || selectedNode ? (
                            <div className="absolute inset-x-0 bottom-0 h-[65dvh] z-[60] bg-background border-t border-border rounded-t-xl shadow-2xl flex flex-col">
                                <div className="flex justify-end px-2 pt-1">
                                    <Button variant="ghost" size="icon" aria-label="Close panel" onClick={() => { setDrawerOpen(false); useFlowStore.getState().clearSelection() }}>
                                        <X size={18} />
                                    </Button>
                                </div>
                                <div className="flex-1 min-h-0">{panel}</div>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <ResizablePanelGroup direction="horizontal" className="!h-dvh">
                        <ResizablePanel defaultSize={72} className="relative h-full">
                            {canvas}
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel collapsible maxSize={50} defaultSize={28} minSize={20} className="h-full bg-background">
                            {panel}
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )}
            </ReactFlowProvider>
        </TooltipProvider>
    );
}
