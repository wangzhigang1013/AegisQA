import { Network, Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Edge } from '@xyflow/react';

import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';

import type { DatasetSummary, DatasetVersion, GraphIssue, ModelGatewayConnection, SkillManifest, WorkflowGraph, WorkflowGraphNode } from '../../types';
import { FieldMappingEditor } from './FieldMappingEditor';
import { edgeId, nodeTypeLabel, parseJsonObjectField, type FlowNode } from './graphModel';
import { NodeIssuePanel } from './WorkflowIssuePanels';
import { ParameterPreviewPanel } from './ParameterPreviewPanel';
import { SkillConfigEditor } from './SkillConfigEditor';
import { WorkflowConsolePanel } from './WorkflowConsolePanel';
import type { GraphValidationResult } from '../../types';

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
  selectedDataset: DatasetVersion | null;
  consoleTab: string;
  consoleText: string;
  consoleResult: GraphValidationResult | Record<string, unknown> | null;
  validateLoading: boolean;
  dryRunLoading: boolean;
  onConsoleTabChange: (tab: string) => void;
  onValidate: () => void;
  onDryRun: () => void;
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
  selectedDataset,
  consoleTab,
  consoleText,
  consoleResult,
  validateLoading,
  dryRunLoading,
  onConsoleTabChange,
  onValidate,
  onDryRun,
}: WorkflowInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState('basic');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!selectedGraphNode && activeTab !== 'console') {
      setActiveTab('console');
    }
  }, [selectedGraphNode, activeTab]);

  const inputClass = "w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";

  return (
    <Card className="shadow-none border-0 flex-1 min-h-0 flex flex-col rounded-none border-l border-slate-200">
      <CardHeader className="py-4 px-6 border-b border-slate-100">
        <CardTitle className="text-lg">配置与调试</CardTitle>
      </CardHeader>
      
      <div className="flex border-b border-slate-200 px-6 pt-2 bg-slate-50/50">
        {[
          { key: 'basic', label: '配置', disabled: !selectedGraphNode },
          { key: 'edges', label: '连线', disabled: !selectedGraphNode },
          { key: 'parameters', label: '参数预览', disabled: !selectedGraphNode },
          { key: 'console', label: '运行测试', disabled: false },
        ].map(tab => (
          <button
            key={tab.key}
            disabled={tab.disabled}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              activeTab === tab.key 
                ? 'border-blue-500 text-blue-600' 
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <CardContent className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col">
        {activeTab === 'console' && (
          <WorkflowConsolePanel
            graph={graph}
            selectedDataset={selectedDataset}
            consoleTab={consoleTab}
            consoleText={consoleText}
            consoleResult={consoleResult}
            validateLoading={validateLoading}
            dryRunLoading={dryRunLoading}
            onConsoleTabChange={onConsoleTabChange}
            onValidate={onValidate}
            onDryRun={onDryRun}
          />
        )}
        {activeTab !== 'console' && !selectedGraphNode && (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            请在画布中选择一个节点
          </div>
        )}
        {activeTab !== 'console' && selectedGraphNode && (
          <div className="flex flex-col gap-6">
            <NodeIssuePanel issues={selectedNodeIssues} />
            <div className="pt-2 pb-6 flex flex-col gap-6">
              {activeTab === 'basic' && (
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-3">
                    <h4 className="font-semibold text-sm">节点工具栏</h4>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="destructive" size="sm" onClick={onDeleteSelected} className="flex items-center gap-1.5 h-8">
                        <Trash2 className="w-4 h-4" /> 删除当前节点
                      </Button>
                      <Button variant="outline" size="sm" onClick={onAutoLayout} className="flex items-center gap-1.5 h-8">
                        <Network className="w-4 h-4" /> 自动布局
                      </Button>
                    </div>
                  </div>

                  <hr className="border-slate-100" />

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-slate-500">节点 ID</label>
                      <input
                        type="text"
                        className={inputClass}
                        value={selectedGraphNode.node_id}
                        readOnly
                        title="节点 ID 创建后不可修改，修改会导致连线丢失"
                        style={{ opacity: 0.7, cursor: 'not-allowed' }}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-slate-500">名称</label>
                      <input 
                        type="text" 
                        className={inputClass} 
                        value={selectedGraphNode.label} 
                        onChange={(e) => onUpdateNode({ label: e.target.value })} 
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-slate-500">类型</label>
                      <select
                        className={inputClass}
                        value={selectedGraphNode.node_type}
                        onChange={(e) => onUpdateNode({ node_type: e.target.value as WorkflowGraphNode['node_type'] })}
                      >
                        {['source', 'skill', 'branch', 'join', 'aggregator', 'output'].map(val => (
                          <option key={val} value={val}>{nodeTypeLabel[val as WorkflowGraphNode['node_type']]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-slate-500">Skill</label>
                      <select
                        className={inputClass}
                        disabled={selectedGraphNode.node_type !== 'skill'}
                        value={selectedGraphNode.skill_ref ?? ''}
                        onChange={(e) => onUpdateNode({ skill_ref: e.target.value || undefined })}
                      >
                        <option value="">-- 选择 Skill --</option>
                        {skills.map(skill => (
                          <option key={skill.skill_id} value={skill.skill_id}>{skill.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-slate-500">条件表达式</label>
                      <input
                        type="text"
                        className={inputClass}
                        placeholder="例如 metrics.score > 0.6"
                        value={selectedGraphNode.condition ?? ''}
                        onChange={(e) => onUpdateNode({ condition: e.target.value })}
                      />
                      <div className="text-xs text-slate-400 leading-relaxed">
                        支持: <code>path exists</code> / <code>path == "value"</code> / <code>path {'>'} 0.5</code> / <code>A AND B</code> / <code>A OR B</code> / <code>(A OR B) AND C</code>
                      </div>
                    </div>
                    
                    {selectedGraphNode.node_type === 'aggregator' && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-slate-500">聚合策略</label>
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                          {[
                            { label: '多数投票', value: 'majority_vote' },
                            { label: '均值', value: 'mean' },
                            { label: '一致性', value: 'agreement' },
                          ].map(opt => {
                            const isSelected = String(selectedGraphNode.config?.strategy ?? 'majority_vote') === opt.value;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => onUpdateAggregatorStrategy(opt.value)}
                                className={`flex-1 py-1 text-sm rounded-md transition-colors ${isSelected ? 'bg-white shadow-sm font-medium text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedGraphNode.node_type === 'skill' && (
                    <>
                      <hr className="border-slate-100" />
                      <SkillConfigEditor
                        skill={selectedSkill}
                        value={selectedGraphNode.config ?? {}}
                        modelConnections={modelConnections}
                        onChange={(config) => onUpdateNode({ config })}
                      />
                    </>
                  )}

                  <hr className="border-slate-100" />
                  
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

                  <div className="border border-slate-200 rounded-lg overflow-hidden mt-4">
                    <button 
                      className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-sm font-medium text-slate-700"
                      onClick={() => setAdvancedOpen(!advancedOpen)}
                    >
                      高级 JSON 模式
                      {advancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {advancedOpen && (
                      <div className="p-4 border-t border-slate-200 flex flex-col gap-4 bg-white">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">输入映射 JSON</label>
                          <textarea
                            className={`${inputClass} font-mono text-xs`}
                            key={`${selectedGraphNode.node_id}-input-${JSON.stringify(selectedGraphNode.input_mapping ?? {})}`}
                            rows={4}
                            defaultValue={JSON.stringify(selectedGraphNode.input_mapping ?? {}, null, 2)}
                            onBlur={(event) => updateJsonPatch('input_mapping', event.target.value, onUpdateNode, onConsoleTextChange)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">输出别名 JSON（高级兼容）</label>
                          <textarea
                            className={`${inputClass} font-mono text-xs`}
                            key={`${selectedGraphNode.node_id}-output-${JSON.stringify(selectedGraphNode.output_mapping ?? {})}`}
                            rows={4}
                            defaultValue={JSON.stringify(selectedGraphNode.output_mapping ?? {}, null, 2)}
                            onBlur={(event) => updateJsonPatch('output_mapping', event.target.value, onUpdateNode, onConsoleTextChange)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">配置 JSON</label>
                          <textarea
                            className={`${inputClass} font-mono text-xs`}
                            key={`${selectedGraphNode.node_id}-config`}
                            rows={4}
                            defaultValue={JSON.stringify(selectedGraphNode.config ?? {}, null, 2)}
                            onBlur={(event) => updateJsonPatch('config', event.target.value, onUpdateNode, onConsoleTextChange)}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <hr className="border-slate-100" />
                  
                  <div className="flex flex-col gap-4">
                    <h4 className="font-semibold text-sm">下游连线</h4>
                    <OutgoingEdges edges={selectedOutgoingEdges} onDeleteEdge={onDeleteEdge} />
                  </div>

                  <hr className="border-slate-100" />

                  <div className="flex flex-col gap-4">
                    <h4 className="font-semibold text-sm">可连接目标</h4>
                    <ConnectableTargets targets={connectableTargets} onConnectToNode={onConnectToNode} />
                  </div>
                </div>
              )}

              {activeTab === 'edges' && (
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-4">
                    <h4 className="font-semibold text-sm">下游连线</h4>
                    <OutgoingEdges edges={selectedOutgoingEdges} onDeleteEdge={onDeleteEdge} />
                  </div>
                  <hr className="border-slate-100" />
                  <div className="flex flex-col gap-4">
                    <h4 className="font-semibold text-sm">可连接目标</h4>
                    <ConnectableTargets targets={connectableTargets} onConnectToNode={onConnectToNode} />
                  </div>
                </div>
              )}

              {activeTab === 'parameters' && (
                <ParameterPreviewPanel
                  graph={graph}
                  datasetVersions={datasetVersions}
                  selectedDatasetVersion={selectedDatasetVersion}
                  onDatasetVersionChange={onDatasetVersionChange}
                />
              )}
            </div>
          </div>
        )}
        {activeTab !== 'console' && !selectedGraphNode && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg text-sm text-center">
            {selectedEdgeId ? `当前选中连线：${selectedEdgeId}` : '请选择节点以编辑属性'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutgoingEdges({ edges, onDeleteEdge }: { edges: Edge[]; onDeleteEdge: (edgeId: string) => void }) {
  if (!edges.length) {
    return <p className="text-slate-500 text-sm">当前节点暂无下游连线。</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {edges.map((edge) => {
        const id = edge.id || edgeId(edge.source, edge.target);
        return (
          <Button key={id} variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 w-full justify-start h-8 text-xs" onClick={() => onDeleteEdge(id)}>
            <Trash2 className="w-3.5 h-3.5 mr-2" /> 删除连线 {edge.source} -&gt; {edge.target}
          </Button>
        );
      })}
    </div>
  );
}

function ConnectableTargets({ targets, onConnectToNode }: { targets: FlowNode[]; onConnectToNode: (nodeId: string) => void }) {
  if (!targets.length) {
    return <p className="text-slate-500 text-sm">没有更多可连接目标。</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {targets.map((node) => (
        <Button key={node.id} variant="outline" className="w-full justify-start h-8 text-xs bg-white" onClick={() => onConnectToNode(node.id)}>
          <Plus className="w-3.5 h-3.5 mr-2" /> 连接到 {node.id}
        </Button>
      ))}
    </div>
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
