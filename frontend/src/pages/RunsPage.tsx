import { Download, PlayCircle, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, formatApiError } from '../api/client';
import { ActionToolbar, DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import type { DatasetVersion, TaskPreflightResult, TaskRecord } from '../types';
import { TaskCreateWizard, type TaskCreateFormValues } from './task/TaskCreateWizard';
import { TaskActionButton, TaskOperationsDrawer, type TaskAction } from './task/TaskOperationsDrawer';
import { taskProgress } from './task/TaskSnapshotPanel';

export function RunsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string; type: 'success' | 'error' }[]>([]);
  const addNotice = (text: string, type: 'success' | 'error' = 'error') => {
    const id = Date.now();
    setNotices(prev => [...prev.slice(-2), { id, text, type }]); // 最多 3 条
    setTimeout(() => setNotices(prev => prev.filter(n => n.id !== id)), 5000); // 5s 自动消失
  };
  const [preflightResult, setPreflightResult] = useState<TaskPreflightResult | null>(null);
  const [taskPage, setTaskPage] = useState(1);
  const [taskStatusFilter, setTaskStatusFilter] = useState<string | undefined>();
  const [taskSearch, setTaskSearch] = useState('');
  const taskPageSize = 8;
  const normalizedTaskSearch = taskSearch.trim();
  const detailTaskIdFromQuery = searchParams.get('task_id');

  const tasksQuery = useQuery({
    queryKey: ['tasks', 'page', taskPage, taskStatusFilter, normalizedTaskSearch],
    queryFn: () => api.tasksPage({ page: taskPage, pageSize: taskPageSize, status: taskStatusFilter, q: normalizedTaskSearch || undefined }),
    refetchOnMount: 'always',
  });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets, refetchOnMount: 'always' });
  const taskDetailQuery = useQuery({
    queryKey: ['task', detailTaskIdFromQuery],
    queryFn: () => api.task(detailTaskIdFromQuery ?? ''),
    enabled: Boolean(detailTaskIdFromQuery),
  });

  const datasetVersions = useMemo(
    () => datasetsQuery.data?.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))) ?? [],
    [datasetsQuery.data],
  );
  const tasks = tasksQuery.data?.items ?? [];
  const taskPagination = tasksQuery.data?.pagination;
  const hasActiveTask = tasks.some((task) => isLiveTaskStatus(task.status));
  const totalPages = Math.ceil((taskPagination?.total_items ?? tasks.length) / taskPageSize);

  // 自适应轮询: running=1s, queued=3s, 连续无变化增加到 5s
  const snapshotRef = useRef({ consecutiveNoChange: 0, prevSnapshot: '' });
  useEffect(() => {
    if (!hasActiveTask) return undefined;
    const poll = () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] }).then(() => {
        const current = tasks.map(t => `${t.task_id}:${t.status}`).join(',');
        if (current === snapshotRef.current.prevSnapshot) {
          snapshotRef.current.consecutiveNoChange++;
        } else {
          snapshotRef.current.consecutiveNoChange = 0;
        }
        snapshotRef.current.prevSnapshot = current;
      });
    };
    const hasRunning = tasks.some(t => t.status === 'running');
    const baseInterval = hasRunning ? 1000 : 3000;
    const interval = snapshotRef.current.consecutiveNoChange >= 3 ? 5000 : baseInterval;
    const timer = window.setInterval(poll, interval);
    return () => window.clearInterval(timer);
  }, [hasActiveTask, queryClient, tasks]);

  // 独立详情轮询: 不依赖分页列表，直接刷新详情
  const detailPollQuery = useQuery({
    queryKey: ['task-detail-poll', detailTask?.task_id],
    queryFn: () => api.task(detailTask?.task_id ?? ''),
    enabled: Boolean(detailTask) && isLiveTaskStatus(detailTask?.status ?? ''),
    refetchInterval: 2000,
  });
  useEffect(() => {
    if (detailPollQuery.data) {
      setDetailTask(detailPollQuery.data);
    }
  }, [detailPollQuery.data]);

  useEffect(() => {
    if (!detailTask) return;
    const freshTask = tasks.find((task) => task.task_id === detailTask.task_id);
    if (freshTask) {
      setDetailTask(freshTask);
    }
  }, [detailTask, tasks]);

  const lastOpenedTaskId = useRef<string | null>(null);

  useEffect(() => {
    if (!detailTaskIdFromQuery) {
      lastOpenedTaskId.current = null;
      return;
    }
    if (taskDetailQuery.data && lastOpenedTaskId.current !== detailTaskIdFromQuery) {
      // Ensure the fetched data actually matches the current URL before opening
      if (taskDetailQuery.data.task_id === detailTaskIdFromQuery) {
        setDetailTask(taskDetailQuery.data);
        lastOpenedTaskId.current = detailTaskIdFromQuery;
      }
    }
  }, [detailTaskIdFromQuery, taskDetailQuery.data]);

  function resolveDatasetVersion(values: TaskCreateFormValues): DatasetVersion {
    const datasetVersion = datasetVersions.find((item) => item.version.version_id === values.dataset_version_id)?.version;
    if (!datasetVersion || !values.workflow_version_id) {
      throw new Error('创建任务前必须选择 Dataset Version 和 Workflow Version。');
    }
    return datasetVersion;
  }

  const preflightMutation = useMutation({
    mutationFn: (values: TaskCreateFormValues) => {
      const datasetVersion = resolveDatasetVersion(values);
      return api.taskPreflight({
        dataset_id: datasetVersion.dataset_id,
        dataset_version: datasetVersion.version,
        workflow_version_id: values.workflow_version_id,
      });
    },
    onSuccess: (result) => {
      setPreflightResult(result);
      addNotice(
        result.status === 'blocked' ? `Preflight 阻断：${result.summary}` : `Preflight 完成：${result.summary}`,
        result.status === 'blocked' ? 'error' : 'success',
      );
    },
    onError: (error) => addNotice(`Preflight 失败：${formatApiError(error)}`),
  });

  const createTaskMutation = useMutation({
    mutationFn: (values: TaskCreateFormValues) => {
      const datasetVersion = resolveDatasetVersion(values);
      return api.createTask({
        name: values.name || '未命名评测任务',
        dataset_id: datasetVersion.dataset_id,
        dataset_version: datasetVersion.version,
        workflow_version_id: values.workflow_version_id,
        preflight_id: preflightResult?.preflight_id,
        preflight_result: preflightResult,
        allow_blocked_preflight: values.allow_blocked_preflight,
      });
    },
    onSuccess: async (task) => {
      setCreateOpen(false);
      setPreflightResult(null);
      setDetailTask(task);
      addNotice(`任务已创建：${task.name}`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => addNotice(`创建失败：${formatApiError(error)}`),
  });

  const taskActionMutation = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: TaskAction }) => {
      if (action === 'execute') return api.executeTask(taskId);
      if (action === 'pause') return api.pauseTask(taskId);
      if (action === 'resume') return api.resumeTask(taskId);
      if (action === 'cancel') return api.cancelTask(taskId);
      if (action === 'attempt') return api.createTaskAttempt(taskId);
      return api.retryFailedTask(taskId);
    },
    onSuccess: async (task) => {
      setDetailTask(task);
      addNotice(`任务状态已更新：${task.status}`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => addNotice(`操作失败：${formatApiError(error)}`),
  });

  function triggerTaskAction(task: TaskRecord, action: TaskAction) {
    taskActionMutation.mutate({ taskId: task.task_id, action });
  }

  return (
    <section className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-6">
      <PageHeader
        eyebrow="任务执行"
        title="执行中心"
        description="所有执行都围绕任务展开：一批数据绑定一个 Workflow，生成 Run、Trace、Badcase 和任务报告。"
        primaryAction={
          <Button variant="default" onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
            <PlayCircle className="w-4 h-4" /> 创建任务
          </Button>
        }
      />

      {notices.map(n => (
        <div key={n.id} className={`p-4 rounded-lg flex items-start gap-3 ${n.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
          <div className="flex-1 text-sm font-medium">{n.text}</div>
          <button onClick={() => setNotices(prev => prev.filter(x => x.id !== n.id))} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      ))}

      <PageSection title="任务列表" testId="runs-task-table-section">
        <ActionToolbar className="flex justify-between items-center mb-4" testId="runs-filter-toolbar">
          <div className="flex items-center gap-4 flex-wrap">
            <Input
              aria-label="搜索任务"
              placeholder="搜索任务名 / 数据源 / Workflow"
              className="w-80"
              value={taskSearch}
              onChange={(event) => {
                setTaskSearch(event.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setTaskPage(1);
                }
              }}
            />
            <select
              aria-label="任务状态筛选"
              value={taskStatusFilter || ''}
              onChange={(e) => {
                setTaskStatusFilter(e.target.value || undefined);
                setTaskPage(1);
              }}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none w-40"
            >
              <option value="">全部状态</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
        </ActionToolbar>
        
        <DataTableShell testId="runs-task-table-shell">
          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-sm">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[1200px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold text-slate-700">任务名</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">数据源</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">Workflow</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">总数据量</th>
                  <th className="px-6 py-4 font-semibold text-slate-700 w-48">已执行</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">失败数</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">通过率</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">状态</th>
                  <th className="px-6 py-4 font-semibold text-slate-700">创建时间</th>
                  <th className="px-6 py-4 font-semibold text-slate-700 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasksQuery.isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                      加载中...
                    </td>
                  </tr>
                ) : tasks.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-slate-500 bg-slate-50">
                      暂无任务。请先上传数据、发布 Workflow，然后创建任务。
                    </td>
                  </tr>
                ) : (
                  tasks.map((record) => {
                    const percent = taskProgress(record);
                    return (
                      <tr key={record.task_id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-3">
                          <button 
                            className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline text-left" 
                            onClick={() => setDetailTask(record)}
                          >
                            {record.name}
                          </button>
                        </td>
                        <td className="px-6 py-3 text-slate-600">{record.dataset_name}</td>
                        <td className="px-6 py-3 text-slate-600">{record.workflow_name}</td>
                        <td className="px-6 py-3 text-slate-600">{record.total_items}</td>
                        <td className="px-6 py-3">
                          <div className="flex flex-col gap-1.5 w-full">
                            <span className="text-xs text-slate-500">{record.completed_items} / {record.total_items}</span>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="bg-indigo-500 h-full rounded-full transition-all duration-300" 
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-slate-600">{record.failed_items}</td>
                        <td className="px-6 py-3 text-slate-600">{Math.round(Number(record.pass_rate ?? 0) * 100)}%</td>
                        <td className="px-6 py-3">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusClasses(record.status)}`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-slate-500 text-xs">{formatTime(record.created_at)}</td>
                        <td className="px-6 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <TaskActionButton task={record} action="execute" loading={taskActionMutation.isPending} onClick={triggerTaskAction} icon={<PlayCircle className="w-3.5 h-3.5" />} label="执行" />
                            <TaskActionButton task={record} action="retry" loading={taskActionMutation.isPending} onClick={triggerTaskAction} icon={<RefreshCw className="w-3.5 h-3.5" />} label="重试失败" />
                            <Button variant="outline" size="sm" className="h-8 text-xs flex items-center gap-1.5" onClick={() => setDetailTask(record)}>
                              <Download className="w-3.5 h-3.5" /> 详情
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!tasksQuery.isLoading && totalPages > 1 && (
            <div className="flex justify-between items-center mt-4">
              <span className="text-sm text-slate-500">
                共 {taskPagination?.total_items ?? tasks.length} 条记录
              </span>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={taskPage <= 1}
                  onClick={() => setTaskPage(taskPage - 1)}
                >
                  上一页
                </Button>
                <div className="text-sm text-slate-600 px-2 font-medium">
                  {taskPage} / {totalPages}
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  disabled={taskPage >= totalPages}
                  onClick={() => setTaskPage(taskPage + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </DataTableShell>
      </PageSection>

      <TaskCreateWizard
        open={createOpen}
        loading={createTaskMutation.isPending}
        preflightLoading={preflightMutation.isPending}
        preflightResult={preflightResult}
        datasets={datasetsQuery.data ?? []}
        workflows={workflowsQuery.data ?? []}
        onCancel={() => {
          setCreateOpen(false);
          setPreflightResult(null);
        }}
        onPreflight={(values) => preflightMutation.mutate(values)}
        onSubmit={(values) => createTaskMutation.mutate(values)}
      />

      <TaskOperationsDrawer
        task={detailTask}
        loading={taskActionMutation.isPending}
        onClose={() => {
          setDetailTask(null);
          if (searchParams.has('task_id')) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete('task_id');
            setSearchParams(nextParams, { replace: true });
          }
        }}
        onAction={triggerTaskAction}
      />
    </section>
  );
}

function statusClasses(status: string): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-100 text-red-700';
  if (status === 'running') return 'bg-blue-100 text-blue-700';
  if (status === 'paused') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function isLiveTaskStatus(status: string): boolean {
  return status === 'running' || status === 'queued' || status === 'pausing';
}

function formatTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
