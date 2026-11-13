import { useState } from "react";
import { useMediaQuery } from "@/hooks/use-browser";
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
import ErrorBoundary from "../ui/error_boundary";


export default function BaseLayout({ children }: { children: React.ReactNode }) {
    const selectedNode = useFlowStore((state) => state.selectedNode)
    const narrow = useMediaQuery('(max-width: 767px)')
    const [drawerOpen, setDrawerOpen] = useState(false)
    // A crash in one node's settings shows a message in the panel instead of breaking the app.
    const panel = (
        <ErrorBoundary label="this panel" compact resetKey={selectedNode?.id}>
            {selectedNode ? <Properties /> : <SidePanel />}
        </ErrorBoundary>
    )

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
                            <div className="absolute inset-x-0 bottom-0 h-[65dvh] z-60 bg-background border-t border-border rounded-t-xl shadow-2xl flex flex-col">
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
                    <ResizablePanelGroup direction="horizontal" className="h-dvh!">
                        <ResizablePanel id="canvas-panel" order={1} defaultSize={72} className="relative h-full">
                            {canvas}
                        </ResizablePanel>
                        <ResizableHandle withHandle />
                        <ResizablePanel id="side-panel" order={2} collapsible maxSize={50} defaultSize={28} minSize={20} className="h-full bg-background">
                            {panel}
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )}
            </ReactFlowProvider>
        </TooltipProvider>
    );
}
