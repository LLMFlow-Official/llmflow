"use client";

import { nodeMap } from '@/lib/nodes';
import { useFlowStore, useTemporalFlowStore } from '@/lib/store';
import { Background, BackgroundVariant, Controls, FinalConnectionState, MarkerType, MiniMap, ReactFlow } from '@xyflow/react';

import { useShallow } from 'zustand/shallow';
import { useEffect } from 'react';
import CustomEdge from '@/components/node_utils/custom_edge';
import FlowContextMenu from '@/components/node_utils/flow_context_menu';
import { initLibrary, useLibraryStore } from '@/lib/library';
import { useIsDark } from '@/components/layout/theme_toggle';
import EmptyCanvasHint from '@/components/layout/empty_canvas';
import AppShell from '@/components/layout/app_shell';
import { useDropPicker } from '@/components/node_utils/new_node';
import { connectionProblem } from '@/lib/connections';
import { toast } from '@/hooks/use-toast';
import { confirmDeleteSteps } from '@/components/node_utils/confirm_delete';

/**
 * A connection let go of without reaching a handle: on empty canvas it offers the step list (the
 * new step is connected); on a step it connects when allowed, and otherwise says why not.
 */
function onConnectEnd(event: MouseEvent | TouchEvent, state: FinalConnectionState) {
  if (state.isValid || !state.fromNode || !state.fromHandle) return
  const { nodes, edges, onConnect } = useFlowStore.getState()
  const point = 'changedTouches' in event ? event.changedTouches[0] : event
  const target = document.elementFromPoint(point.clientX, point.clientY)
  const fromSource = state.fromHandle.type == 'source'
  const droppedOn = state.toNode?.id ?? target?.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined
  if (droppedOn) {
    const [source, targetId] = fromSource ? [state.fromNode.id, droppedOn] : [droppedOn, state.fromNode.id]
    if (source == targetId) return
    const problem = connectionProblem(source, targetId, nodes, edges)
    if (problem) toast({ title: "These steps can't be connected", description: problem, duration: 8000 })
    else onConnect({ source, target: targetId, sourceHandle: null, targetHandle: null })
    return
  }
  if (fromSource && target?.closest('.react-flow__pane')) {
    useDropPicker.setState({ open: true, x: point.clientX, y: point.clientY, from: state.fromNode.id })
  }
}

let started = false

function useFlowLibrary() {
  useEffect(() => {
    if (started) return
    started = true
    initLibrary({
      load: (nodes, edges) => {
        useFlowStore.setState({ nodes, edges })
        useFlowStore.temporal.getState().clear()
      },
      read: () => {
        const { nodes, edges } = useFlowStore.getState()
        return { nodes, edges }
      },
      subscribe: (onChange) => useFlowStore.subscribe((state, previous) => {
        if (state.nodes !== previous.nodes || state.edges !== previous.edges) onChange()
      }),
    }).catch(console.error)
  }, [])
}

function Canvas() {
  useFlowLibrary()
  const { ready, revision } = useLibraryStore(useShallow((s) => ({ ready: s.ready, revision: s.revision })))
  const clearHistory = useTemporalFlowStore((state) => state.clear);
  const dark = useIsDark()
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
    }))
  );

  return (
    <div className='bg-card absolute inset-0 h-full w-full'>
      {ready ? <FlowContextMenu>
        <ReactFlow
          key={revision}
          colorMode={dark ? 'dark' : 'light'}
          tabIndex={0}
          className='outline-hidden bg-muted!'
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onBeforeDelete={({ nodes }) => confirmDeleteSteps(nodes.map(n => n.id))}
          nodeTypes={nodeMap}
          edgeTypes={{
            default: CustomEdge
          }}
          defaultEdgeOptions={{
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 15,
              height: 15,
            },
            style: {
              strokeWidth: 2,
            }
          }}
          snapToGrid
          snapGrid={[10, 10]}
          fitView
          fitViewOptions={{
            padding: 0.3
          }}
          maxZoom={1.5}
          onInit={() => clearHistory()}
          deleteKeyCode={["Delete", "Backspace"]}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <EmptyCanvasHint />
          <Controls position="bottom-left" showInteractive={false} className="hidden sm:flex" />
          <MiniMap position="bottom-right" pannable zoomable className="bottom-24! hidden md:block" ariaLabel="Overview of the flow" />
        </ReactFlow>
      </FlowContextMenu> : null}
    </div>
  );
}

/** The app: the editor frame (top bar, panel, Run) around the canvas. Other pages (404) don't get it. */
export default function Home() {
  return <AppShell><Canvas /></AppShell>
}
