import NewNode from "../node_utils/new_node";
import { Card } from "../ui/card";
import { LayoutGrid, Play, Scan, Square } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useFlowStore, useRuntimeStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "../ui/toast";
import { openSettings } from "./settings";
import { blockingProblems, ProblemsButton, useFlowProblems } from "../node_utils/flow_problems";
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
        <LayoutGrid size={18} />
      </Button>
      <Button toolTip="Fit in view" aria-label="Fit in view" variant={'ghost'} size={'icon'} onClick={() => reactFlow.fitView({
        padding: 0.3,
        duration: 300
      })} onMouseDown={() => track('fit_in_view_pressed')} >
        <Scan size={18} />
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
    // Problems that would make the run fail are shown first, with a link to each step.
    if (blockingProblems().length) {
      useFlowProblems.setState({ open: true })
      return Promise.resolve(null)
    }
    useFlowStore.getState().clearSelection()
    return runInEditor({
      notify: (title, description, options) => toast({
        title,
        description,
        // Errors stay until closed; a missing key gets a button that opens Settings.
        ...(options?.error ? { variant: 'destructive' as const, duration: Infinity } : { duration: description ? 4000 : 3000 }),
        action: description && /API key|key was rejected/i.test(description)
          ? <ToastAction altText="Open Settings" onClick={openSettings}>Open Settings</ToastAction>
          : undefined,
      }),
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
    <div className="absolute right-4 bottom-[calc(var(--drawer-h,0px)+1rem)] z-45 flex items-center gap-2">
      <ProblemsButton />
      <Button
        className={cn(
          "h-12 rounded-full px-5 gap-2 text-base font-semibold shadow-lg",
          isRunning ? "bg-danger text-danger-foreground hover:bg-danger/90" : "bg-success text-success-foreground hover:bg-success/90",
        )}
        toolTip={isRunning ? `Stop (${MOD_KEY}+Enter)` : `Run (${MOD_KEY}+Enter)`}
        aria-label={isRunning ? "Stop the flow" : "Run the flow"}
        onClick={isRunning ? stop : run}
      >
        {isRunning ? <Square size={18} className="fill-current" aria-hidden /> : <Play size={18} className="fill-current" aria-hidden />}
        {isRunning ? 'Stop' : 'Run'}
      </Button>
    </div>
  )
}
