import {
  ApiOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RedoOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from '@xyflow/react';
import { Alert, Button, Card, Col, Divider, Form, Input, InputNumber, Row, Segmented, Select, Space, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError, api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { demoSkills, demoWorkflowGraph } from '../data/demo';
import type { DatasetVersion, GraphValidationResult, SkillManifest, WorkflowGraph, WorkflowGraphNode } from '../types';
import { FieldMappingEditor } from './workflowDesigner/FieldMappingEditor';
import {
  buildAvailableFieldPaths,
  buildWorkflowGraph,
  edgeId,
  formatNodeLabel,
  graphNodeToFlowNode,
  graphToEdges,
  graphToNodes,
  nodeTypeLabel,
  paletteNodeTypes,
  parseJsonObjectField,
  type FlowNode,
} from './workflowDesigner/graphModel';
import { ParameterPreviewPanel } from './workflowDesigner/ParameterPreviewPanel';
import { SkillConfigEditor } from './workflowDesigner/SkillConfigEditor';

export function WorkflowDesignerPage() {
  return (
    <ReactFlowProvider>
      <WorkflowDesignerContent />
    </ReactFlowProvider>
  );
}

function WorkflowDesignerContent() {
  const navigate = useNavigate();
  const { draftId: routeDraftId } = useParams();
  const queryClient = useQueryClient();
  const loadedRouteDraftId = useRef<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(graphToNodes(demoWorkflowGraph));
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphToEdges(demoWorkflowGraph));
  const [workflowName, setWorkflowName] = useState(demoWorkflowGraph.name);
  const workflowNameRef = useRef(demoWorkflowGraph.name);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(demoWorkflowGraph.nodes[0]?.node_id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedDatasetVersion, setSelectedDatasetVersion] = useState<string | null>(null);
  const [sampleSize, setSampleSize] = useState(1);
  const [consoleResult, setConsoleResult] = useState<GraphValidationResult | Record<string, unknown> | null>(null);
  const [consoleText, setConsoleText] = useState('等待校验。推荐先选择模板或草稿，再检查字段映射。');
  const [historyPast, setHistoryPast] = useState<WorkflowGraph[]>([]);
  const [historyFuture, setHistoryFuture] = useState<WorkflowGraph[]>([]);

  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const templatesQuery = useQuery({ queryKey: ['workflow-templates'], queryFn: api.templates });
  const draftsQuery = useQuery({ queryKey: ['workflow-drafts'], queryFn: api.workflowDrafts });
  const routeDraftQuery = useQuery({
    queryKey: ['workflow-draft', routeDraftId],
    queryFn: () => api.workflowDraft(routeDraftId ?? ''),
    enabled: Boolean(routeDraftId),
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });

  useEffect(() => {
    workflowNameRef.current = workflowName;
  }, [workflowName]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (!routeDraftId) {
      loadedRouteDraftId.current = null;
      return;
    }
    if (loadedRouteDraftId.current === routeDraftId) return;
    if (routeDraftQuery.data) {
      loadedRouteDraftId.current = routeDraftId;
      if (isWorkflowGraph(routeDraftQuery.data.graph)) {
        loadGraph(routeDraftQuery.data.graph, routeDraftQuery.data.draft_id);
        return;
      }
      setConsoleText('草稿加载失败：后端返回的 Workflow Graph 结构不完整，请从 Workflow 市场重新打开或复制草稿。');
    }
  }, [routeDraftId, routeDraftQuery.data, routeDraftQuery.isFetching]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isEditingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (isEditingText || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (!selectedNodeId && !selectedEdgeId) return;
      event.preventDefault();
      deleteSelected();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, selectedEdgeId, nodes, edges, workflowName]);

  const skills = skillsQuery.data?.length ? skillsQuery.data : demoSkills;
  const datasetVersions = useMemo(
    () => datasetsQuery.data?.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))) ?? [],
    [datasetsQuery.data],
  );
  const selectedDataset = datasetVersions.find((item) => item.version.version_id === selectedDatasetVersion)?.version ?? null;
  const graph = useMemo(() => buildWorkflowGraph(workflowName, nodes, edges), [workflowName, nodes, edges]);
  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedGraphNode = selectedNode?.data.graphNode ?? null;
  const selectedSkill = selectedGraphNode?.skill_ref ? skills.find((skill) => skill.skill_id === selectedGraphNode.skill_ref) ?? null : null;
  const fieldPathOptions = useMemo(() => buildAvailableFieldPaths(selectedDataset, graph, selectedGraphNode?.node_id), [selectedDataset, graph, selectedGraphNode?.node_id]);
  const selectedOutgoingEdges = selectedNodeId ? edges.filter((edge) => edge.source === selectedNodeId) : [];
  const connectableTargets = selectedNodeId
    ? nodes.filter((node) => node.id !== selectedNodeId && !selectedOutgoingEdges.some((edge) => edge.target === node.id))
    : [];

  const validateMutation = useMutation({
    mutationFn: () => api.validateGraph(graph, selectedDataset?.preview[0] ?? { question: '什么是 AegisQA?', reference: 'AegisQA' }),
    onSuccess: (result) => {
      setConsoleResult(result);
      setConsoleText(result.ok ? '校验通过：DAG 无环，连线和字段映射满足发布要求。' : '校验失败：请查看错误列表并修正节点配置。');
    },
    onError: (error) => setConsoleText(error instanceof Error ? error.message : '校验请求失败'),
  });

  const saveDraftMutation = useMutation({
    mutationFn: () => {
      const currentName = workflowNameRef.current;
      const currentGraph = buildWorkflowGraph(currentName, nodesRef.current, edgesRef.current);
      return draftId ? api.updateWorkflowDraft(draftId, { name: currentName, graph: currentGraph }) : api.createWorkflowDraft({ name: currentName, graph: currentGraph });
    },
    onSuccess: async (draft) => {
      setDraftId(draft.draft_id);
      setConsoleResult(draft);
      setConsoleText(`草稿已保存：${draft.name}`);
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
      navigate('/workflows');
    },
    onError: (error) => setConsoleText(error instanceof Error ? `保存失败：${error.message}` : '保存失败'),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.publishGraph(graph),
    onSuccess: async (workflow) => {
      setConsoleResult(workflow as unknown as Record<string, unknown>);
      setConsoleText(`发布成功：${workflow.version_id}`);
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (error) => {
      const validation = validationResultFromApiError(error, graph);
      if (validation) {
        setConsoleResult(validation);
      }
      setConsoleText(`发布失败：${formatApiError(error)}`);
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: () => {
      if (!selectedDataset) {
        throw new Error('请先选择数据集版本，再执行试运行。');
      }
      return api.dryRunGraph({
        graph,
        dataset_id: selectedDataset.dataset_id,
        dataset_version: selectedDataset.version,
        sample_size: sampleSize,
      });
    },
    onSuccess: (run) => {
      setConsoleResult(run as unknown as Record<string, unknown>);
      setConsoleText(`试运行完成：${run.run_id}，队列消息只携带 item_id。`);
    },
    onError: (error) => setConsoleText(error instanceof Error ? `试运行失败：${error.message}` : '试运行失败'),
  });

  function changeWorkflowName(nextName: string) {
    workflowNameRef.current = nextName;
    setWorkflowName(nextName);
  }

  function updateNodes(updater: FlowNode[] | ((current: FlowNode[]) => FlowNode[])) {
    const nextNodes = typeof updater === 'function' ? updater(nodesRef.current) : updater;
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  }

  function updateEdges(updater: Edge[] | ((current: Edge[]) => Edge[])) {
    const nextEdges = typeof updater === 'function' ? updater(edgesRef.current) : updater;
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }

  function loadGraph(nextGraph: WorkflowGraph, nextDraftId: string | null = null) {
    changeWorkflowName(nextGraph.name);
    updateNodes(graphToNodes(nextGraph));
    updateEdges(graphToEdges(nextGraph));
    setSelectedNodeId(nextGraph.nodes[0]?.node_id ?? null);
    setSelectedEdgeId(null);
    setDraftId(nextDraftId);
    setHistoryPast([]);
    setHistoryFuture([]);
    setConsoleResult(nextGraph);
    setConsoleText(`已加载流程：${nextGraph.name}`);
  }

  function isWorkflowGraph(value: unknown): value is WorkflowGraph {
    // 路由深链可能遇到旧草稿、缓存脏数据或异常 API 响应；这里先拦截，避免整个画布白屏。
    if (!value || typeof value !== 'object') return false;
    const graph = value as Partial<WorkflowGraph>;
    return typeof graph.name === 'string' && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
  }

  function addSkillNode(skill: SkillManifest) {
    rememberGraph();
    const id = uniqueNodeId(skill.skill_id.split('@')[0].replace('.', '_'), nodes);
    const graphNode: WorkflowGraphNode = {
      node_id: id,
      node_type: 'skill',
      label: skill.name,
      skill_ref: skill.skill_id,
      input_mapping: defaultInputMapping(skill),
      output_mapping: defaultOutputMapping(skill),
      config: skill.example_config,
      cacheable: skill.cacheable,
    };
    updateNodes((current) => [...current, graphNodeToFlowNode(graphNode, { x: 160 + current.length * 36, y: 120 + current.length * 28 })]);
    setSelectedNodeId(id);
  }

  function addStructureNode(nodeType: WorkflowGraphNode['node_type']) {
    rememberGraph();
    const id = uniqueNodeId(nodeType, nodes);
    const graphNode: WorkflowGraphNode = {
      node_id: id,
      node_type: nodeType,
      label: nodeTypeLabel[nodeType],
      input_mapping: {},
      output_mapping: {},
      config: {},
    };
    updateNodes((current) => [...current, graphNodeToFlowNode(graphNode, { x: 240 + current.length * 32, y: 180 + current.length * 24 })]);
    setSelectedNodeId(id);
  }

  function deleteSelected() {
    if (selectedNodeId) {
      rememberGraph();
      updateNodes((current) => current.filter((node) => node.id !== selectedNodeId));
      updateEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
      setSelectedNodeId(null);
      setConsoleText(`已删除节点：${selectedNodeId}`);
      return;
    }
    if (selectedEdgeId) {
      rememberGraph();
      updateEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      setConsoleText(`已删除连线：${selectedEdgeId}`);
      return;
    }
    setConsoleText('请先在画布中选择节点或连线，再执行删除。');
  }

  function deleteEdgeById(edgeIdValue: string) {
    rememberGraph();
    updateEdges((current) => current.filter((edge) => edge.id !== edgeIdValue));
    setSelectedEdgeId(null);
    setConsoleText(`已删除连线：${edgeIdValue}`);
  }

  function connectSelectedNodeTo(targetNodeId: string) {
    if (!selectedNodeId) return;
    const id = edgeId(selectedNodeId, targetNodeId);
    rememberGraph();
    updateEdges((current) => {
      if (current.some((edge) => (edge.id || edgeId(edge.source, edge.target)) === id)) {
        return current;
      }
      return addEdge({ id, source: selectedNodeId, target: targetNodeId, markerEnd: { type: MarkerType.ArrowClosed } }, current);
    });
    setSelectedEdgeId(null);
    setConsoleText(`已新增连线：${id}`);
  }

  function updateSelectedNode(patch: Partial<WorkflowGraphNode>) {
    if (!selectedNodeId) return;
    rememberGraph();
    updateNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedNodeId) return node;
        const nextGraphNode = { ...node.data.graphNode, ...patch };
        return { ...node, data: { label: formatNodeLabel(nextGraphNode), graphNode: nextGraphNode } };
      }),
    );
  }

  function updateAggregatorStrategy(strategy: string) {
    if (!selectedGraphNode) return;
    updateSelectedNode({ config: { ...(selectedGraphNode.config ?? {}), strategy } });
    setConsoleText(`聚合策略已更新：${strategy}`);
  }

  function autoLayout() {
    rememberGraph();
    updateNodes((current) =>
      current.map((node, index) => ({
        ...node,
        position: { x: 80 + (index % 4) * 240, y: 100 + Math.floor(index / 4) * 150 },
      })),
    );
    setConsoleText('已自动布局：节点按拓扑编辑顺序重新排列。');
  }

  function rememberGraph() {
    const snapshot = buildWorkflowGraph(workflowNameRef.current, nodesRef.current, edgesRef.current);
    setHistoryPast((current) => [...current.slice(-19), snapshot]);
    setHistoryFuture([]);
  }

  function restoreGraphSnapshot(snapshot: WorkflowGraph) {
    changeWorkflowName(snapshot.name);
    updateNodes(graphToNodes(snapshot));
    updateEdges(graphToEdges(snapshot));
    setSelectedNodeId(snapshot.nodes[0]?.node_id ?? null);
    setSelectedEdgeId(null);
    setConsoleResult(snapshot);
  }

  function undoGraph() {
    if (!historyPast.length) return;
    const current = buildWorkflowGraph(workflowNameRef.current, nodesRef.current, edgesRef.current);
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast((items) => items.slice(0, -1));
    setHistoryFuture((items) => [current, ...items].slice(0, 20));
    restoreGraphSnapshot(previous);
    setConsoleText('已撤销上一步画布操作。');
  }

  function redoGraph() {
    if (!historyFuture.length) return;
    const current = buildWorkflowGraph(workflowNameRef.current, nodesRef.current, edgesRef.current);
    const next = historyFuture[0];
    setHistoryFuture((items) => items.slice(1));
    setHistoryPast((items) => [...items.slice(-19), current]);
    restoreGraphSnapshot(next);
    setConsoleText('已重做上一步画布操作。');
  }

  const isWaitingForRouteDraft = Boolean(routeDraftId && !routeDraftQuery.data && routeDraftQuery.isFetching);
  if (isWaitingForRouteDraft) {
    return (
      <section className="page-stack">
        <PageHeader
          eyebrow="流程编排"
          title="Workflow 设计器"
          description="正在加载草稿快照，加载完成后再允许编辑，避免用户改动被后台刷新覆盖。"
        />
        <Card className="flat-card" loading title="正在加载 Workflow 草稿" />
      </section>
    );
  }

  if (routeDraftId && routeDraftQuery.isError) {
    return (
      <section className="page-stack">
        <PageHeader
          eyebrow="流程编排"
          title="Workflow 设计器"
          description="草稿加载失败，请回到 Workflow 市场重新打开或复制草稿。"
        />
        <Alert type="error" showIcon message="草稿加载失败" description={formatApiError(routeDraftQuery.error)} />
      </section>
    );
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="流程编排"
        title="Workflow 设计器"
        description="用可视化 DAG 把 Skill 组成评测流程，支持点对点、点对多、多对一、条件分支、Join 和 Aggregator。"
        primaryAction={
          <Space wrap>
            <Button icon={<SaveOutlined />} onClick={() => saveDraftMutation.mutate()} loading={saveDraftMutation.isPending}>保存草稿</Button>
            <Button icon={<CheckCircleOutlined />} onClick={() => validateMutation.mutate()} loading={validateMutation.isPending}>校验</Button>
            <Button icon={<PlayCircleOutlined />} onClick={() => dryRunMutation.mutate()} loading={dryRunMutation.isPending}>试运行</Button>
            <Button type="primary" icon={<DeploymentUnitOutlined />} onClick={() => publishMutation.mutate()} loading={publishMutation.isPending}>发布</Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        message="Workflow 使用规则"
        description="每条连线表示数据依赖；一个节点可以点对多连接多个下游；多个上游进入同一节点时，必须先通过 Join 或 Aggregator，避免隐式覆盖 context。"
      />

      <Card className="flat-card" title="流程选择与执行样本">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">当前 Workflow</Typography.Text>
            <Select
              aria-label="当前 Workflow"
              placeholder="选择草稿、已发布版本或模板"
              className="full-width-control"
              onChange={(value) => {
                const [kind, id] = String(value).split(':', 2);
                if (kind === 'draft') {
                  const draft = draftsQuery.data?.find((item) => item.draft_id === id);
                  if (draft) loadGraph(draft.graph, draft.draft_id);
                } else if (kind === 'workflow') {
                  const workflow = workflowsQuery.data?.find((item) => item.version_id === id);
                  if (workflow?.graph) loadGraph(workflow.graph as WorkflowGraph, null);
                } else if (kind === 'template') {
                  loadGraph({ ...demoWorkflowGraph, name: `${id}_template` }, null);
                }
              }}
              options={[
                ...(draftsQuery.data ?? []).map((draft) => ({ value: `draft:${draft.draft_id}`, label: `草稿：${draft.name}` })),
                ...(workflowsQuery.data ?? []).map((workflow) => ({ value: `workflow:${workflow.version_id}`, label: `已发布：${workflow.name} v${workflow.version}` })),
                ...(templatesQuery.data ?? []).map((template) => ({ value: `template:${String(template.template_id)}`, label: `模板：${String(template.name)}` })),
              ]}
            />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">试运行数据集</Typography.Text>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择 Dataset Version"
              className="full-width-control"
              value={selectedDatasetVersion}
              onChange={setSelectedDatasetVersion}
              options={datasetVersions.map(({ version }) => ({ value: version.version_id, label: `${version.name} v${version.version}` }))}
            />
          </Col>
          <Col xs={12} lg={4}>
            <Typography.Text type="secondary">样本数</Typography.Text>
            <InputNumber className="full-width-control" min={1} max={10} value={sampleSize} onChange={(value) => setSampleSize(value ?? 1)} />
          </Col>
          <Col xs={12} lg={4}>
            <Typography.Text type="secondary">流程名称</Typography.Text>
            <Input value={workflowName} onChange={(event) => changeWorkflowName(event.target.value)} />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]} className="designer-grid">
        <Col xs={24} xl={5}>
          <Card className="flat-card full-height" title="Skill Palette">
            <Space direction="vertical" className="drawer-stack">
              {skills.map((skill) => (
                <Button key={skill.skill_id} icon={<PlusOutlined />} onClick={() => addSkillNode(skill)} block>
                  {skill.name}
                </Button>
              ))}
            </Space>
            <Divider />
            <Typography.Text strong>结构节点</Typography.Text>
            <Space direction="vertical" className="drawer-stack node-help">
              {paletteNodeTypes.map((nodeType) => (
                <Button key={nodeType} icon={<BranchesOutlined />} onClick={() => addStructureNode(nodeType)} block>
                  新增 {nodeTypeLabel[nodeType]}
                </Button>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={13}>
          <Card
            className="flat-card canvas-card"
            title="DAG 画布"
            extra={
              <Space>
                <Button icon={<UndoOutlined />} disabled={!historyPast.length} onClick={undoGraph}>撤销</Button>
                <Button icon={<RedoOutlined />} disabled={!historyFuture.length} onClick={redoGraph}>重做</Button>
                <Button icon={<ApiOutlined />} onClick={autoLayout}>自动布局</Button>
                <Button icon={<DeleteOutlined />} danger onClick={deleteSelected}>删除选中</Button>
              </Space>
            }
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={(connection: Connection) => {
                rememberGraph();
                updateEdges((current) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, current));
              }}
              onNodeClick={(_, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
              }}
              fitView
            >
              <MiniMap pannable zoomable />
              <Controls />
              <Background />
            </ReactFlow>
          </Card>
        </Col>

        <Col xs={24} xl={6}>
          <Card className="flat-card full-height" title="节点 Inspector">
            {selectedGraphNode ? (
              <Tabs
                items={[
                  {
                    key: 'basic',
                    label: '基础配置',
                    children: (
                      <Space direction="vertical" className="drawer-stack">
                        <Typography.Text strong>节点工具栏</Typography.Text>
                        <Space wrap>
                          <Button danger icon={<DeleteOutlined />} onClick={deleteSelected}>
                            删除当前节点
                          </Button>
                          <Button icon={<ApiOutlined />} onClick={autoLayout}>
                            自动布局
                          </Button>
                        </Space>
                        <Divider />
                        <div>
                          <Typography.Text type="secondary">节点 ID</Typography.Text>
                          <Input value={selectedGraphNode.node_id} onChange={(event) => updateSelectedNode({ node_id: event.target.value })} />
                        </div>
                        <div>
                          <Typography.Text type="secondary">名称</Typography.Text>
                          <Input value={selectedGraphNode.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} />
                        </div>
                        <div>
                          <Typography.Text type="secondary">类型</Typography.Text>
                          <Select
                            value={selectedGraphNode.node_type}
                            className="full-width-control"
                            onChange={(node_type) => updateSelectedNode({ node_type })}
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
                            onChange={(skill_ref) => updateSelectedNode({ skill_ref })}
                            options={skills.map((skill) => ({ value: skill.skill_id, label: skill.name }))}
                          />
                        </div>
                        <div>
                          <Typography.Text type="secondary">条件表达式</Typography.Text>
                          <Input value={selectedGraphNode.condition} onChange={(event) => updateSelectedNode({ condition: event.target.value })} placeholder="例如 metrics.score > 0.6" />
                        </div>
                        {selectedGraphNode.node_type === 'aggregator' ? (
                          <div>
                            <Typography.Text type="secondary">聚合策略</Typography.Text>
                            <Segmented
                              block
                              value={String(selectedGraphNode.config?.strategy ?? 'majority_vote')}
                              onChange={(value) => updateAggregatorStrategy(String(value))}
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
                            <SkillConfigEditor
                              skill={selectedSkill}
                              value={selectedGraphNode.config ?? {}}
                              onChange={(config) => updateSelectedNode({ config })}
                            />
                          </>
                        ) : null}
                        <Divider />
                        <Typography.Text strong>字段映射</Typography.Text>
                        <FieldMappingEditor
                          title="输入字段映射"
                          value={selectedGraphNode.input_mapping ?? {}}
                          pathOptions={fieldPathOptions}
                          onChange={(input_mapping) => updateSelectedNode({ input_mapping })}
                          addButtonLabel="新增输入映射"
                        />
                        <FieldMappingEditor
                          title="输出字段映射"
                          value={selectedGraphNode.output_mapping ?? {}}
                          pathOptions={fieldPathOptions}
                          onChange={(output_mapping) => updateSelectedNode({ output_mapping })}
                          addButtonLabel="新增输出映射"
                        />
                        <Form layout="vertical">
                          <Form.Item label="输入映射 JSON">
                            <Input.TextArea
                              key={`${selectedGraphNode.node_id}-input-${JSON.stringify(selectedGraphNode.input_mapping ?? {})}`}
                              rows={4}
                              defaultValue={JSON.stringify(selectedGraphNode.input_mapping ?? {}, null, 2)}
                              onBlur={(event) => updateJsonPatch('input_mapping', event.target.value, updateSelectedNode, setConsoleText)}
                            />
                          </Form.Item>
                          <Form.Item label="输出映射 JSON">
                            <Input.TextArea
                              key={`${selectedGraphNode.node_id}-output-${JSON.stringify(selectedGraphNode.output_mapping ?? {})}`}
                              rows={4}
                              defaultValue={JSON.stringify(selectedGraphNode.output_mapping ?? {}, null, 2)}
                              onBlur={(event) => updateJsonPatch('output_mapping', event.target.value, updateSelectedNode, setConsoleText)}
                            />
                          </Form.Item>
                          <Form.Item label="配置 JSON">
                            <Input.TextArea
                              key={`${selectedGraphNode.node_id}-config`}
                              rows={4}
                              defaultValue={JSON.stringify(selectedGraphNode.config ?? {}, null, 2)}
                              onBlur={(event) => updateJsonPatch('config', event.target.value, updateSelectedNode, setConsoleText)}
                            />
                          </Form.Item>
                        </Form>
                        <Divider />
                        <Typography.Text strong>下游连线</Typography.Text>
                        {selectedOutgoingEdges.length ? (
                          <Space direction="vertical" className="drawer-stack">
                            {selectedOutgoingEdges.map((edge) => {
                              const id = edge.id || edgeId(edge.source, edge.target);
                              return (
                                <Button key={id} danger icon={<DeleteOutlined />} onClick={() => deleteEdgeById(id)}>
                                  删除连线 {edge.source} -&gt; {edge.target}
                                </Button>
                              );
                            })}
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">当前节点暂无下游连线。</Typography.Text>
                        )}
                        <Divider />
                        <Typography.Text strong>可连接目标</Typography.Text>
                        {connectableTargets.length ? (
                          <Space direction="vertical" className="drawer-stack">
                            {connectableTargets.map((node) => (
                              <Button key={node.id} icon={<PlusOutlined />} onClick={() => connectSelectedNodeTo(node.id)}>
                                连接到 {node.id}
                              </Button>
                            ))}
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">没有更多可连接目标。</Typography.Text>
                        )}
                      </Space>
                    ),
                  },
                  {
                    key: 'edges',
                    label: '连线',
                    children: (
                      <Space direction="vertical" className="drawer-stack">
                        <Typography.Text strong>下游连线</Typography.Text>
                        {selectedOutgoingEdges.length ? (
                          <Space direction="vertical" className="drawer-stack">
                            {selectedOutgoingEdges.map((edge) => {
                              const id = edge.id || edgeId(edge.source, edge.target);
                              return (
                                <Button key={id} danger icon={<DeleteOutlined />} onClick={() => deleteEdgeById(id)}>
                                  删除连线 {edge.source} -&gt; {edge.target}
                                </Button>
                              );
                            })}
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">当前节点暂无下游连线。</Typography.Text>
                        )}
                        <Divider />
                        <Typography.Text strong>可连接目标</Typography.Text>
                        {connectableTargets.length ? (
                          <Space direction="vertical" className="drawer-stack">
                            {connectableTargets.map((node) => (
                              <Button key={node.id} icon={<PlusOutlined />} onClick={() => connectSelectedNodeTo(node.id)}>
                                连接到 {node.id}
                              </Button>
                            ))}
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">没有更多可连接目标。</Typography.Text>
                        )}
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
                        onDatasetVersionChange={setSelectedDatasetVersion}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <Alert type="info" showIcon message={selectedEdgeId ? `当前选中连线：${selectedEdgeId}` : '请选择节点后编辑配置。'} />
            )}
          </Card>
        </Col>
      </Row>

      <Card className="flat-card" title="校验与试运行 Console">
        <Tabs
          items={[
            {
              key: 'summary',
              label: '结果',
              children: (
                <Space direction="vertical" className="drawer-stack">
                  <Typography.Text>{consoleText}</Typography.Text>
                  <Space wrap>
                    <Tag color="blue">点对多</Tag>
                    <Tag color="purple">多对一</Tag>
                    <Tag color="green">队列消息：仅 item_id</Tag>
                  </Space>
                </Space>
              ),
            },
            {
              key: 'issues',
              label: '错误与建议',
              children: <IssueList result={consoleResult} />,
            },
            {
              key: 'json',
              label: 'JSON',
              children: <pre><CodeOutlined /> {JSON.stringify(consoleResult ?? graph, null, 2)}</pre>,
            },
          ]}
        />
      </Card>
    </section>
  );
}

function uniqueNodeId(base: string, nodes: FlowNode[]): string {
  const normalized = base.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
  const existing = new Set(nodes.map((node) => node.id));
  let index = nodes.length + 1;
  let candidate = `${normalized}_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${normalized}_${index}`;
  }
  return candidate;
}

function defaultInputMapping(skill: SkillManifest): Record<string, string> {
  if (skill.skill_id.includes('llm.call')) {
    return { prompt: 'row.question' };
  }
  if (skill.skill_id.includes('llm.judge')) {
    return { question: 'row.question', answer: 'context.answer', reference: 'row.reference' };
  }
  return Object.keys((skill.input_schema.properties ?? {}) as Record<string, unknown>).reduce<Record<string, string>>((mapping, field) => {
    mapping[field] = `row.${field}`;
    return mapping;
  }, {});
}

function defaultOutputMapping(skill: SkillManifest): Record<string, string> {
  return Object.keys((skill.output_schema.properties ?? {}) as Record<string, unknown>).reduce<Record<string, string>>((mapping, field) => {
    mapping[field] = field === 'score' || field === 'tokens' ? `metrics.${field}` : `context.${field}`;
    return mapping;
  }, {});
}

function updateJsonPatch(
  field: 'input_mapping' | 'output_mapping' | 'config',
  value: string,
  updateSelectedNode: (patch: Partial<WorkflowGraphNode>) => void,
  setConsoleText: (text: string) => void,
) {
  const parsed = parseJsonObjectField(value, field);
  if (parsed.ok) {
    updateSelectedNode({ [field]: parsed.value });
  } else {
    setConsoleText(`JSON 解析失败：${parsed.issue.message}`);
  }
}

function validationResultFromApiError(error: unknown, graph: WorkflowGraph): GraphValidationResult | null {
  if (!(error instanceof ApiError) || !Array.isArray(error.details.errors)) {
    return null;
  }
  return {
    ok: false,
    errors: error.details.errors.map((issue) => {
      const payload = issue as Record<string, unknown>;
      return {
        code: String(payload.code ?? 'GRAPH_ERROR'),
        message: String(payload.message ?? 'Workflow Graph 校验失败'),
        node_id: typeof payload.node_id === 'string' ? payload.node_id : undefined,
        details: typeof payload.details === 'object' && payload.details ? (payload.details as Record<string, unknown>) : {},
      };
    }),
    warnings: [],
    execution_levels: [],
    graph_tips: [],
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
  };
}

function IssueList({ result }: { result: GraphValidationResult | Record<string, unknown> | null }) {
  if (!result || !('errors' in result)) {
    return <Typography.Text type="secondary">暂无校验结果。</Typography.Text>;
  }
  const validation = result as GraphValidationResult;
  if (validation.ok) {
    return <Alert type="success" showIcon message="没有阻断问题" description="可以继续试运行或发布。" />;
  }
  return (
    <Space direction="vertical" className="drawer-stack">
      {validation.errors.map((error) => (
        <Alert key={`${error.code}-${error.node_id ?? error.message}`} type="error" showIcon message={error.code} description={error.message} />
      ))}
    </Space>
  );
}
