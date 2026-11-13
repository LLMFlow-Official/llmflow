import NewNode from "../node_utils/new_node";
import { Card } from "../ui/card";
import { LayoutGrid, Play, Scan, Square } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useFlowStore, useRuntimeStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import UndoRedo from "../node_utils/undo_redo";
import FindNode from "../node_utils/find_node";
import { Button } from "../ui/button";
import { cn, MOD_KEY } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { runInEditor } from "@/lib/run_flow";
import { autoLayout } from "@/lib/layout";

/** Editing tools shown in the top bar. */
export default function Controllers() {
  const reactFlow = useReactFlow();

  const tidy = () => {
    const { nodes, edges, setNodes } = useFlowStore.getState()
    setNodes(autoLayout(nodes, edges))
    track('auto_layout')
    requestAnimationFrame(() => reactFlow.fitView({ padding: 0.3, duration: 300 }))
  }

  return (
    <Card className="p-1 flex gap-1 pointer-events-auto">
      <UndoRedo />
      <NewNode />
      <FindNode />
      <Button toolTip="Tidy up layout" aria-label="Tidy up layout" variant={'ghost'} size={'icon'} onClick={tidy}>
        <LayoutGrid />
      </Button>
      <Button toolTip="Fit in view" aria-label="Fit in view" variant={'ghost'} size={'icon'} onClick={() => reactFlow.fitView({
        padding: 0.3,
        duration: 300
      })} onMouseDown={() => track('fit_in_view_pressed')} >
        <Scan />
      </Button>
    </Card>
  );
}

/** The round Run / Stop button in the corner of the canvas. Ctrl/⌘ + Enter does the same. */
export function RunButton() {
  const { toast } = useToast()
  const isRunning = useRuntimeStore(s => s.isRunning)
  const stop = useRuntimeStore(s => s.stop)

  const run = useCallback(() => {
    useFlowStore.getState().clearSelection()
    return runInEditor({
      notify: (title, description) => toast({ title, description, duration: description ? 4000 : 3000 }),
    })
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key == 'Enter') {
        // Leave the key to dialogs and to boxes that use it themselves (human input, the Build chat).
        const target = e.target instanceof Element ? e.target : null
        if (e.defaultPrevented || target?.closest('[role="dialog"], [role="alertdialog"], [data-own-shortcuts]')) return
        e.preventDefault()
        if (useRuntimeStore.getState().isRunning) stop()
        else run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, stop])

  return (
    <div className={cn("rounded-full p-2 absolute right-4 bottom-[calc(var(--drawer-h,0px)+1rem)] z-45 shadow-md h-16 w-16 flex items-center justify-center", isRunning ? "bg-red-500" : "bg-green-500")} >
      <Button
        className="rounded-full h-14 w-14 bg-transparent hover:bg-transparent p-2"
        variant="ghost"
        toolTip={isRunning ? `Stop (${MOD_KEY}+Enter)` : `Run (${MOD_KEY}+Enter)`}
        aria-label={isRunning ? "Stop the flow" : "Run the flow"}
        onClick={isRunning ? stop : run}
      >
        {isRunning ? <Square className="stroke-white" size={32} /> : <Play className="stroke-white" size={32} />}
      </Button>
    </div>
  )
}
