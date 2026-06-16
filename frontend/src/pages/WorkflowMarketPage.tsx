import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Copy, Trash2, Edit3, Plus, Ban, Network } from 'lucide-react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/Dialog';
import type { WorkflowDraftRecord, WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode, WorkflowVersion } from '../types';

type WorkflowMarketRow = {
  key: string;
  name: string;
  type: '草稿' | '已发布';
  status: string;
  version: string;
  updated_at: string;
  draft?: WorkflowDraftRecord;
  workflow?: WorkflowVersion;
};

export function WorkflowMarketPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workflowQuery, setWorkflowQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  
  // For custom Popconfirm replacement
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  useEffect(() => {
    setCurrentPage(1);
  }, [workflowQuery, statusFilter]);

  const draftsStatus = statusFilter === 'deleted' ? 'deleted' : undefined;
  const draftsQuery = useQuery({ queryKey: ['workflow-drafts', draftsStatus ?? 'active'], queryFn: () => api.workflowDrafts(draftsStatus), refetchOnMount: 'always' });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const templatesQuery = useQuery({ queryKey: ['workflow-templates'], queryFn: api.templates });
  const workflowDrafts = Array.isArray(draftsQuery.data) ? draftsQuery.data : [];
  const workflowVersions = Array.isArray(workflowsQuery.data) ? workflowsQuery.data : [];
  const workflowTemplates = Array.isArray(templatesQuery.data) ? templatesQuery.data : [];
  
  const workflowRows = useMemo<WorkflowMarketRow[]>(() => {
    const rows: WorkflowMarketRow[] = [
      ...workflowDrafts.map((draft) => ({
        key: `draft-${draft.draft_id}`,
        name: draft.name,
        type: '草稿' as const,
        status: draft.status,
        version: '-',
        updated_at: draft.updated_at,
        draft,
      })),
      ...workflowVersions.map((workflow) => ({
        key: `workflow-${workflow.version_id}`,
        name: workflow.name,
        type: '已发布' as const,
        status: workflow.status,
        version: `v${workflow.version}`,
        updated_at: workflow.version_id,
        workflow,
      })),
    ];
    const query = workflowQuery.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (statusFilter === 'draft') return row.type === '草稿' && row.status !== 'deleted';
        if (statusFilter === 'published') return row.type === '已发布' && row.status !== 'archived';
        if (statusFilter === 'deleted') return row.type === '草稿' && row.status === 'deleted';
        if (statusFilter === 'archived') return row.type === '已发布' && row.status === 'archived';
        return row.status !== 'deleted';
      })
      .filter((row) => (query ? `${row.name} ${row.type} ${row.status}`.toLowerCase().includes(query) : true));
  }, [statusFilter, workflowDrafts, workflowQuery, workflowVersions]);

  const paginatedRows = useMemo(() => {
    return workflowRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [workflowRows, currentPage, pageSize]);

  const createDraftMutation = useMutation({
    mutationFn: (name: string) => {
      const finalName = name.trim() || '未命名 Workflow';
      return api.createWorkflowDraft({ name: finalName, graph: createBlankWorkflowGraph(finalName) });
    },
    onSuccess: async (draft) => {
      setIsCreateModalOpen(false);
      setNewWorkflowName('');
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
      navigate(`/workflows/designer/${draft.draft_id}`);
    },
  });
  const copyDraftMutation = useMutation({
    mutationFn: (draft: WorkflowDraftRecord) => api.createWorkflowDraft({ name: `${draft.name} 副本`, graph: draft.graph }),
    onSuccess: async (draft) => {
      setNotice(`Workflow 草稿已复制：${draft.name}`);
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
  });
  const copyPublishedMutation = useMutation({
    mutationFn: (workflow: WorkflowVersion) => {
      const name = `${workflow.name} 副本`;
      return api.createWorkflowDraft({ name, graph: graphFromWorkflowVersion(workflow, name) });
    },
    onSuccess: async (draft) => {
      setNotice(`已从发布版本复制为草稿：${draft.name}`);
      queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
  });
  const deleteDraftMutation = useMutation({
    mutationFn: (draftId: string) => api.deleteWorkflowDraft(draftId),
    onSuccess: async (draft) => {
      setNotice(`草稿已删除：${draft.name}。已发布 Workflow 和已有任务不受影响。`);
      setDraftToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
    },
  });
  const archiveWorkflowMutation = useMutation({
    mutationFn: (versionId: string) => api.archiveWorkflow(versionId),
    onSuccess: async (workflow) => {
      setNotice(`Workflow 已归档：${workflow.name} ${workflow.version_id}`);
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  function openDraft(draft: WorkflowDraftRecord) {
    queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
    navigate(`/workflows/designer/${draft.draft_id}`);
  }

  function linkedDraftForWorkflow(workflow: WorkflowVersion) {
    return workflowDrafts.find((draft) => draft.published_version_id === workflow.version_id && draft.status !== 'deleted');
  }

  function openPublished(workflow: WorkflowVersion) {
    const linkedDraft = linkedDraftForWorkflow(workflow);
    if (!linkedDraft) {
      setNotice('未找到该发布版本关联的原始草稿，不能直接编辑。请使用“复制为草稿”创建可编辑副本。');
      return;
    }
    openDraft(linkedDraft);
  }

  return (
    <section className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-6">
      <PageHeader
        eyebrow="流程资产"
        title="Workflow 资产市场"
        description="先选择或创建 Workflow，再进入画布编辑。已发布版本可直接用于创建任务。"
        primaryAction={
          <Button variant="default" onClick={() => setIsCreateModalOpen(true)} className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> 新建 Workflow
          </Button>
        }
      />

      {notice && (
        <div className="p-4 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-start gap-3">
          <div className="flex-1 text-sm font-medium">{notice}</div>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      )}

      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 Workflow</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-slate-500">填写后会同步写入草稿名称和 graph.name，进入画布后仍可继续修改。</p>
            <Input
              aria-label="新建 Workflow 名称"
              placeholder="例如：AP ASR 评测流程"
              value={newWorkflowName}
              onChange={(event) => setNewWorkflowName(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  createDraftMutation.mutate(newWorkflowName);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>取消</Button>
            <Button variant="default" disabled={createDraftMutation.isPending} onClick={() => createDraftMutation.mutate(newWorkflowName)}>
              {createDraftMutation.isPending ? '创建中...' : '确认创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Popconfirm alternative Dialog */}
      <Dialog open={draftToDelete !== null} onOpenChange={(open) => !open && setDraftToDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除草稿？</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600">删除后将无法恢复，确定要删除吗？</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftToDelete(null)}>取消</Button>
            <Button 
              className="bg-red-600 hover:bg-red-700 text-white border-transparent"
              disabled={deleteDraftMutation.isPending} 
              onClick={() => draftToDelete && deleteDraftMutation.mutate(draftToDelete)}
            >
              {deleteDraftMutation.isPending ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap justify-between items-center gap-4 mb-2">
        <div className="flex items-center gap-4 flex-wrap">
          <select
            aria-label="Workflow 状态筛选"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none w-32"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="deleted">已删除</option>
            <option value="archived">已归档</option>
          </select>
          <Input 
            placeholder="搜索 Workflow 名称" 
            className="w-72" 
            value={workflowQuery} 
            onChange={(event) => setWorkflowQuery(event.target.value)} 
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: { opacity: 1, transition: { staggerChildren: 0.05 } }
            }}
          >
            {workflowRows.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm bg-slate-50 rounded-2xl border border-slate-100">
                暂无 Workflow，点击右上角新建。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {paginatedRows.map((record) => (
                  <motion.div
                    key={record.key}
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
                    }}
                    className="h-full flex min-w-0"
                  >
                    <Card className="flex-1 flex flex-col group p-6 hover:shadow-lg transition-shadow liquid-glass min-w-0">
                      <div className="flex justify-between items-start mb-6 gap-4 w-full min-w-0">
                        <div className="flex items-center gap-3 group-hover:translate-x-1 transition-transform overflow-hidden min-w-0 flex-1">
                          <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-500 shadow-inner flex-shrink-0">
                            <Network className="w-6 h-6" />
                          </div>
                          <span className="text-lg font-bold text-slate-800 truncate" title={record.name}>{record.name}</span>
                        </div>
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full whitespace-nowrap ${record.type === '草稿' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {record.type}
                        </span>
                      </div>
                      
                      <div className="flex flex-col gap-1 w-full mb-6 text-sm font-medium text-slate-500 min-w-0">
                        <div className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg min-w-0 gap-2">
                          <span className="truncate flex-1">版本：{record.version}</span>
                          <span className="text-slate-700 truncate flex-shrink-0 max-w-[50%] text-right">{record.status}</span>
                        </div>
                      </div>

                      <div className="mt-auto pt-4 border-t border-slate-100 flex flex-wrap gap-2 min-w-0">
                        {record.draft && (
                          <>
                            <Button 
                              size="sm" 
                              variant="default" 
                              className="rounded-full shadow-sm flex items-center gap-1.5" 
                              disabled={record.status === 'deleted'} 
                              onClick={() => openDraft(record.draft!)}
                            >
                              <Edit3 className="w-3.5 h-3.5" /> 编辑草稿
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="rounded-full flex items-center gap-1.5" 
                              disabled={copyDraftMutation.isPending} 
                              onClick={() => copyDraftMutation.mutate(record.draft!)}
                            >
                              <Copy className="w-3.5 h-3.5" /> 克隆
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="rounded-full flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 hover:border-red-300 disabled:opacity-50" 
                              disabled={record.status === 'deleted' || deleteDraftMutation.isPending}
                              onClick={() => setDraftToDelete(record.draft!.draft_id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> 
                            </Button>
                          </>
                        )}
                        {record.workflow && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              className="rounded-full shadow-sm flex items-center gap-1.5"
                              disabled={draftsQuery.isLoading || !linkedDraftForWorkflow(record.workflow)}
                              onClick={() => openPublished(record.workflow!)}
                            >
                              <Edit3 className="w-3.5 h-3.5" /> 编辑草稿
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="rounded-full flex items-center gap-1.5" 
                              disabled={copyPublishedMutation.isPending} 
                              onClick={() => copyPublishedMutation.mutate(record.workflow!)}
                            >
                              <Copy className="w-3.5 h-3.5" /> 克隆版本
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="rounded-full flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 hover:border-red-300 disabled:opacity-50" 
                              disabled={record.status === 'archived' || archiveWorkflowMutation.isPending} 
                              onClick={() => archiveWorkflowMutation.mutate(record.workflow!.version_id)}
                            >
                              <Ban className="w-3.5 h-3.5" /> 
                            </Button>
                          </>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}

            {workflowRows.length > pageSize && (
              <div className="flex items-center justify-between mt-8 pt-4 border-t border-slate-200/50">
                <div className="text-sm text-slate-500 font-medium">
                  显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, workflowRows.length)} 条，共 {workflowRows.length} 条
                </div>
                <div className="flex items-center gap-1.5">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 rounded-full shadow-sm liquid-glass"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    上一页
                  </Button>
                  <div className="text-sm font-bold text-slate-700 px-3">
                    {currentPage} / {Math.ceil(workflowRows.length / pageSize)}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 rounded-full shadow-sm liquid-glass"
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(workflowRows.length / pageSize), p + 1))}
                    disabled={currentPage === Math.ceil(workflowRows.length / pageSize)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        <div className="xl:col-span-1 flex flex-col gap-4">
          <div className="mb-2">
            <h5 className="text-base font-bold text-slate-700 m-0">快速模板</h5>
            <p className="text-xs text-slate-500 mt-1">一键从预置结构创建新工作流</p>
          </div>
          
          <div className="flex flex-col gap-4 w-full">
            {workflowTemplates.map((template) => (
              <Card 
                key={String(template.template_id)}
                className="p-5 border-transparent hover:-translate-y-1 transition-transform hover:shadow-md liquid-glass min-w-0"
              >
                <div className="flex flex-col gap-3 w-full min-w-0">
                  <div className="flex items-center gap-2 min-w-0 w-full">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center flex-shrink-0">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span className="text-base font-bold text-slate-800 truncate flex-1" title={String(template.name)}>{String(template.name)}</span>
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-2 min-h-[40px] m-0" title={String(template.description ?? '')}>
                    {String(template.description ?? '')}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full rounded-full"
                    onClick={() => {
                      const name = String(template.name);
                      api.createWorkflowDraft({ name, graph: graphFromTemplate(template, name) }).then((draft) => {
                        queryClient.setQueryData(['workflow-draft', draft.draft_id], draft);
                        navigate(`/workflows/designer/${draft.draft_id}`);
                      });
                    }}
                  >
                    从样例创建
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
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

function graphFromTemplate(template: Record<string, unknown>, name: string): WorkflowGraph {
  if (isWorkflowGraph(template.graph)) {
    return { ...template.graph, name };
  }
  return createBlankWorkflowGraph(name);
}

function graphFromWorkflowVersion(workflow: WorkflowVersion, name: string): WorkflowGraph {
  if (isWorkflowGraph(workflow.graph)) {
    return { ...workflow.graph, name };
  }
  const stepNodes = (workflow.steps ?? []).map<WorkflowGraphNode>((step) => ({
    node_id: step.step_id,
    node_type: 'skill',
    label: step.step_id,
    skill_ref: step.skill_ref,
    input_mapping: step.input_mapping ?? {},
    output_mapping: step.output_mapping ?? {},
    config: step.config ?? {},
    cacheable: step.cacheable ?? false,
  }));
  if (!stepNodes.length) {
    return createBlankWorkflowGraph(name);
  }
  const nodes: WorkflowGraphNode[] = [
    {
      node_id: 'source',
      node_type: 'source',
      label: 'Source：数据集样本',
      input_mapping: {},
      output_mapping: {},
    },
    ...stepNodes,
    {
      node_id: 'output',
      node_type: 'output',
      label: 'Output：报告结果',
      input_mapping: {},
      output_mapping: {},
    },
  ];
  const edges: WorkflowGraphEdge[] = [
    { source: 'source', target: stepNodes[0].node_id },
    ...stepNodes.slice(0, -1).map((node, index) => ({ source: node.node_id, target: stepNodes[index + 1].node_id })),
    { source: stepNodes[stepNodes.length - 1].node_id, target: 'output' },
  ];
  return { name, nodes, edges };
}

function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (!value || typeof value !== 'object') return false;
  const graph = value as Partial<WorkflowGraph>;
  return typeof graph.name === 'string' && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}
