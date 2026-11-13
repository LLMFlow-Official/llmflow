import NewNode from "../node_utils/new_node";
import { Card } from "../ui/card";
import { Play, Scan, Square } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { AppContext, Controller, getNodeDetails, NodeType } from "@/lib/nodes";
import { useReactFlow } from "@xyflow/react";
import { allReachable, EngineNode, ProcessFn, runFlow, validateGraph } from "@/lib/engine";
import { waitWhileRunning } from "../node_utils/node_shell";
import { AppNode, useFlowStore, useRuntimeStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import UndoRedo from "../node_utils/undo_redo";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";

export default function Controllers() {
  const { toast } = useToast()
  const clearSelection = useFlowStore(s => s.clearSelection)

  const { isRunning, start, stop, log, increaseInToken, increaseOutToken, increaseAmount, setNodeState, setNodeStateFromNodeId} = useRuntimeStore(useShallow(s => ({
    isRunning: s.isRunning,
    start: s.start,
    stop: s.stop,
    log: s.log,
    increaseInToken: s.increaseInToken,
    increaseOutToken: s.increaseOutToken,
    increaseAmount: s.increaseAmount,
    setNodeState: s.setNodeState,
    setNodeStateFromNodeId: s.setNodeStateFromNodeId,
  })));

  const reactFlow = useReactFlow();

  const startWrapper = async () => {
    if (useRuntimeStore.getState().isRunning) return;
    clearSelection()
    const { nodes, edges } = useFlowStore.getState()
    const startNode = nodes.find((node: AppNode) => node.type === 'start');
    if (!startNode) return;

    const getBodyTargets = (node: EngineNode) => getNodeDetails(node.type as NodeType).bodyTargets?.(node as AppNode) || []
    const problem = validateGraph(startNode.id, nodes, edges, getBodyTargets)
    if (problem) {
      toast({ title: "This flow can't run", description: problem, duration: 5000 })
      return
    }

    track('started')
    start();
    const waiting = new Set(allReachable(startNode.id, nodes, edges))
    setNodeState(Object.fromEntries(nodes.map(x => [x.id, waiting.has(x.id) ? 'waiting' : 'idle'])))

    const controller: Controller = { log, increaseInToken, increaseOutToken, increaseAmount }
    const context: AppContext = {};

    await runFlow(startNode.id, context, nodes, edges, {
      getProcess: (type) => getNodeDetails(type as NodeType).process as unknown as ProcessFn,
      getBodyTargets,
      setNodeState: setNodeStateFromNodeId,
      isRunning: () => useRuntimeStore.getState().isRunning,
      controller,
      wait: waitWhileRunning,
      onNodeError: (node, error) => {
        console.error(error);
        // Only the node type: error messages can contain prompt text or model output.
        track('flow_error', { nodeType: node.type })
        controller.log({ id: node.id, nodeType: node.type as NodeType, type: 'error', title: error.message })
        toast({
          title: `Something went wrong on ${(node.data.name as string) || getNodeDetails(node.type as NodeType).name}`,
          description: error.message,
          duration: 3000
        })
      },
    })

    stop();
    track('ended')
    setTimeout(() => {
      if (useRuntimeStore.getState().isRunning) return
      setNodeState(Object.fromEntries(useFlowStore.getState().nodes.map(x => [x.id, 'idle'])))
    }, 3000);
  }

  return (
    <>
      <Card className="absolute top-2 left-1/2 -translate-x-1/2 p-1 flex gap-1 z-50">
        <UndoRedo/>
        <NewNode />
        <Button toolTip="Fit in view" variant={'ghost'} size={'icon'} onClick={() => reactFlow.fitView({
          padding: 0.3,
          duration: 300
        })} onMouseDown={() => track('fit_in_view_pressed')} >
          <Scan/>
        </Button>
      </Card>
      <div className={cn("rounded-full p-2 absolute right-4 bottom-4 z-50 shadow-md h-16 w-16 flex items-center justify-center", isRunning ? "bg-red-500" : "bg-green-500")} >
        <Button className="rounded-full h-14 w-14 bg-transparent hover:bg-transparent p-2" variant="ghost" toolTip={isRunning ? "Stop" : "Play"} onClick={isRunning ? stop : startWrapper}>
          {isRunning ? <Square className="stroke-white" size={32} /> : <Play className="stroke-white" size={32} />}
        </Button>
      </div>
    </>
  );
}