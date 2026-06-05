import { ApiOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { Edge } from '@xyflow/react';
import { Alert, Button, Card, Collapse, Divider, Form, Input, Select, Segmented, Space, Tabs, Typography } from 'antd';

import type { DatasetSummary, DatasetVersion, GraphIssue, ModelGatewayConnection, SkillManifest, WorkflowGraph, WorkflowGraphNode } from '../../types';
import { FieldMappingEditor } from './FieldMappingEditor';
import { edgeId, nodeTypeLabel, parseJsonObjectField, type FlowNode } from './graphModel';
import { NodeIssuePanel } from './WorkflowIssuePanels';
import { ParameterPreviewPanel } from './ParameterPreviewPanel';
import { SkillConfigEditor } from './SkillConfigEditor';

type DatasetVersionOption = {
  dataset: DatasetSummary;
  version: DatasetVersion;
};

type WorkflowInspectorPanelProps = {
  selectedGraphNode: WorkflowGraphNode | null;
  selectedEdgeId: string | null;
  selectedNodeIssues: GraphIssue[];
  selectedSkill: SkillManifest | null;
  skills: SkillManifest[];
  modelConnections: ModelGatewayConnection[];
  fieldPathOptions: string[];
  selectedOutgoingEdges: Edge[];
  connectableTargets: FlowNode[];
  graph: WorkflowGraph;
  datasetVersions: DatasetVersionOption[];
  selectedDatasetVersion: string | null;
  onDatasetVersionChange: (versionId: string) => void;
  onDeleteSelected: () => void;
  onAutoLayout: () => void;
  onDeleteEdge: (edgeId: string) => void;
  onConnectToNode: (nodeId: string) => void;
  onUpdateNode: (patch: Partial<WorkflowGraphNode>) => void;
  onUpdateAggregatorStrategy: (strategy: string) => void;
  onConsoleTextChange: (text: string) => void;
};

export function WorkflowInspectorPanel({
  selectedGraphNode,
  selectedEdgeId,
  selectedNodeIssues,
  selectedSkill,
  skills,
  modelConnections,
  fieldPathOptions,
  selectedOutgoingEdges,
  connectableTargets,
  graph,
  datasetVersions,
  selectedDatasetVersion,
  onDatasetVersionChange,
  onDeleteSelected,
  onAutoLayout,
  onDeleteEdge,
  onConnectToNode,
  onUpdateNode,
  onUpdateAggregatorStrategy,
  onConsoleTextChange,
}: WorkflowInspectorPanelProps) {
  return (
    <Card className="flat-card full-height" title="节点 Inspector">
      {selectedGraphNode ? (
        <Space direction="vertical" className="drawer-stack">
          <NodeIssuePanel issues={selectedNodeIssues} />
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基础配置',
                children: (
                  <Space direction="vertical" className="drawer-stack">
                    <Typography.Text strong>节点工具栏</Typography.Text>
                    <Space wrap>
                      <Button danger icon={<DeleteOutlined />} onClick={onDeleteSelected}>
                        删除当前节点
                      </Button>
                      <Button icon={<ApiOutlined />} onClick={onAutoLayout}>
                        自动布局
                      </Button>
                    </Space>
                    <Divider />
                    <div>
                      <Typography.Text type="secondary">节点 ID</Typography.Text>
                      <Input value={selectedGraphNode.node_id} onChange={(event) => onUpdateNode({ node_id: event.target.value })} />
                    </div>
                    <div>
                      <Typography.Text type="secondary">名称</Typography.Text>
                      <Input value={selectedGraphNode.label} onChange={(event) => onUpdateNode({ label: event.target.value })} />
                    </div>
                    <div>
                      <Typography.Text type="secondary">类型</Typography.Text>
                      <Select
                        value={selectedGraphNode.node_type}
                        className="full-width-control"
                        onChange={(node_type) => onUpdateNode({ node_type })}
                        options={['source', 'skill', 'branch', 'join', 'aggregator', 'output'].map((value) => ({ value, label: nodeTypeLabel[value as WorkflowGraphNode['node_type']] }))}
                      />
                    </div>
                    <div>
                      <Typography.Text type="secondary">Skill</Typography.Text>
                      <Select
                        allowClear
                        disabled={selectedGraphNode.node_type !== 'skill'}
                        value={selectedGraphNode.skill_ref}
                        className="full-width-control"
                        onChange={(skill_ref) => onUpdateNode({ skill_ref })}
                        options={skills.map((skill) => ({ value: skill.skill_id, label: skill.name }))}
                      />
                    </div>
                    <div>
                      <Typography.Text type="secondary">条件表达式</Typography.Text>
                      <Input value={selectedGraphNode.condition} onChange={(event) => onUpdateNode({ condition: event.target.value })} placeholder="例如 metrics.score > 0.6" />
                    </div>
                    {selectedGraphNode.node_type === 'aggregator' ? (
                      <div>
                        <Typography.Text type="secondary">聚合策略</Typography.Text>
                        <Segmented
                          block
                          value={String(selectedGraphNode.config?.strategy ?? 'majority_vote')}
                          onChange={(value) => onUpdateAggregatorStrategy(String(value))}
                          options={[
                            { label: '多数投票', value: 'majority_vote' },
                            { label: '均值', value: 'mean' },
                            { label: '一致性', value: 'agreement' },
                          ]}
                        />
                      </div>
                    ) : null}
                    {selectedGraphNode.node_type === 'skill' ? (
                      <>
                        <Divider />
                        <Typography.Text strong>运行参数</Typography.Text>
                        <SkillConfigEditor
                          skill={selectedSkill}
                          value={selectedGraphNode.config ?? {}}
                          modelConnections={modelConnections}
                          onChange={(config) => onUpdateNode({ config })}
                        />
                      </>
                    ) : null}
                    <Divider />
                    <FieldMappingEditor
                      title="输入绑定"
                      value={selectedGraphNode.input_mapping ?? {}}
                      pathOptions={fieldPathOptions}
                      schema={selectedSkill?.input_schema}
                      description="把 Skill manifest 固定输入字段绑定到数据集字段或上游节点输出。"
                      onChange={(input_mapping) => onUpdateNode({ input_mapping })}
                      addButtonLabel="新增输入映射"
                    />
                    <FieldMappingEditor
                      title="输出写入"
                      value={selectedGraphNode.output_mapping ?? {}}
                      pathOptions={fieldPathOptions}
                      schema={selectedSkill?.output_schema}
                      description="Skill 输出字段名由 manifest 固定，下游直接引用“当前节点 ID.字段”。"
                      mode="output"
                      nodeId={selectedGraphNode.node_id}
                      onChange={(output_mapping) => onUpdateNode({ output_mapping })}
                      addButtonLabel="新增输出映射"
                    />
                    <Collapse
                      items={[
                        {
                          key: 'advanced-json',
                          label: '高级 JSON 模式',
                          children: (
                            <Form layout="vertical">
                              <Form.Item label="输入映射 JSON">
                                <Input.TextArea
                                  aria-label="输入映射 JSON"
                                  key={`${selectedGraphNode.node_id}-input-${JSON.stringify(selectedGraphNode.input_mapping ?? {})}`}
                                  rows={4}
                                  defaultValue={JSON.stringify(selectedGraphNode.input_mapping ?? {}, null, 2)}
                                  onBlur={(event) => updateJsonPatch('input_mapping', event.target.value, onUpdateNode, onConsoleTextChange)}
                                />
                              </Form.Item>
                              <Form.Item label="输出别名 JSON（高级兼容）">
                                <Input.TextArea
                                  aria-label="输出映射 JSON"
                                  key={`${selectedGraphNode.node_id}-output-${JSON.stringify(selectedGraphNode.output_mapping ?? {})}`}
                                  rows={4}
                                  defaultValue={JSON.stringify(selectedGraphNode.output_mapping ?? {}, null, 2)}
                                  onBlur={(event) => updateJsonPatch('output_mapping', event.target.value, onUpdateNode, onConsoleTextChange)}
                                />
                              </Form.Item>
                              <Form.Item label="配置 JSON">
                                <Input.TextArea
                                  key={`${selectedGraphNode.node_id}-config`}
                                  rows={4}
                                  defaultValue={JSON.stringify(selectedGraphNode.config ?? {}, null, 2)}
                                  onBlur={(event) => updateJsonPatch('config', event.target.value, onUpdateNode, onConsoleTextChange)}
                                />
                              </Form.Item>
                            </Form>
                          ),
                        },
                      ]}
                    />
                    <Divider />
                    <Typography.Text strong>下游连线</Typography.Text>
                    <OutgoingEdges edges={selectedOutgoingEdges} onDeleteEdge={onDeleteEdge} />
                    <Divider />
                    <Typography.Text strong>可连接目标</Typography.Text>
                    <ConnectableTargets targets={connectableTargets} onConnectToNode={onConnectToNode} />
                  </Space>
                ),
              },
              {
                key: 'edges',
                label: '连线',
                children: (
                  <Space direction="vertical" className="drawer-stack">
                    <Typography.Text strong>下游连线</Typography.Text>
                    <OutgoingEdges edges={selectedOutgoingEdges} onDeleteEdge={onDeleteEdge} />
                    <Divider />
                    <Typography.Text strong>可连接目标</Typography.Text>
                    <ConnectableTargets targets={connectableTargets} onConnectToNode={onConnectToNode} />
                  </Space>
                ),
              },
              {
                key: 'parameters',
                label: '参数预览',
                children: (
                  <ParameterPreviewPanel
                    graph={graph}
                    datasetVersions={datasetVersions}
                    selectedDatasetVersion={selectedDatasetVersion}
                    onDatasetVersionChange={onDatasetVersionChange}
                  />
                ),
              },
            ]}
          />
        </Space>
      ) : (
        <Alert type="info" showIcon message={selectedEdgeId ? `当前选中连线：${selectedEdgeId}` : '请选择节点后编辑配置。'} />
      )}
    </Card>
  );
}

