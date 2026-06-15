import {
  ApiOutlined,
  DeleteOutlined,
  ExpandOutlined,
  RedoOutlined,
  UndoOutlined,
} from '@ant-design/icons';
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
import { Button, Space, Tooltip } from 'antd';
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
    <div className="canvas-wrapper">
      {/* 工具栏 */}
      <div className="canvas-toolbar">
        <Space size={4}>
          <Tooltip title="撤销 (Ctrl+Z)">
            <Button
              type="text"
              icon={<UndoOutlined />}
              disabled={!canUndo}
              onClick={onUndo}
              size="small"
            />
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Y)">
            <Button
              type="text"
              icon={<RedoOutlined />}
              disabled={!canRedo}
              onClick={onRedo}
              size="small"
            />
          </Tooltip>
          <div className="toolbar-divider" />
          <Tooltip title="自动布局">
            <Button
              type="text"
              icon={<ApiOutlined />}
              onClick={onAutoLayout}
              size="small"
            />
          </Tooltip>
          <Tooltip title="适应画布">
            <Button
              type="text"
              icon={<ExpandOutlined />}
              onClick={handleFitView}
              size="small"
            />
          </Tooltip>
          <div className="toolbar-divider" />
          <Tooltip title="删除选中 (Delete)">
            <Button
              type="text"
              icon={<DeleteOutlined />}
              danger
              onClick={onDeleteSelected}
              size="small"
            />
          </Tooltip>
        </Space>
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
          variant={BackgroundVariant.Lines}
          gap={24}
          size={1}
          color="#cbd5e1"
          style={{ opacity: 0.5 }}
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
            background: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(8px)',
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
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px)',
          }}
        />
      </ReactFlow>
    </div>
  );
}
