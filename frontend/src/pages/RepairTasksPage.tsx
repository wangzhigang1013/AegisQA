import { CheckCircle, Check, FileSearch, RefreshCw, Undo, UserPlus, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { RepairTaskPageResult, RepairTaskRecord, RepairTaskTree } from '../types';
import { Modal, Button, Table, Row, Col, Card } from '../components/AntdShims';
import { Input } from '../components/ui/Input';

type ResolveValues = {
  resolution_note: string;
};

type ReopenValues = {
  reason: string;
};

type AssignValues = {
  owner: string;
  due_at?: string;
};

export function RepairTasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [sourceTaskId, setSourceTaskId] = useState<string | undefined>();
  const [resolveTask, setResolveTask] = useState<RepairTaskRecord | null>(null);
  const [reopenTask, setReopenTask] = useState<RepairTaskRecord | null>(null);
  const [assignTask, setAssignTask] = useState<RepairTaskRecord | null>(null);
  const [treeTask, setTreeTask] = useState<RepairTaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairPage, setRepairPage] = useState(1);
  const repairPageSize = 8;
  
  const [resolveFormState, setResolveFormState] = useState<ResolveValues>({ resolution_note: '' });
  const [reopenFormState, setReopenFormState] = useState<ReopenValues>({ reason: '' });
  const [assignFormState, setAssignFormState] = useState<AssignValues>({ owner: '', due_at: '' });

  const repairTasksQuery = useQuery({
    queryKey: ['repair-tasks', sourceTaskId, statusFilter, repairPage, repairPageSize],
    queryFn: () => api.repairTasksPage({ source_task_id: sourceTaskId, status: statusFilter, page: repairPage, pageSize: repairPageSize }),
  });
  const repairTaskTreeQuery = useQuery({
    queryKey: ['repair-task-tree', treeTask?.repair_task_id],
    queryFn: () => api.repairTaskTree(treeTask?.repair_task_id ?? ''),
    enabled: Boolean(treeTask),
  });
  const tasksQuery = useQuery({ queryKey: ['tasks-all'], queryFn: () => api.tasksPage({ page: 1, pageSize: 100 }) });

  const visibleRepairTasks = repairTasksQuery.data?.items ?? [];
  const repairPagination = repairTasksQuery.data?.pagination;

  const taskNameById = useMemo(() => {
    return Object.fromEntries((tasksQuery.data?.items ?? []).map((task) => [task.task_id, task.name]));
  }, [tasksQuery.data]);

  const startMutation = useMutation({
    mutationFn: (record: RepairTaskRecord) => api.startRepairTask(record.repair_task_id, { owner: 'qa_owner' }),
    onSuccess: async (record) => {
      setNotice(`修复任务已领取：${record.owner ?? 'qa_owner'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
    },
    onError: (error) => setNotice(`领取失败：${formatApiError(error)}`),
  });

  const resolveMutation = useMutation({
    mutationFn: (values: ResolveValues) => {
      if (!resolveTask) throw new Error('请选择需要完成的修复任务。');
      return api.resolveRepairTask(resolveTask.repair_task_id, { resolution_note: values.resolution_note });
    },
    onSuccess: async (record) => {
      setResolveTask(null);
      setResolveFormState({ resolution_note: '' });
      setNotice(`修复任务已完成：${record.resolution_note ?? '已记录修复说明'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
    },
    onError: (error) => setNotice(`完成失败：${formatApiError(error)}`),
  });

  const assignMutation = useMutation({
    mutationFn: (values: AssignValues) => {
      if (!assignTask) throw new Error('请选择需要指派的修复任务。');
      return api.assignRepairTask(assignTask.repair_task_id, { owner: values.owner, due_at: values.due_at || null });
    },
    onSuccess: async (record) => {
      setAssignTask(null);
      setAssignFormState({ owner: '', due_at: '' });
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
      mergeRepairTasks([record]);
      setNotice(`修复任务已指派给：${record.owner}${record.overdue ? '，当前已逾期。' : '。'}`);
    },
    onError: (error) => setNotice(`指派失败：${formatApiError(error)}`),
  });

  const reopenMutation = useMutation({
    mutationFn: (values: ReopenValues) => {
      if (!reopenTask) throw new Error('请选择需要重开的修复任务。');
      return api.reopenRepairTask(reopenTask.repair_task_id, { reason: values.reason });
    },
    onSuccess: async (record) => {
      setReopenTask(null);
      setReopenFormState({ reason: '' });
      setNotice(`修复任务已重开：${record.reopen_reason ?? '已记录重开原因'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
    },
    onError: (error) => setNotice(`重开失败：${formatApiError(error)}`),
  });

  const actionMutation = useMutation({
    mutationFn: ({ record, action }: { record: RepairTaskRecord; action: string }) =>
      api.runRepairTaskAction(record.repair_task_id, { action, assignee: 'qa_owner', limit: 20 }),
    onSuccess: (payload) => {
      const followups = extractRepairTasks(payload.result);
      mergeRepairTasks([payload.repair_task, ...followups]);
      const history = payload.repair_task.action_history ?? [];
      const summary = history[history.length - 1]?.result_summary ?? `${payload.action} 已执行。`;
      setNotice(summary);
      void queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['ci-gates'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-report', payload.repair_task.source_task_id] });
      void queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
    },
    onError: (error) => setNotice(`动作执行失败：${formatApiError(error)}`),
  });

  function openResolve(record: RepairTaskRecord) {
    setResolveTask(record);
    setResolveFormState({ resolution_note: record.resolution_note ?? '' });
  }

  function openReopen(record: RepairTaskRecord) {
    setReopenTask(record);
    setReopenFormState({ reason: record.reopen_reason ?? '' });
  }

  function openAssign(record: RepairTaskRecord) {
    setAssignTask(record);
    setAssignFormState({ owner: record.owner ?? '', due_at: record.due_at ?? '' });
  }

  function mergeRepairTasks(updatedTasks: RepairTaskRecord[]) {
    queryClient.setQueryData<RepairTaskPageResult>(['repair-tasks', sourceTaskId, statusFilter, repairPage, repairPageSize], (current) => {
      if (!current) return current;
      const byId = new Map(current.items.map((item) => [item.repair_task_id, item]));
      updatedTasks.forEach((updated) => {
        const keepInCurrentList = (!sourceTaskId || updated.source_task_id === sourceTaskId) && (!statusFilter || updated.status === statusFilter);
        if (!keepInCurrentList) {
          byId.delete(updated.repair_task_id);
          return;
        }
        const existing = byId.get(updated.repair_task_id);
        if (!existing) {
          byId.set(updated.repair_task_id, updated);
          return;
        }
        const seen = new Set<string>();
        const actionHistory = [...(existing.action_history ?? []), ...(updated.action_history ?? [])].filter((entry) => {
          const key = `${entry.action}:${entry.created_at ?? ''}:${entry.result_summary ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        byId.set(updated.repair_task_id, { ...existing, ...updated, action_history: actionHistory });
      });
      return { ...current, items: Array.from(byId.values()) };
    });
  }

  function runAction(record: RepairTaskRecord, action: string) {
    actionMutation.mutate({ record, action });
  }

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="诊断闭环"
        title="修复任务工作台"
        description="把任务报告中的根因诊断沉淀为可领取、可完成、可重开的修复工作项，确保问题不会停在报告页面。"
        primaryAction={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => window.location.href = '/reports'}>回到报告中心</Button>
            <Button variant="outline" icon={<RefreshCw className="w-4 h-4" />} onClick={() => void repairTasksQuery.refetch()}>
              刷新
            </Button>
          </div>
        }
      />

      {notice && (
        <div className={`flex items-center justify-between p-4 rounded-md border ${notice.includes('失败') ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          <div className="flex items-center gap-2">
            {notice.includes('失败') ? <XCircle className="w-5 h-5 text-red-500" /> : <CheckCircle className="w-5 h-5 text-green-500" />}
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-gray-700">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      <Card title="筛选条件">
        <div className="flex flex-wrap gap-4 items-center">
          <select 
            className="w-48 border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            aria-label="修复任务状态筛选"
            value={statusFilter ?? ''}
            onChange={(e) => {
              setStatusFilter(e.target.value || undefined);
              setRepairPage(1);
            }}
          >
            <option value="">按状态筛选 (全部)</option>
            <option value="open">待处理</option>
            <option value="in_progress">处理中</option>
            <option value="resolved">已完成</option>
          </select>
          
          <select 
            className="w-64 border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            aria-label="修复任务来源任务筛选"
            value={sourceTaskId ?? ''}
            onChange={(e) => {
              setSourceTaskId(e.target.value || undefined);
              setRepairPage(1);
            }}
          >
            <option value="">按来源任务筛选 (全部)</option>
            {(tasksQuery.data?.items ?? []).map((task) => (
              <option key={task.task_id} value={task.task_id}>{task.name} / {task.status}</option>
            ))}
          </select>
          
          <span className="text-sm text-gray-500">
            当前展示 {repairPagination?.total_items ?? visibleRepairTasks.length} 个修复工作项。
          </span>
        </div>
      </Card>

      <Card title="修复任务列表" className="overflow-hidden">
        <div className="overflow-x-auto -mx-4 -mb-4 mt-2">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">修复任务</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">状态</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-36">根因</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">级别</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">影响样本</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">证据</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">动作历史</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">推荐动作</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-56">最近结果</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">来源任务</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-40">负责人</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-64 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visibleRepairTasks.map(record => (
                <tr key={record.repair_task_id}>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-gray-900">{record.title}</span>
                      <span className="text-gray-500 text-xs">{record.recommendation}</span>
                      {record.parent_repair_task_id && <span className="inline-block w-max px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs mt-1">子任务</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">{renderStatus(record.status)}</td>
                  <td className="px-4 py-3 text-sm">{renderCauseType(record.cause_type)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">{renderSeverity(record.severity)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">{record.affected_items}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{record.evidence?.[0] ?? '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      {record.action_history?.length ? record.action_history.map(item => (
                        <span key={`${item.action}-${item.created_at ?? item.result_summary}`} className="inline-block w-max px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{item.action}</span>
                      )) : <span className="text-gray-500">未触发</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="text-gray-900">{record.recommended_action || record.next_actions?.[0] || '-'}</span>
                      {record.target_url && <a href={record.target_url} className="text-blue-600 hover:underline text-xs">打开入口</a>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <RecentActionResult record={record} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-col">
                      <span className="text-gray-900">{record.source_task_id}</span>
                      {taskNameById[String(record.source_task_id)] && <span className="text-gray-500 text-xs">{taskNameById[String(record.source_task_id)]}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <RepairOwner record={record} onAssign={() => openAssign(record)} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                    <div className="flex flex-wrap gap-1 justify-end">
                      <Button variant="outline" size="sm" onClick={() => window.location.href = `/reports?task_id=${record.source_task_id}`}>查看报告</Button>
                      <Button variant="outline" size="sm" onClick={() => window.location.href = `/tasks/${record.source_task_id}/trace`}>Trace</Button>
                      <Button variant="outline" size="sm" onClick={() => setTreeTask(record)}>查看进度</Button>
                      <Button variant="outline" size="sm" onClick={() => openAssign(record)} disabled={record.status === 'resolved'}>指派</Button>
                      <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'seed_annotation_queue')}>人工审核</Button>
                      <Button variant="outline" size="sm" icon={<CheckCircle className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'evaluate_ci_gate')}>CI Gate</Button>
                      <Button variant="outline" size="sm" icon={<RefreshCw className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'retest_and_compare')}>复跑对比</Button>
                      <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'generate_remediation_plan')}>生成建议</Button>
                      <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'create_followup_repair_tasks')}>拆分任务</Button>
                      
                      {hasRepairAction(record, 'fix_dataset_fields') && <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'fix_dataset_fields')}>字段修复</Button>}
                      {hasRepairAction(record, 'plan_workflow_parameter_changes') && <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'plan_workflow_parameter_changes')}>参数diff</Button>}
                      {hasRepairAction(record, 'compare_prompt_skill_versions') && <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'compare_prompt_skill_versions')}>版本对比</Button>}
                      {hasCandidateAction(record, 'create_prompt_skill_candidate') && <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'create_prompt_skill_candidate')}>沉淀候选</Button>}
                      {hasCandidateAction(record, 'create_workflow_draft_from_version_diff') && <Button variant="outline" size="sm" icon={<FileSearch className="w-3 h-3" />} loading={actionMutation.isPending} onClick={() => runAction(record, 'create_workflow_draft_from_version_diff')}>生成草稿</Button>}
                      
                      <Button variant="outline" size="sm" onClick={() => window.location.href = `/reports?task_id=${record.source_task_id}&panel=parameter-governance`}>参数治理</Button>
                      <Button variant="outline" size="sm" icon={<UserPlus className="w-3 h-3" />} disabled={record.status !== 'open'} loading={startMutation.isPending} onClick={() => startMutation.mutate(record)}>领取</Button>
                      <Button variant="primary" size="sm" icon={<Check className="w-3 h-3" />} disabled={record.status === 'resolved'} onClick={() => openResolve(record)}>完成</Button>
                      <Button variant="outline" size="sm" icon={<Undo className="w-3 h-3" />} disabled={record.status !== 'resolved'} onClick={() => openReopen(record)}>重开</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleRepairTasks.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-gray-500">暂无修复任务</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={Boolean(resolveTask)} onCancel={() => setResolveTask(null)} title="解决修复任务">
        <div className="space-y-4 mt-4">
          <p className="text-sm text-gray-500">修复任务：{resolveTask?.title}</p>
          <form 
            id="resolveForm"
            onSubmit={(e) => {
              e.preventDefault();
              resolveMutation.mutate(resolveFormState);
            }}
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">修复说明 <span className="text-red-500">*</span></label>
              <textarea 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                rows={4}
                placeholder="说明本次修复做了什么、如何验证"
                value={resolveFormState.resolution_note}
                onChange={(e) => setResolveFormState({ resolution_note: e.target.value })}
                required
              />
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => setResolveTask(null)}>取消</Button>
              <Button variant="default" type="submit" disabled={!resolveFormState.resolution_note} loading={resolveMutation.isPending}>确认完成</Button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal open={Boolean(reopenTask)} onCancel={() => setReopenTask(null)} title="重开修复任务">
        <div className="space-y-4 mt-4">
          <p className="text-sm text-gray-500">修复任务：{reopenTask?.title}</p>
          <form 
            id="reopenForm"
            onSubmit={(e) => {
              e.preventDefault();
              reopenMutation.mutate(reopenFormState);
            }}
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">重开原因 <span className="text-red-500">*</span></label>
              <textarea 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                rows={4}
                placeholder="说明为什么复测失败或需要再次处理"
                value={reopenFormState.reason}
                onChange={(e) => setReopenFormState({ reason: e.target.value })}
                required
              />
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => setReopenTask(null)}>取消</Button>
              <Button variant="default" type="submit" disabled={!reopenFormState.reason} loading={reopenMutation.isPending}>确认重开</Button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal open={Boolean(assignTask)} onCancel={() => setAssignTask(null)} title="指派修复任务">
        <div className="space-y-4 mt-4">
          <p className="text-sm text-gray-500">修复任务：{assignTask?.title}</p>
          <form 
            id="assignForm"
            onSubmit={(e) => {
              e.preventDefault();
              assignMutation.mutate(assignFormState);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">负责人 <span className="text-red-500">*</span></label>
              <Input 
                placeholder="例如：dataset_owner" 
                value={assignFormState.owner}
                onChange={(e) => setAssignFormState({ ...assignFormState, owner: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">截止时间</label>
              <Input 
                placeholder="例如：2026-06-01T00:00:00+00:00" 
                value={assignFormState.due_at ?? ''}
                onChange={(e) => setAssignFormState({ ...assignFormState, due_at: e.target.value })}
              />
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={() => setAssignTask(null)}>取消</Button>
              <Button variant="default" type="submit" disabled={!assignFormState.owner} loading={assignMutation.isPending}>确认指派</Button>
            </div>
          </form>
        </div>
      </Modal>

      <RepairTaskTreeDrawer
        tree={repairTaskTreeQuery.data}
        loading={repairTaskTreeQuery.isLoading}
        open={Boolean(treeTask)}
        onClose={() => setTreeTask(null)}
      />
    </section>
  );
}

function renderStatus(status: string) {
  const colorMap: Record<string, string> = {
    open: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    resolved: 'bg-green-100 text-green-800',
  };
  const labelMap: Record<string, string> = {
    open: '待处理',
    in_progress: '处理中',
    resolved: '已完成',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${colorMap[status] ?? 'bg-gray-100 text-gray-800'}`}>{labelMap[status] ?? status}</span>;
}

function renderSeverity(value: string) {
  const color = value === 'critical' ? 'bg-red-100 text-red-800' : value === 'warning' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${color}`}>{value}</span>;
}

function RecentActionResult({ record }: { record: RepairTaskRecord }) {
  const fieldActions = extractFieldFixActions(record);
  if (fieldActions.length) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-gray-500">字段修复计划</span>
        {fieldActions.slice(0, 3).map((item) => (
          <span key={`${item.field}-${item.action}`} className={item.required_by_workflow ? 'text-red-600' : 'text-gray-600'}>
            {item.field}：{item.recommendation}
          </span>
        ))}
      </div>
    );
  }
  const parameterDiffs = extractParameterDiffs(record);
  if (parameterDiffs.length) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-gray-500">参数 diff/回滚计划</span>
        {parameterDiffs.slice(0, 3).map((item) => (
          <span key={`${item.step_id}-${item.parameter}`} className={item.source === 'task_override' ? 'text-orange-600' : 'text-gray-600'}>
            {item.step_id}.{item.parameter}：当前 {String(item.current_value_preview ?? '-')}，Workflow 默认 {String(item.workflow_value_preview ?? '-')}。{item.recommendation}
          </span>
        ))}
      </div>
    );
  }
  const versionDiffs = extractPromptSkillVersionDiffs(record);
  if (versionDiffs.length) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-gray-500">Prompt/Skill 版本对比</span>
        {versionDiffs.slice(0, 3).map((item) => (
          <span key={`${item.step_id}-${item.field}`} className={item.field === 'prompt_version' ? 'text-orange-600' : 'text-gray-600'}>
            {item.step_id}.{item.field}：baseline {String(item.baseline_value ?? '-')}，当前 {String(item.current_value ?? '-')}。建议：{item.recommended_action}
          </span>
        ))}
      </div>
    );
  }
  const recommendations = extractRecommendations(record);
  if (recommendations.length) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        {recommendations.slice(0, 3).map((item) => (
          <span key={`${item.area}-${item.title}`} className="text-gray-600">
            {item.title}
          </span>
        ))}
      </div>
    );
  }
  const summary = record.action_history?.[record.action_history.length - 1]?.result_summary;
  return <span className="text-gray-500 text-xs">{summary ?? '暂无结果'}</span>;
}

function hasRepairAction(record: RepairTaskRecord, action: string) {
  return record.recommended_action === action || record.next_actions?.includes(action) || record.last_action_result?.action === action;
}

function hasCandidateAction(record: RepairTaskRecord, action: string) {
  const candidateSources = [record.last_action_result?.result?.candidate_actions, record.version_compare_plan?.candidate_actions];
  return candidateSources.some((candidateActions) => {
    if (!Array.isArray(candidateActions)) return false;
    return candidateActions.some((item) => isRecord(item) && item.action === action);
  });
}

function RepairOwner({ record, onAssign }: { record: RepairTaskRecord; onAssign: () => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-900">{record.owner || '未领取'}</span>
      {record.due_at && <span className={`text-xs ${record.overdue ? 'text-red-500' : 'text-gray-500'}`}>{record.overdue ? '已逾期' : '截止'}：{record.due_at}</span>}
      {record.status !== 'resolved' && (
        <Button variant="outline" size="sm" onClick={onAssign} className="mt-1 w-max px-2 py-0">
          指派
        </Button>
      )}
    </div>
  );
}

function RepairTaskTreeDrawer({
  tree,
  loading,
  open,
  onClose,
}: {
  tree?: RepairTaskTree;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const summary = tree?.summary;
  const percent = Math.round((summary?.completion_rate ?? 0) * 100);
  
  return (
    <Modal open={open} onCancel={onClose} title="修复任务分支树">
      <div className="space-y-6 mt-4 max-h-[80vh] overflow-y-auto">
        <p className="text-sm text-gray-500">
          父任务：{tree?.repair_task.title ?? '加载中'}
        </p>
        <div className="flex flex-wrap gap-4 items-center bg-gray-50 p-4 rounded-md border">
          <span className="font-medium text-gray-900">整体状态：{summary ? renderStatus(summary.overall_status) : '-'}</span>
          <span className="text-gray-700">已完成 {summary?.resolved_children ?? 0} / {summary?.total_children ?? 0}</span>
          <span className="text-gray-500 text-sm">阻塞子任务 {summary?.blocking_children.length ?? 0} 个</span>
          <span className={`text-sm ${(summary?.overdue_children ?? 0) > 0 ? 'text-red-600' : 'text-gray-500'}`}>
            逾期子任务 {summary?.overdue_children ?? 0} 个
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div 
            className={`h-2.5 rounded-full ${percent === 100 ? 'bg-green-600' : 'bg-blue-600'}`} 
            style={{ width: `${percent}%` }}
          ></div>
        </div>

        <div>
          <h5 className="font-medium text-gray-900 mb-2">下一步动作</h5>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 border">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">子任务</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">负责人</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">截止时间</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">推荐动作</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">入口</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">加载中...</td></tr>
                ) : (summary?.next_actions ?? []).map(action => (
                  <tr key={action.repair_task_id}>
                    <td className="px-4 py-2 text-sm text-gray-900">{action.title}</td>
                    <td className="px-4 py-2 text-sm">{renderStatus(action.status)}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{action.owner || '未领取'}</td>
                    <td className="px-4 py-2 text-sm">{action.due_at ? <span className={action.overdue ? 'text-red-500' : 'text-gray-500'}>{action.due_at}</span> : '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{action.recommended_action}</td>
                    <td className="px-4 py-2 text-sm">
                      {action.target_url ? <a href={action.target_url} className="text-blue-600 hover:underline">打开</a> : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h5 className="font-medium text-gray-900 mb-2">子任务明细</h5>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 border">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">标题</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">根因</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">推荐动作</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">负责人</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">截止时间</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">加载中...</td></tr>
                ) : (tree?.children ?? []).map(child => (
                  <tr key={child.repair_task_id}>
                    <td className="px-4 py-2 text-sm text-gray-900">{child.title}</td>
                    <td className="px-4 py-2 text-sm">{renderStatus(child.status)}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{renderCauseType(child.cause_type)}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{child.recommended_action || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{child.owner || '未领取'}</td>
                    <td className="px-4 py-2 text-sm">{child.due_at ? <span className={child.overdue ? 'text-red-500' : 'text-gray-500'}>{child.due_at}</span> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function extractRecommendations(record: RepairTaskRecord): { area: string; title: string }[] {
  const result = record.last_action_result?.result;
  const recommendations = result?.recommendations;
  if (!Array.isArray(recommendations)) return [];
  return recommendations
    .map((item) => {
      if (!isRecord(item) || typeof item.title !== 'string') return null;
      return { area: typeof item.area === 'string' ? item.area : 'unknown', title: item.title };
    })
    .filter((item): item is { area: string; title: string } => Boolean(item));
}

function extractRepairTasks(result: Record<string, unknown>): RepairTaskRecord[] {
  const repairTasks = result.repair_tasks;
  if (!Array.isArray(repairTasks)) return [];
  return repairTasks.filter((item): item is RepairTaskRecord => isRecord(item) && typeof item.repair_task_id === 'string');
}

function extractFieldFixActions(record: RepairTaskRecord): { field: string; action: string; recommendation: string; required_by_workflow: boolean }[] {
  const result = record.last_action_result?.result;
  const fieldActions = result?.field_actions;
  if (!Array.isArray(fieldActions)) return [];
  return fieldActions
    .map((item) => {
      if (!isRecord(item) || typeof item.field !== 'string') return null;
      return {
        field: item.field,
        action: typeof item.action === 'string' ? item.action : 'inspect',
        recommendation: typeof item.recommendation === 'string' ? item.recommendation : '请检查该字段的数据质量。',
        required_by_workflow: Boolean(item.required_by_workflow),
      };
    })
    .filter((item): item is { field: string; action: string; recommendation: string; required_by_workflow: boolean } => Boolean(item));
}

function extractParameterDiffs(record: RepairTaskRecord): {
  step_id: string;
  parameter: string;
  source: string;
  current_value_preview: unknown;
  workflow_value_preview: unknown;
  recommendation: string;
}[] {
  const result = record.last_action_result?.result;
  const diffs = result?.parameter_diffs;
  if (!Array.isArray(diffs)) return [];
  return diffs
    .map((item) => {
      if (!isRecord(item) || typeof item.step_id !== 'string' || typeof item.parameter !== 'string') return null;
      return {
        step_id: item.step_id,
        parameter: item.parameter,
        source: typeof item.source === 'string' ? item.source : 'unknown',
        current_value_preview: item.current_value_preview,
        workflow_value_preview: item.workflow_value_preview,
        recommendation: typeof item.recommendation === 'string' ? item.recommendation : '请确认该参数来源是否符合本次评测目标。',
      };
    })
    .filter((item): item is {
      step_id: string;
      parameter: string;
      source: string;
      current_value_preview: unknown;
      workflow_value_preview: unknown;
      recommendation: string;
    } => Boolean(item));
}

function extractPromptSkillVersionDiffs(record: RepairTaskRecord): {
  step_id: string;
  field: string;
  baseline_value: unknown;
  current_value: unknown;
  recommended_action: string;
}[] {
  const result = record.last_action_result?.result;
  const candidates = result?.baseline_candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .flatMap((candidate) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.version_diffs)) return [];
      return candidate.version_diffs;
    })
    .map((item) => {
      if (!isRecord(item) || typeof item.step_id !== 'string' || typeof item.field !== 'string') return null;
      return {
        step_id: item.step_id,
        field: item.field,
        baseline_value: item.baseline_value,
        current_value: item.current_value,
        recommended_action: typeof item.recommended_action === 'string' ? item.recommended_action : 'review_version_diff',
      };
    })
    .filter((item): item is {
      step_id: string;
      field: string;
      baseline_value: unknown;
      current_value: unknown;
      recommended_action: string;
    } => Boolean(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function renderCauseType(value: string) {
  const labels: Record<string, string> = {
    runtime_error: '运行时错误',
    data_quality: '数据质量',
    weak_segment: '弱分层风险',
    judge_or_answer_quality: '回答或裁判质量',
    parameter_risk: '参数风险',
    annotation: '人工审核',
    workflow_parameters: '参数治理',
    dataset: '数据修复',
  };
  return labels[value] ?? value;
}