function OutgoingEdges({ edges, onDeleteEdge }: { edges: Edge[]; onDeleteEdge: (edgeId: string) => void }) {
  if (!edges.length) {
    return <Typography.Text type="secondary">当前节点暂无下游连线。</Typography.Text>;
  }
  return (
    <Space direction="vertical" className="drawer-stack">
      {edges.map((edge) => {
        const id = edge.id || edgeId(edge.source, edge.target);
        return (
          <Button key={id} danger icon={<DeleteOutlined />} onClick={() => onDeleteEdge(id)}>
            删除连线 {edge.source} -&gt; {edge.target}
          </Button>
        );
      })}
    </Space>
  );
}

function ConnectableTargets({ targets, onConnectToNode }: { targets: FlowNode[]; onConnectToNode: (nodeId: string) => void }) {
  if (!targets.length) {
    return <Typography.Text type="secondary">没有更多可连接目标。</Typography.Text>;
  }
  return (
    <Space direction="vertical" className="drawer-stack">
      {targets.map((node) => (
        <Button key={node.id} icon={<PlusOutlined />} onClick={() => onConnectToNode(node.id)}>
          连接到 {node.id}
        </Button>
      ))}
    </Space>
  );
}

function updateJsonPatch(
  field: 'input_mapping' | 'output_mapping' | 'config',
  raw: string,
  updateSelectedNode: (patch: Partial<WorkflowGraphNode>) => void,
  setConsoleText: (text: string) => void,
) {
  const parsed = parseJsonObjectField(raw, field);
  if (!parsed.ok) {
    setConsoleText(`JSON 解析失败：${parsed.issue.message}`);
    return;
  }
  updateSelectedNode({ [field]: parsed.value });
}
