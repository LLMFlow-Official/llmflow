"use client";

import { nodeMap } from '@/lib/nodes';
import { useFlowStore, useTemporalFlowStore } from '@/lib/store';
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow } from '@xyflow/react';

import { useShallow } from 'zustand/shallow';
import { useEffect } from 'react';
import CustomEdge from '@/components/node_utils/custom_edge';
import FlowContextMenu from '@/components/node_utils/flow_context_menu';
import { initLibrary, useLibraryStore } from '@/lib/library';
import { useIsDark } from '@/components/layout/theme_toggle';

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

export default function Home() {
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
          className='outline-none !bg-muted'
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
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
          <Controls position="bottom-left" showInteractive={false} className="hidden sm:flex" />
          <MiniMap position="bottom-right" pannable zoomable className="!bottom-24 hidden md:block" ariaLabel="Overview of the flow" />
        </ReactFlow>
      </FlowContextMenu> : null}
    </div>
  );
}
