import { ApiOutlined, DeleteOutlined, RedoOutlined, UndoOutlined } from '@ant-design/icons';
import { Background, Controls, MiniMap, ReactFlow, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { Button, Card, Space } from 'antd';

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
  return (
    <Card
      className="flat-card canvas-card"
      title="DAG 画布"
      extra={(
        <Space>
          <Button icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo}>撤销</Button>
          <Button icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo}>重做</Button>
          <Button icon={<ApiOutlined />} onClick={onAutoLayout}>自动布局</Button>
          <Button icon={<DeleteOutlined />} danger onClick={onDeleteSelected}>删除选中</Button>
        </Space>
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onNodeSelect(node.id)}
        onEdgeClick={(_, edge) => onEdgeSelect(edge.id)}
        fitView
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background />
      </ReactFlow>
    </Card>
  );
}
