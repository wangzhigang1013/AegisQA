import { FileCheck, Check, RefreshCw, UserPlus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type Key } from 'react';

import { api, formatApiError } from '../api/client';
import { DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { AnnotationTask } from '../types';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/Dialog';
import { Input } from '../components/ui/Input';

export function AnnotationQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sourceTaskId, setSourceTaskId] = useState<string>('');
  const [reviewTask, setReviewTask] = useState<AnnotationTask | null>(null);
  const [assignTask, setAssignTask] = useState<AnnotationTask | null>(null);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const queuePageSize = 8;
  const [notice, setNotice] = useState<string | null>(null);
  
  // Form States
  const [reviewLabel, setReviewLabel] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewAddToGolden, setReviewAddToGolden] = useState(false);
  
  const [assignee, setAssignee] = useState('');
  
  const [bulkReviewLabel, setBulkReviewLabel] = useState('');
  const [bulkReviewNote, setBulkReviewNote] = useState('');
  const [bulkReviewAddToGolden, setBulkReviewAddToGolden] = useState(false);

  const queueQuery = useQuery({
    queryKey: ['annotation-queue', statusFilter, assigneeFilter, sourceTaskId, queuePage, queuePageSize],
    queryFn: () => api.annotationQueuePage({ 
      status: statusFilter || undefined, 
      assignee: assigneeFilter || undefined, 
      source_task_id: sourceTaskId || undefined, 
      page: queuePage, 
      pageSize: queuePageSize 
    }),
  });
  const tasksQuery = useQuery({ queryKey: ['tasks-all'], queryFn: () => api.tasksPage({ page: 1, pageSize: 100 }) });
  const candidatesQuery = useQuery({
    queryKey: ['annotation-candidates', sourceTaskId],
    queryFn: () => api.annotationCandidates({ source_task_id: sourceTaskId || undefined }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ task, nextAssignee }: { task: AnnotationTask; nextAssignee: string }) =>
      api.assignAnnotationTask(task.task_id, { assignee: nextAssignee }),
    onSuccess: async (task) => {
      setAssignTask(null);
      setAssignee('');
      setNotice(task.assignee === 'current_user' ? `样本已领取：${task.item_id}` : `样本已分派给：${task.assignee}`);
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
    },
    onError: (error) => setNotice(`分派失败：${formatApiError(error)}`),
  });

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!reviewTask) throw new Error('请选择需要审核的样本。');
      return api.reviewAnnotationTask(reviewTask.task_id, {
        human_label: reviewLabel,
        note: reviewNote,
        add_to_golden: Boolean(reviewAddToGolden),
      });
    },
    onSuccess: async (task) => {
      const added = Boolean(task.review?.add_to_golden);
      setReviewTask(null);
      setNotice(added ? '审核已提交，并回流 Golden Dataset。' : '审核已提交。');
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
    },
    onError: (error) => setNotice(`审核失败：${formatApiError(error)}`),
  });

  const bulkReviewMutation = useMutation({
    mutationFn: () =>
      api.bulkReviewAnnotationTasks({
        task_ids: selectedRowKeys.map(String),
        human_label: bulkReviewLabel,
        note: bulkReviewNote,
        add_to_golden: Boolean(bulkReviewAddToGolden),
      }),
    onSuccess: async (result) => {
      setBulkReviewOpen(false);
      setSelectedRowKeys([]);
      setNotice(`批量审核完成：${result.reviewed_count} 条，Golden ${result.candidate_summary.golden} / Assertion ${result.candidate_summary.assertion}。`);
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
      await queryClient.invalidateQueries({ queryKey: ['annotation-candidates'] });
    },
    onError: (error) => setNotice(`批量审核失败：${formatApiError(error)}`),
  });

  const dispatchMutation = useMutation({
    mutationFn: () =>
      api.dispatchAnnotationQueue({
        label_field: 'scene',
        sla_hours: 48,
        overdue_strategy: 'oldest_first',
        assignees: [
          { assignee: 'billing_reviewer', capacity: 5, labels: ['billing', 'payment'] },
          { assignee: 'policy_reviewer', capacity: 5, labels: ['policy', 'safety'] },
          { assignee: 'qa_owner', capacity: 10, labels: [] },
        ],
      }),
    onSuccess: async (result) => {
      setNotice(`自动分派完成：已分派 ${result.assigned_count} 条，跳过 ${result.skipped_count} 条。`);
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
    },
    onError: (error) => setNotice(`自动分派失败：${formatApiError(error)}`),
  });

  const candidateSummary = summarizeCandidates(candidatesQuery.data ?? []);
  const queueItems = queueQuery.data?.items ?? [];
  const queuePagination = queueQuery.data?.pagination;
  const queueSummary = queueQuery.data?.summary;

  function resetQueuePaging() {
    setQueuePage(1);
    setSelectedRowKeys([]);
  }

  function openReview(task: AnnotationTask) {
    setReviewTask(task);
    setReviewLabel('');
    setReviewNote('');
    setReviewAddToGolden(false);
  }

  function openAssign(task: AnnotationTask) {
    setAssignTask(task);
    setAssignee(task.assignee ?? '');
  }

  function toggleRowSelection(taskId: string) {
    if (selectedRowKeys.includes(taskId)) {
      setSelectedRowKeys(selectedRowKeys.filter(id => id !== taskId));
    } else {
      setSelectedRowKeys([...selectedRowKeys, taskId]);
    }
  }

  function toggleAllSelection() {
    const selectableKeys = queueItems.filter(item => item.status !== 'reviewed').map(item => item.task_id);
    if (selectedRowKeys.length === selectableKeys.length && selectableKeys.length > 0) {
      setSelectedRowKeys([]);
    } else {
      setSelectedRowKeys(selectableKeys);
    }
  }

  return (
    <section className="page-stack flex flex-col gap-8">
      <PageHeader
        eyebrow="人工复核"
        title="Annotation Queue 人工审核"
        description="把低分、失败或抽样样本分派给人工审核，审核结论可回流 Golden Dataset，支撑后续 Judge 审计和 Workflow 优化。"
      />

      {notice ? (
        <div className={`p-4 rounded-xl mb-4 border ${notice.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'} flex justify-between items-center`}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>筛选条件</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void queueQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> 刷新队列
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <select
              className="flex h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 min-w-[200px]"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                resetQueuePaging();
              }}
            >
              <option value="">按状态筛选 (全部)</option>
              <option value="pending">待领取</option>
              <option value="assigned">已分派</option>
              <option value="reviewed">已审核</option>
            </select>
            
            <Input
              className="min-w-[200px] w-auto"
              placeholder="按负责人筛选"
              value={assigneeFilter}
              onChange={(event) => {
                setAssigneeFilter(event.target.value);
                resetQueuePaging();
              }}
            />
            
            <select
              className="flex h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 min-w-[200px]"
              value={sourceTaskId}
              onChange={(e) => {
                setSourceTaskId(e.target.value);
                resetQueuePaging();
              }}
            >
              <option value="">按来源任务筛选 (全部)</option>
              {(tasksQuery.data?.items ?? []).map((task) => (
                <option key={task.task_id} value={task.task_id}>{task.name} / {task.status}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>候选资产</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
              Golden {candidateSummary.golden} / Assertion {candidateSummary.assertion}
            </span>
            <span className="text-slate-500 text-sm">
              候选资产来自已审核样本，后续可进入 Golden Dataset、Assertion DSL 或 CI Gate 建议。
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>负责人负载与 SLA</CardTitle>
          <Button variant="outline" size="sm" loading={dispatchMutation.isPending} onClick={() => dispatchMutation.mutate()}>
            <UserPlus className="mr-2 h-4 w-4" /> 自动分派
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
              待处理 {queueSummary?.total_open ?? queueItems.filter((item) => item.status !== 'reviewed').length}
            </span>
            <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-sm font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
              已分派 {queueSummary?.total_assigned ?? queueItems.filter((item) => item.assignee && item.status !== 'reviewed').length}
            </span>
            <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
              (queueSummary?.total_overdue ?? 0) > 0 ? 'bg-red-50 text-red-700 ring-red-600/10' : 'bg-green-50 text-green-700 ring-green-600/20'
            }`}>
              SLA超时 {queueSummary?.total_overdue ?? 0}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(queueSummary?.owners ?? summarizeOwners(queueItems)).map((owner) => (
              <span key={owner.assignee} className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                owner.overdue_count 
                  ? 'bg-red-50 text-red-700 ring-red-600/10' 
                  : owner.assignee === '未分派' 
                    ? 'bg-yellow-50 text-yellow-800 ring-yellow-600/20' 
                    : 'bg-blue-50 text-blue-700 ring-blue-700/10'
              }`}>
                {owner.assignee}：{owner.backlog} / SLA超时 {owner.overdue_count}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <PageSection
        title="审核队列"
        testId="annotation-queue-table-section"
      >
        <div className="flex justify-end mb-4">
          <Button disabled={!selectedRowKeys.length} onClick={() => {
            setBulkReviewLabel('');
            setBulkReviewNote('');
            setBulkReviewAddToGolden(false);
            setBulkReviewOpen(true);
          }}>
            <FileCheck className="mr-2 h-4 w-4" /> 批量审核
          </Button>
        </div>
        
        <DataTableShell testId="annotation-queue-table-shell">
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium w-12">
                      <input 
                        type="checkbox" 
                        className="rounded border-slate-300"
                        onChange={toggleAllSelection}
                        checked={selectedRowKeys.length > 0 && selectedRowKeys.length === queueItems.filter(i => i.status !== 'reviewed').length}
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">来源任务</th>
                    <th className="px-4 py-3 font-medium">样本</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">负责人</th>
                    <th className="px-4 py-3 font-medium">业务标签</th>
                    <th className="px-4 py-3 font-medium">SLA</th>
                    <th className="px-4 py-3 font-medium">优先级</th>
                    <th className="px-4 py-3 font-medium">原因</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queueItems.map((record) => (
                    <tr key={record.task_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-300"
                          disabled={record.status === 'reviewed'}
                          checked={selectedRowKeys.includes(record.task_id)}
                          onChange={() => toggleRowSelection(record.task_id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-700">{record.source_task_name || '-'}</td>
                      <td className="px-4 py-3"><code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-800">{record.item_id}</code></td>
                      <td className="px-4 py-3">{renderStatus(record.status)}</td>
                      <td className="px-4 py-3 text-slate-700">{record.assignee || '未分派'}</td>
                      <td className="px-4 py-3 text-slate-700">{record.business_label || '-'}</td>
                      <td className="px-4 py-3">{renderSla(record.sla_status, record.due_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                          record.priority === 'high' ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10' : 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-700/10'
                        }`}>
                          {record.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{record.reason}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={record.status === 'reviewed' || assignMutation.isPending}
                            onClick={() => assignMutation.mutate({ task: record, nextAssignee: 'current_user' })}
                          >
                            <UserPlus className="w-3 h-3 mr-1" /> 领取
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => openAssign(record)} 
                            disabled={record.status === 'reviewed'}
                          >
                            分派
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => openReview(record)}
                          >
                            <FileCheck className="w-3 h-3 mr-1" /> 审核
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {queueItems.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        {queueQuery.isLoading ? '加载中...' : '暂无数据'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="flex justify-between items-center p-4 text-sm text-slate-500 border-t border-slate-200">
              <button 
                disabled={queuePage <= 1}
                onClick={() => { setSelectedRowKeys([]); setQueuePage(p => p - 1); }}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-slate-50"
              >
                上一页
              </button>
              <span>第 {queuePage} 页</span>
              <button 
                disabled={queueItems.length < queuePageSize}
                onClick={() => { setSelectedRowKeys([]); setQueuePage(p => p + 1); }}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-slate-50"
              >
                下一页
              </button>
            </div>
          </div>
        </DataTableShell>
      </PageSection>

      <Dialog open={Boolean(reviewTask)} onOpenChange={(open) => !open && setReviewTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>审核样本</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="text-sm text-slate-500">样本：{reviewTask?.item_id}</div>
            <pre className="bg-slate-50 p-4 rounded-xl text-xs overflow-x-auto text-slate-800 border border-slate-100">
              {JSON.stringify(reviewTask?.payload ?? {}, null, 2)}
            </pre>
            <form onSubmit={(e) => { e.preventDefault(); reviewMutation.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">人工标签 <span className="text-red-500">*</span></label>
                <Input 
                  placeholder="例如：pass / fail" 
                  value={reviewLabel} 
                  onChange={(e) => setReviewLabel(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">审核说明</label>
                <textarea
                  className="flex w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
                  rows={3}
                  placeholder="说明误判原因、修复建议或需要补充的 Golden 信息。"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="add_to_golden"
                  className="rounded border-slate-300"
                  checked={reviewAddToGolden}
                  onChange={(e) => setReviewAddToGolden(e.target.checked)}
                />
                <label htmlFor="add_to_golden" className="text-sm text-slate-700">回流 Golden Dataset</label>
              </div>
              
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setReviewTask(null)}>取消</Button>
                <Button type="submit" disabled={!reviewLabel || reviewMutation.isPending}>
                  {reviewMutation.isPending ? '审核中...' : (
                    <>
                      <Check className="w-4 h-4 mr-2" /> 确认审核
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assignTask)} onOpenChange={(open) => !open && setAssignTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分派审核任务</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (assignTask && assignee) assignMutation.mutate({ task: assignTask, nextAssignee: assignee });
          }} className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">负责人 <span className="text-red-500">*</span></label>
              <Input 
                placeholder="例如：qa_owner" 
                value={assignee} 
                onChange={(e) => setAssignee(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssignTask(null)}>取消</Button>
              <Button type="submit" disabled={!assignee || assignMutation.isPending}>
                {assignMutation.isPending ? '分派中...' : '确认分派'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkReviewOpen} onOpenChange={setBulkReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量审核样本</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); bulkReviewMutation.mutate(); }} className="space-y-4 py-4">
            <p className="text-sm text-slate-500">
              已选择 {selectedRowKeys.length} 条样本。批量审核会保留 reviewer、reviewed_at 和来源任务，并按需生成 Golden/Assertion 候选资产。
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">批量人工标签 <span className="text-red-500">*</span></label>
              <Input 
                placeholder="批量标签，例如：pass / fail" 
                value={bulkReviewLabel} 
                onChange={(e) => setBulkReviewLabel(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">批量审核说明</label>
              <textarea
                className="flex w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
                rows={3}
                placeholder="说明这一批样本的共性问题或回流策略。"
                value={bulkReviewNote}
                onChange={(e) => setBulkReviewNote(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="bulk_add_to_golden"
                className="rounded border-slate-300"
                checked={bulkReviewAddToGolden}
                onChange={(e) => setBulkReviewAddToGolden(e.target.checked)}
              />
              <label htmlFor="bulk_add_to_golden" className="text-sm text-slate-700">批量回流 Golden Dataset</label>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setBulkReviewOpen(false)}>取消</Button>
              <Button type="submit" disabled={!bulkReviewLabel || bulkReviewMutation.isPending}>
                {bulkReviewMutation.isPending ? '审核中...' : '确认批量审核'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function summarizeCandidates(candidates: { kind: string }[]) {
  return {
    golden: candidates.filter((candidate) => candidate.kind === 'golden').length,
    assertion: candidates.filter((candidate) => candidate.kind === 'assertion').length,
  };
}

function summarizeOwners(tasks: AnnotationTask[]) {
  const owners = new Map<string, { assignee: string; backlog: number; overdue_count: number }>();
  tasks
    .filter((task) => task.status !== 'reviewed')
    .forEach((task) => {
      const assignee = task.assignee || '未分派';
      const current = owners.get(assignee) ?? { assignee, backlog: 0, overdue_count: 0 };
      current.backlog += 1;
      if (task.overdue || task.sla_status === 'overdue') {
        current.overdue_count += 1;
      }
      owners.set(assignee, current);
    });
  return [...owners.values()];
}

function renderStatus(status: string) {
  const colorClass = status === 'reviewed' ? 'bg-green-50 text-green-700 ring-green-600/20' : 
                     status === 'assigned' ? 'bg-blue-50 text-blue-700 ring-blue-700/10' : 
                     'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
  const label = status === 'reviewed' ? '已审核' : status === 'assigned' ? '已分派' : '待领取';
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colorClass}`}>{label}</span>;
}

function renderSla(status?: string | null, dueAt?: string | null) {
  const colorClass = status === 'overdue' ? 'bg-red-50 text-red-700 ring-red-600/10' : 
                     status === 'unassigned' ? 'bg-yellow-50 text-yellow-800 ring-yellow-600/20' : 
                     status === 'reviewed' ? 'bg-green-50 text-green-700 ring-green-600/20' : 
                     'bg-blue-50 text-blue-700 ring-blue-700/10';
  const label = status === 'overdue' ? '已超时' : status === 'unassigned' ? '未分派' : status === 'reviewed' ? '已审核' : 'SLA内';
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${colorClass}`}>{label}</span>
      {dueAt ? <span className="text-xs text-slate-500">{formatAnnotationTime(dueAt)}</span> : null}
    </div>
  );
}

function formatAnnotationTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}
