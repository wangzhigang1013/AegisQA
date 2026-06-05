import { DownloadOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Input,
  Progress,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, formatApiError } from '../api/client';
import { ActionToolbar, DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { DatasetVersion, TaskPreflightResult, TaskRecord } from '../types';
import { TaskCreateWizard, type TaskCreateFormValues } from './task/TaskCreateWizard';
import { TaskActionButton, TaskOperationsDrawer, type TaskAction } from './task/TaskOperationsDrawer';
import { taskProgress } from './task/TaskSnapshotPanel';

export function RunsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  useEffect(() => {
    if (!hasActiveTask) return undefined;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTask, queryClient]);

  useEffect(() => {
    if (!detailTask) return;
    const freshTask = tasks.find((task) => task.task_id === detailTask.task_id);
    if (freshTask) {
      setDetailTask(freshTask);
    }
  }, [detailTask, tasks]);

  useEffect(() => {
    if (!taskDetailQuery.data) return;
    if (detailTask?.task_id === taskDetailQuery.data.task_id) return;
    setDetailTask(taskDetailQuery.data);
  }, [detailTask?.task_id, taskDetailQuery.data]);

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
      setNotice(result.status === 'blocked' ? `Preflight 阻断：${result.summary}` : `Preflight 完成：${result.summary}`);
    },
    onError: (error) => setNotice(`Preflight 失败：${formatApiError(error)}`),
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
      setNotice(`任务已创建：${task.name}`);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => setNotice(`创建失败：${formatApiError(error)}`),
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
      setNotice(`任务状态已更新：${task.status}`);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => setNotice(`操作失败：${formatApiError(error)}`),
  });

  function triggerTaskAction(task: TaskRecord, action: TaskAction) {
    taskActionMutation.mutate({ taskId: task.task_id, action });
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="任务执行"
        title="执行中心"
        description="所有执行都围绕任务展开：一批数据绑定一个 Workflow，生成 Run、Trace、Badcase 和任务报告。"
        primaryAction={<Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setCreateOpen(true)}>创建任务</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'info'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <PageSection title="任务列表" testId="runs-task-table-section">
        <ActionToolbar className="section-actions" testId="runs-filter-toolbar">
          <Input.Search
            allowClear
            aria-label="搜索任务"
            placeholder="搜索任务名 / 数据源 / Workflow"
            className="wide-search"
            value={taskSearch}
            onChange={(event) => {
              setTaskSearch(event.target.value);
              setTaskPage(1);
            }}
            onSearch={(value) => {
              setTaskSearch(value);
              setTaskPage(1);
            }}
          />
          <Select
            allowClear
            aria-label="任务状态筛选"
            placeholder="全部状态"
            className="status-filter"
            value={taskStatusFilter}
            onChange={(value) => {
              setTaskStatusFilter(value);
              setTaskPage(1);
            }}
            options={[
              { value: 'queued', label: 'queued' },
              { value: 'running', label: 'running' },
              { value: 'completed', label: 'completed' },
              { value: 'failed', label: 'failed' },
              { value: 'canceled', label: 'canceled' },
            ]}
          />
        </ActionToolbar>
        <DataTableShell testId="runs-task-table-shell">
          <Table
            className="runs-task-table"
            rowKey="task_id"
            loading={tasksQuery.isLoading}
            scroll={{ x: 1580 }}
            pagination={{
              current: taskPagination?.page ?? taskPage,
              pageSize: taskPagination?.page_size ?? taskPageSize,
              total: taskPagination?.total_items ?? tasks.length,
              showSizeChanger: false,
              onChange: (page) => setTaskPage(page),
            }}
            dataSource={tasks}
            locale={{ emptyText: <Empty description="暂无任务。请先上传数据、发布 Workflow，然后创建任务。" /> }}
            columns={[
              {
                title: '任务名',
                dataIndex: 'name',
                width: 220,
                render: (value, record) => (
                  <Button type="link" onClick={() => setDetailTask(record)}>
                    {value}
                  </Button>
                ),
              },
              { title: '数据源', dataIndex: 'dataset_name', width: 180 },
              { title: 'Workflow', dataIndex: 'workflow_name', width: 220 },
              { title: '总数据量', dataIndex: 'total_items', width: 100 },
              {
                title: '已执行',
                width: 160,
                render: (_, record) => (
                  <Space direction="vertical" size={2} className="task-progress-cell">
                    <span>{record.completed_items} / {record.total_items}</span>
                    <Progress percent={taskProgress(record)} size="small" showInfo={false} />
                  </Space>
                ),
              },
              { title: '失败数', dataIndex: 'failed_items', width: 90 },
              { title: '通过率', dataIndex: 'pass_rate', width: 90, render: (value) => `${Math.round(Number(value ?? 0) * 100)}%` },
              { title: '状态', dataIndex: 'status', width: 110, render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
              { title: '创建时间', dataIndex: 'created_at', width: 190, render: (value) => formatTime(value) },
              {
                title: '操作',
                width: 220,
                render: (_, record) => (
                  <Space>
                    <TaskActionButton task={record} action="execute" loading={taskActionMutation.isPending} onClick={triggerTaskAction} icon={<PlayCircleOutlined />} label="执行" />
                    <TaskActionButton task={record} action="retry" loading={taskActionMutation.isPending} onClick={triggerTaskAction} icon={<ReloadOutlined />} label="重试失败" />
                    <Button icon={<DownloadOutlined />} onClick={() => setDetailTask(record)}>详情</Button>
                  </Space>
                ),
              },
            ]}
          />
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

function statusColor(status: string): string {
  if (status === 'completed') return 'green';
  if (status === 'failed' || status === 'cancelled') return 'red';
  if (status === 'running') return 'blue';
  if (status === 'paused') return 'orange';
  return 'default';
}

function isLiveTaskStatus(status: string): boolean {
  return status === 'running';
}

function formatTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
