import {
  Share2,
  Save,
  Rocket
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  MarkerType,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '../components/ui/Button';

import { ApiError, api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { DatasetVersion, GraphValidationResult, SkillManifest, WorkflowGraph, WorkflowGraphNode } from '../types';
import { getLayoutedElements } from './workflowDesigner/Layout';
import {
  buildAvailableFieldPaths,
  buildWorkflowGraph,
  edgeId,
  formatNodeLabel,
  graphNodeToFlowNode,
  graphToEdges,
  graphToNodes,
  nodeTypeLabel,
  validateWorkflowGraphDraft,
  type FlowNode,
} from './workflowDesigner/graphModel';
import { SkillDetailDrawer } from './workflowDesigner/SkillDetailDrawer';
import { SkillPalettePanel } from './workflowDesigner/SkillPalettePanel';
import { WorkflowCanvasPanel } from './workflowDesigner/WorkflowCanvasPanel';
import { WorkflowConsolePanel } from './workflowDesigner/WorkflowConsolePanel';
import { WorkflowDraftLoaderPanel } from './workflowDesigner/WorkflowDraftLoaderPanel';
import { WorkflowInspectorPanel } from './workflowDesigner/WorkflowInspectorPanel';
import { InlineIssueSummary, validationErrorsFromResult } from './workflowDesigner/WorkflowIssuePanels';

export function WorkflowDesignerPage() {
  return (
    <ReactFlowProvider>
      <WorkflowDesignerContent />
    </ReactFlowProvider>
  );
}

function WorkflowDesignerContent() {
  const defaultGraph = createBlankWorkflowGraph('未命名 Workflow');
  const navigate = useNavigate();
  const { draftId: routeDraftId } = useParams();
  const queryClient = useQueryClient();
  const loadedRouteDraftId = useRef<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(graphToNodes(defaultGraph));
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphToEdges(defaultGraph));
  const [workflowName, setWorkflowName] = useState(defaultGraph.name);
  const workflowNameRef = useRef(defaultGraph.name);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(defaultGraph.nodes[0]?.node_id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedDatasetVersion, setSelectedDatasetVersion] = useState<string | null>(null);
  const [sampleSize, setSampleSize] = useState(1);
  const [consoleResult, setConsoleResult] = useState<GraphValidationResult | Record<string, unknown> | null>(null);
  const [consoleText, setConsoleText] = useState('等待校验。推荐先选择模板或草稿，再检查字段映射。');
  const [consoleTab, setConsoleTab] = useState('summary');
  const [publishNotice, setPublishNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string; description?: string; versionId?: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [datasetFieldSearch, setDatasetFieldSearch] = useState('');
  const [activePaletteSkill, setActivePaletteSkill] = useState<SkillManifest | null>(null);
  const [historyPast, setHistoryPast] = useState<WorkflowGraph[]>([]);
  const [historyFuture, setHistoryFuture] = useState<WorkflowGraph[]>([]);

  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const templatesQuery = useQuery({ queryKey: ['workflow-templates'], queryFn: api.templates });
  const draftsQuery = useQuery({ queryKey: ['workflow-drafts'], queryFn: () => api.workflowDrafts() });
  const routeDraftQuery = useQuery({
    queryKey: ['workflow-draft', routeDraftId],
    queryFn: () => api.workflowDraft(routeDraftId ?? ''),
    enabled: Boolean(routeDraftId),
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  const modelConnectionsQuery = useQuery({ queryKey: ['model-gateway-connections'], queryFn: api.modelGatewayConnections });
  const workflowDrafts = Array.isArray(draftsQuery.data) ? draftsQuery.data : [];
  const workflowVersions = Array.isArray(workflowsQuery.data) ? workflowsQuery.data : [];
  const workflowTemplates = Array.isArray(templatesQuery.data) ? templatesQuery.data : [];
  const datasets = Array.isArray(datasetsQuery.data) ? datasetsQuery.data : [];
  const modelConnections = Array.isArray(modelConnectionsQuery.data) ? modelConnectionsQuery.data : [];

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
        loadGraph({ ...routeDraftQuery.data.graph, name: routeDraftQuery.data.name }, routeDraftQuery.data.draft_id, routeDraftQuery.data.updated_at);
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

  const skills = Array.isArray(skillsQuery.data) ? skillsQuery.data : [];
  const datasetVersions = useMemo(
    () => datasets.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))),
    [datasets],
  );
  const selectedDataset = datasetVersions.find((item) => item.version.version_id === selectedDatasetVersion)?.version ?? null;
  const graph = useMemo(() => buildWorkflowGraph(workflowName, nodes, edges), [workflowName, nodes, edges]);
  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedGraphNode = selectedNode?.data.graphNode ?? null;
  const selectedSkill = selectedGraphNode?.skill_ref ? skills.find((skill) => skill.skill_id === selectedGraphNode.skill_ref) ?? null : null;
  const fieldPathOptions = useMemo(() => buildAvailableFieldPaths(selectedDataset, graph, selectedGraphNode?.node_id, skills), [selectedDataset, graph, selectedGraphNode?.node_id, skills]);
  const datasetFieldRows = useMemo(() => buildDatasetFieldRows(selectedDataset), [selectedDataset]);
  const filteredDatasetFieldRows = useMemo(() => filterDatasetFieldRows(datasetFieldRows, datasetFieldSearch), [datasetFieldRows, datasetFieldSearch]);
  const paletteSkills = useMemo(() => searchSkills(skills, skillSearch).slice(0, skillSearch.trim() ? 20 : 5), [skillSearch, skills]);
  const validationErrors = useMemo(() => validationErrorsFromResult(consoleResult), [consoleResult]);
  const selectedNodeIssues = useMemo(() => validationErrors.filter((issue) => issue.node_id === selectedNodeId), [validationErrors, selectedNodeId]);
  const selectedOutgoingEdges = selectedNodeId ? edges.filter((edge) => edge.source === selectedNodeId) : [];
  const connectableTargets = selectedNodeId
    ? nodes.filter((node) => node.id !== selectedNodeId && !selectedOutgoingEdges.some((edge) => edge.target === node.id))
    : [];

  const validateMutation = useMutation({
    mutationFn: () => api.validateGraph(graph, selectedDataset?.preview[0] ?? { question: '什么是 AegisQA?', reference: 'AegisQA' }),
    onSuccess: (result) => {
      setConsoleResult(result);
      setConsoleText(result.ok ? '校验通过：DAG 无环，连线和字段映射满足发布要求。' : '校验失败：请查看错误列表并修正节点配置。');
      setConsoleTab(result.ok ? 'summary' : 'issues');
      if (!result.ok) focusFirstIssueNode(result.errors);
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : '校验请求失败';
      setConsoleText(msg);
      setPublishNotice({ type: 'error', message: '校验失败', description: msg });
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: () => {
      const currentName = workflowNameRef.current;
      const currentGraph = buildWorkflowGraph(currentName, nodesRef.current, edgesRef.current);
      return draftId ? api.updateWorkflowDraft(draftId, { name: currentName, graph: currentGraph }) : api.createWorkflowDraft({ name: currentName, graph: currentGraph });
    },
    onSuccess: async (draft) => {
      setDraftId(draft.draft_id);
      setLastSavedAt(draft.updated_at);
      setIsDirty(false);
      setConsoleResult(draft);
      setConsoleText(`草稿已保存：${draft.name}`);
      setPublishNotice({ type: 'success', message: `草稿已保存：${draft.name}` });
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : '保存失败';
      setConsoleText(`保存失败：${msg}`);
      setPublishNotice({ type: 'error', message: '保存失败', description: msg });
    },
  });

  const publishMutation = useMutation({
    mutationFn: publishCurrentWorkflow,
    onSuccess: async (workflow) => {
      setConsoleResult(workflow as unknown as Record<string, unknown>);
      setConsoleText(`发布成功：${workflow.version_id}`);
      setConsoleTab('summary');
      setPublishNotice({ type: 'success', message: `发布成功：${workflow.version_id}`, description: '已生成可用于创建任务的 Workflow 版本。', versionId: workflow.version_id });
      setIsDirty(false);
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
    onError: (error) => {
      const validation = validationResultFromApiError(error, graph);
      if (validation) {
        setConsoleResult(validation);
      }
      setConsoleTab('issues');
      setPublishNotice({ type: 'error', message: '发布失败，请查看错误与建议', description: formatApiError(error) });
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
      setConsoleTab('json');
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : '试运行失败';
      setConsoleText(`试运行失败：${msg}`);
      setPublishNotice({ type: 'error', message: '试运行失败', description: msg });
    },
  });

  function changeWorkflowName(nextName: string, markDirty = true) {
    workflowNameRef.current = nextName;
    setWorkflowName(nextName);
    if (markDirty) setIsDirty(true);
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

  function loadGraph(nextGraph: WorkflowGraph, nextDraftId: string | null = null, nextSavedAt: string | null = null) {
    changeWorkflowName(nextGraph.name, false);
    updateNodes(graphToNodes(nextGraph));
    updateEdges(graphToEdges(nextGraph));
    setSelectedNodeId(nextGraph.nodes[0]?.node_id ?? null);
    setSelectedEdgeId(null);
    setDraftId(nextDraftId);
    setHistoryPast([]);
    setHistoryFuture([]);
    setIsDirty(false);
    setLastSavedAt(nextSavedAt);
    setPublishNotice(null);
    setConsoleResult(nextGraph);
    setConsoleText(`已加载流程：${nextGraph.name}`);
  }

  function isWorkflowGraph(value: unknown): value is WorkflowGraph {
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
      output_mapping: defaultOutputMapping(skill, id),
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

  function loadSelectedWorkflow(value: string) {
    if (isDirty && !window.confirm('当前画布有未保存修改，加载其他 Workflow 会替换当前画布。是否继续？')) {
      return;
    }
    const [kind, id] = String(value).split(':', 2);
    if (kind === 'draft') {
      const draft = workflowDrafts.find((item) => item.draft_id === id);
      if (draft) loadGraph({ ...draft.graph, name: draft.name }, draft.draft_id, draft.updated_at);
    } else if (kind === 'workflow') {
      const workflow = workflowVersions.find((item) => item.version_id === id);
      if (workflow?.graph) loadGraph({ ...(workflow.graph as WorkflowGraph), name: workflow.name }, null);
    } else if (kind === 'template') {
      const template = workflowTemplates.find((item) => String(item.template_id) === id);
      const templateGraph = isWorkflowGraph(template?.graph) ? { ...template.graph, name: String(template?.name ?? `${id}_template`) } : createBlankWorkflowGraph(String(template?.name ?? `${id}_template`));
      loadGraph(templateGraph, null);
    }
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

  async function publishCurrentWorkflow() {
    const currentName = workflowNameRef.current.trim() || '未命名 Workflow';
    const currentGraph = buildWorkflowGraph(currentName, nodesRef.current, edgesRef.current);
    if (currentName !== workflowNameRef.current) {
      changeWorkflowName(currentName, false);
    }
    const localIssues = validateWorkflowGraphDraft(currentGraph);
    if (localIssues.length) {
      const localValidation = graphValidationFromDraftIssues(currentGraph, localIssues);
      setConsoleResult(localValidation);
      setConsoleTab('issues');
      throw new Error('发布前本地校验失败，请先修复错误与建议。');
    }

    const validation = await api.validateGraph(currentGraph, selectedDataset?.preview[0] ?? { question: '什么是 AegisQA?', reference: 'AegisQA' });
    setConsoleResult(validation);
    if (!validation.ok) {
      setConsoleTab('issues');
      throw new Error('发布前校验失败，请查看错误与建议。');
    }

    const draft = draftId
      ? await api.updateWorkflowDraft(draftId, { name: currentName, graph: currentGraph })
      : await api.createWorkflowDraft({ name: currentName, graph: currentGraph });
    setDraftId(draft.draft_id);
    setLastSavedAt(draft.updated_at);
    queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
    setIsDirty(false);
    return api.publishWorkflowDraft(draft.draft_id);
  }

  function autoLayout() {
    rememberGraph();
    const { nodes: layoutedNodes } = getLayoutedElements(nodesRef.current, edgesRef.current, {
      direction: 'LR',
      nodeWidth: 220,
      nodeHeight: 120,
      ranksep: 150,
      nodesep: 80,
    });
    updateNodes(layoutedNodes);
    setConsoleText('已自动布局：使用 dagre 算法按拓扑结构重新排列。');
  }

  function rememberGraph() {
    const snapshot = buildWorkflowGraph(workflowNameRef.current, nodesRef.current, edgesRef.current);
    setHistoryPast((current) => [...current.slice(-19), snapshot]);
    setHistoryFuture([]);
    setIsDirty(true);
    setPublishNotice(null);
  }

  function restoreGraphSnapshot(snapshot: WorkflowGraph) {
    changeWorkflowName(snapshot.name, false);
    setIsDirty(true);
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

  function selectIssueNode(issue: { node_id?: string }) {
    if (issue.node_id && nodesRef.current.some((node) => node.id === issue.node_id)) {
      setSelectedNodeId(issue.node_id);
      setSelectedEdgeId(null);
    }
    setConsoleTab('issues');
  }

  function focusFirstIssueNode(issues: { node_id?: string }[]) {
    const firstNodeIssue = issues.find((issue) => issue.node_id && nodesRef.current.some((node) => node.id === issue.node_id));
    if (firstNodeIssue?.node_id) {
      setSelectedNodeId(firstNodeIssue.node_id);
      setSelectedEdgeId(null);
    }
  }

  const isWaitingForRouteDraft = Boolean(routeDraftId && !routeDraftQuery.data && routeDraftQuery.isFetching);
  if (isWaitingForRouteDraft) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          eyebrow="流程编排"
          title="Workflow 设计器"
          description="正在加载草稿快照，加载完成后再允许编辑，避免用户改动被后台刷新覆盖。"
        />
        <div className="bg-white border rounded-lg p-12 text-center text-slate-500 shadow-sm">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          正在加载 Workflow 草稿...
        </div>
      </div>
    );
  }

  if (routeDraftId && routeDraftQuery.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          eyebrow="流程编排"
          title="Workflow 设计器"
          description="草稿加载失败，请重试或返回列表。"
        />
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg flex flex-col gap-3">
          <span className="font-semibold">草稿加载失败</span>
          <span className="text-sm opacity-80">{formatApiError(routeDraftQuery.error)}</span>
          <div className="flex gap-2 mt-2">
            <button
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              onClick={() => routeDraftQuery.refetch()}
            >
              重试
            </button>
            <button
              className="px-4 py-2 bg-white border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
              onClick={() => navigate('/workflows')}
            >
              返回列表
            </button>
            <button
              className="px-4 py-2 bg-white border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
              onClick={() => navigate('/workflows/designer')}
            >
              新建草稿
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 font-sans">
      <header className="h-14 border-b bg-white flex items-center justify-between px-4 flex-shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-bold text-slate-800">Workflow 设计器</h1>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-md ${draftId ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
            草稿：{draftId ?? '未保存'}
          </span>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-md ${isDirty ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {isDirty ? '有修改' : '已保存'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {selectedDataset ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-emerald-100 text-emerald-700 border border-emerald-200">
              可试运行
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-amber-100 text-amber-700 border border-amber-200">
              无映射预览集
            </span>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => saveDraftMutation.mutate()} 
            disabled={saveDraftMutation.isPending}
            className="flex items-center gap-1.5 font-medium"
          >
            <Save className="w-4 h-4" /> 保存
          </Button>
          <Button 
            variant="default" 
            size="sm" 
            onClick={() => publishMutation.mutate()} 
            disabled={publishMutation.isPending}
            className="flex items-center gap-1.5 font-medium bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Rocket className="w-4 h-4" /> 发布
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/workflows')}
            className="font-medium"
          >
            退出
          </Button>
        </div>
      </header>

      {(publishNotice || validationErrors.length > 0) && (
        <div className="flex-shrink-0 z-10">
          {publishNotice && (
            <div className={`p-3 text-sm flex items-start gap-3 relative ${publishNotice.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-200' : 'bg-red-50 text-red-800 border-b border-red-200'}`}>
              <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="font-semibold">{publishNotice.message}</span>
                {publishNotice.description && <span>{publishNotice.description}</span>}
                {publishNotice.type === 'success' && (
                  <Button size="sm" variant="default" className="h-6 text-xs px-2 mt-1 sm:mt-0" onClick={() => navigate('/runs')}>去创建任务</Button>
                )}
              </div>
              <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setPublishNotice(null)}>&times;</button>
            </div>
          )}
          {validationErrors.length > 0 && (
            <div className="px-4 py-2 bg-white border-b border-slate-200">
              <InlineIssueSummary issues={validationErrors} onSelectNode={selectIssueNode} />
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-slate-200 bg-white z-10 shadow-sm relative z-20">
          <SkillPalettePanel
            skills={paletteSkills}
            skillSearch={skillSearch}
            onSkillSearchChange={setSkillSearch}
            onAddSkill={addSkillNode}
            onShowSkill={setActivePaletteSkill}
            onAddStructureNode={addStructureNode}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 relative z-0">
          <WorkflowDraftLoaderPanel
            workflowDrafts={workflowDrafts}
            workflowVersions={workflowVersions}
            workflowTemplates={workflowTemplates}
            datasetVersions={datasetVersions}
            selectedDatasetVersion={selectedDatasetVersion}
            selectedDataset={selectedDataset}
            sampleSize={sampleSize}
            workflowName={workflowName}
            datasetFieldSearch={datasetFieldSearch}
            datasetFieldRows={datasetFieldRows}
            filteredDatasetFieldRows={filteredDatasetFieldRows}
            onLoadWorkflow={loadSelectedWorkflow}
            onDatasetVersionChange={setSelectedDatasetVersion}
            onSampleSizeChange={setSampleSize}
            onWorkflowNameChange={changeWorkflowName}
            onDatasetFieldSearchChange={setDatasetFieldSearch}
          />
          <WorkflowCanvasPanel
            nodes={nodes}
            edges={edges}
            canUndo={Boolean(historyPast.length)}
            canRedo={Boolean(historyFuture.length)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(connection: Connection) => {
              // 防止重复连线
              const source = connection.source ?? '';
              const target = connection.target ?? '';
              if (source && target) {
                const exists = edges.some(e => e.source === source && e.target === target);
                if (exists) return;
              }
              rememberGraph();
              updateEdges((current) => addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, current));
            }}
            onNodeSelect={(nodeId) => {
              setSelectedNodeId(nodeId);
              setSelectedEdgeId(null);
            }}
            onEdgeSelect={(edgeIdValue) => {
              setSelectedEdgeId(edgeIdValue);
              setSelectedNodeId(null);
            }}
            onUndo={undoGraph}
            onRedo={redoGraph}
            onAutoLayout={autoLayout}
            onDeleteSelected={deleteSelected}
          />
        </div>

        <div className="w-[360px] flex-shrink-0 flex flex-col bg-white border-l border-slate-200 shadow-sm z-10">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <WorkflowInspectorPanel
              selectedGraphNode={selectedGraphNode}
              selectedEdgeId={selectedEdgeId}
              selectedNodeIssues={selectedNodeIssues}
              selectedSkill={selectedSkill}
              skills={skills}
              modelConnections={modelConnections}
              fieldPathOptions={fieldPathOptions}
              selectedOutgoingEdges={selectedOutgoingEdges}
              connectableTargets={connectableTargets}
              graph={graph}
              datasetVersions={datasetVersions}
              selectedDatasetVersion={selectedDatasetVersion}
              onDatasetVersionChange={setSelectedDatasetVersion}
              onDeleteSelected={deleteSelected}
              onAutoLayout={autoLayout}
              onDeleteEdge={deleteEdgeById}
              onConnectToNode={connectSelectedNodeTo}
              onUpdateNode={updateSelectedNode}
              onUpdateAggregatorStrategy={updateAggregatorStrategy}
              onConsoleTextChange={setConsoleText}
            />
          </div>
          <div className="h-[250px] flex-shrink-0 border-t border-slate-200">
            <WorkflowConsolePanel
              graph={graph}
              selectedDataset={selectedDataset}
              consoleTab={consoleTab}
              consoleText={consoleText}
              consoleResult={consoleResult}
              validateLoading={validateMutation.isPending}
              dryRunLoading={dryRunMutation.isPending}
              onConsoleTabChange={setConsoleTab}
              onValidate={() => validateMutation.mutate()}
              onDryRun={() => dryRunMutation.mutate()}
            />
          </div>
        </div>
      </div>

      <SkillDetailDrawer skill={activePaletteSkill} onClose={() => setActivePaletteSkill(null)} />
    </div>
  );
}

function createBlankWorkflowGraph(name: string): WorkflowGraph {
  return {
    name,
    nodes: [
      {
        node_id: 'source',
        node_type: 'source',
        label: 'Source：数据集样本',
        input_mapping: {},
        output_mapping: {},
      },
      {
        node_id: 'output',
        node_type: 'output',
        label: 'Output：报告结果',
        input_mapping: {},
        output_mapping: {},
      },
    ],
    edges: [{ source: 'source', target: 'output' }],
  };
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

function defaultOutputMapping(skill: SkillManifest, nodeId: string): Record<string, string> {
  return Object.keys((skill.output_schema.properties ?? {}) as Record<string, unknown>).reduce<Record<string, string>>((mapping, field) => {
    mapping[field] = `${nodeId}.${field}`;
    return mapping;
  }, {});
}

function graphValidationFromDraftIssues(graph: WorkflowGraph, issues: ReturnType<typeof validateWorkflowGraphDraft>): GraphValidationResult {
  return {
    ok: false,
    errors: issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      node_id: issue.nodeId,
      details: issue.field ? { field: issue.field } : {},
    })),
    warnings: [],
    execution_levels: [],
    graph_tips: [],
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
  };
}

function buildDatasetFieldRows(dataset: DatasetVersion | null) {
  if (!dataset) return [];
  const preview = dataset.preview?.[0] ?? {};
  const paths = dataset.field_paths?.length ? dataset.field_paths : Object.keys(dataset.field_schema ?? {}).map((field) => `row.${field}`);
  return paths.map((path) => {
    const field = path.replace(/^row\./, '');
    return {
      path,
      type: dataset.field_schema?.[field] ?? 'unknown',
      example: preview[field],
    };
  });
}

function filterDatasetFieldRows(rows: ReturnType<typeof buildDatasetFieldRows>, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) => [row.path, row.type, row.example].some((value) => String(value ?? '').toLowerCase().includes(keyword)));
}

function searchSkills(skills: SkillManifest[], query: string): SkillManifest[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return [...skills].sort((left, right) => Number(right.enabled) - Number(left.enabled));
  }
  return skills
    .map((skill) => ({ skill, score: skillSearchScore(skill, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.skill);
}

function skillSearchScore(skill: SkillManifest, terms: string[]): number {
  const haystack = [
    skill.skill_id,
    skill.name,
    skill.description,
    skill.tags.join(' '),
    skill.scenarios.join(' '),
    JSON.stringify(skill.input_schema),
    JSON.stringify(skill.output_schema),
  ].join(' ').toLowerCase();
  return terms.reduce((score, term) => {
    if (!haystack.includes(term)) return score;
    if (skill.name.toLowerCase().includes(term) || skill.skill_id.toLowerCase().includes(term)) return score + 5;
    if (skill.description.toLowerCase().includes(term)) return score + 3;
    return score + 1;
  }, 0);
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
