import { Network, Trash2, Maximize, Redo, Undo } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  ConnectionLineType,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useCallback } from 'react';

import { customEdgeTypes } from './CustomEdges';
import { customNodeTypes } from './CustomNodes';
import type { FlowNode } from './graphModel';

type WorkflowCanvasPanelProps = {
  nodes: FlowNode[];
  edges: Edge[];
  canUndo: boolean;
  canRedo: boolean;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeSelect: (nodeId: string) => void;
  onEdgeSelect: (edgeId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onDeleteSelected: () => void;
};

export function WorkflowCanvasPanel({
  nodes,
  edges,
  canUndo,
  canRedo,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
  onEdgeSelect,
  onUndo,
  onRedo,
  onAutoLayout,
  onDeleteSelected,
}: WorkflowCanvasPanelProps) {
  const { fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.15, duration: 300 });
  }, [fitView]);

  return (
    <div className="flex-1 h-full w-full relative bg-slate-50/50">
      {/* 工具栏 */}
      <div className="absolute top-4 left-4 z-10 bg-white border border-slate-200 rounded-lg shadow-sm p-1.5 flex items-center gap-1">
        <button
          title="撤销 (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          title="重做 (Ctrl+Y)"
          disabled={!canRedo}
          onClick={onRedo}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <Redo className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <button
          title="自动布局"
          onClick={onAutoLayout}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-700 transition-colors"
        >
          <Network className="w-4 h-4" />
        </button>
        <button
          title="适应画布"
          onClick={handleFitView}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-700 transition-colors"
        >
          <Maximize className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <button
          title="删除选中 (Delete)"
          onClick={onDeleteSelected}
          className="p-1.5 rounded hover:bg-red-50 text-red-600 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 画布主体 */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={customNodeTypes}
        edgeTypes={customEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onNodeSelect(node.id)}
        onEdgeClick={(_, edge) => onEdgeSelect(edge.id)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        defaultEdgeOptions={{
          type: 'animated',
          animated: true,
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#818cf8', strokeWidth: 3 }}
        snapToGrid
        snapGrid={[20, 20]}
        minZoom={0.1}
        maxZoom={3}
        deleteKeyCode={['Delete', 'Backspace']}
        selectionOnDrag
        panOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color="#94a3b8"
          style={{ opacity: 0.6 }}
        />

        {/* 控制按钮 */}
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          position="bottom-left"
          style={{
            marginBottom: 24,
            marginLeft: 24,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.05)',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            background: '#ffffff',
          }}
        />

        {/* 缩略图 */}
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={3}
          position="bottom-right"
          nodeColor={(node) => {
            switch (node.type) {
              case 'source': return '#3b82f6';
              case 'output': return '#10b981';
              case 'skill': return '#8b5cf6';
              case 'branch': return '#f59e0b';
              case 'join': return '#10b981';
              case 'aggregator': return '#6366f1';
              default: return '#94a3b8';
            }
          }}
          style={{
            marginBottom: 24,
            marginRight: 24,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.05)',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            background: '#ffffff',
          }}
        />
      </ReactFlow>
    </div>
  );
}
