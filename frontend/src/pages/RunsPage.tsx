import { DownloadOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Progress,
  Space,
  Table,
  Tag,
} from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { DatasetVersion, TaskPreflightResult, TaskRecord } from '../types';
import { TaskCreateWizard, type TaskCreateFormValues } from './task/TaskCreateWizard';
import { TaskActionButton, TaskOperationsDrawer, type TaskAction } from './task/TaskOperationsDrawer';
import { taskProgress } from './task/TaskSnapshotPanel';

export function RunsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<TaskPreflightResult | null>(null);

  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks, refetchOnMount: 'always' });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets, refetchOnMount: 'always' });
  const executionTemplatesQuery = useQuery({ queryKey: ['task-execution-templates'], queryFn: api.taskExecutionTemplates, refetchOnMount: 'always' });

  const datasetVersions = useMemo(
    () => datasetsQuery.data?.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))) ?? [],
    [datasetsQuery.data],
  );
  const tasks = tasksQuery.data ?? [];

  function resolveDatasetVersion(values: TaskCreateFormValues): DatasetVersion {
    const datasetVersion = datasetVersions.find((item) => item.version.version_id === values.dataset_version_id)?.version;
    if (!datasetVersion || !values.workflow_version_id) {
      throw new Error('创建任务前必须选择 Dataset Version 和 Workflow Version。');
    }
    return datasetVersion;
  }

  function qualityGateFromValues(values: TaskCreateFormValues) {
    return {
      pass_rate: values.pass_rate_threshold,
      max_badcase_count: values.max_badcase_count,
    };
  }

  const preflightMutation = useMutation({
    mutationFn: (values: TaskCreateFormValues) => {
      const datasetVersion = resolveDatasetVersion(values);
      return api.taskPreflight({
        dataset_id: datasetVersion.dataset_id,
        dataset_version: datasetVersion.version,
        workflow_version_id: values.workflow_version_id,
        execution_template_id: values.execution_template_id,
        evaluation_goal: values.evaluation_goal,
        quality_gate: qualityGateFromValues(values),
        cost_budget: values.cost_budget,
        sample_repeat_times: values.sample_repeat_times,
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
        evaluation_goal: values.evaluation_goal,
        quality_gate: qualityGateFromValues(values),
        preflight_result: preflightResult,
        chunk_size: values.chunk_size,
        concurrency: values.concurrency,
        sample_repeat_times: values.sample_repeat_times,
        max_retries: values.max_retries,
        retry_backoff_seconds: values.retry_backoff_seconds,
        cost_budget: values.cost_budget,
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

      <Card className="flat-card" title="任务列表">
        <Table
          rowKey="task_id"
          loading={tasksQuery.isLoading}
          pagination={{ pageSize: 8 }}
          dataSource={tasks}
          locale={{ emptyText: <Empty description="暂无任务。请先上传数据、发布 Workflow，然后创建任务。" /> }}
          columns={[
            {
              title: '任务名',
              dataIndex: 'name',
              render: (value, record) => (
                <Button type="link" onClick={() => setDetailTask(record)}>
                  {value}
                </Button>
              ),
            },
            { title: '数据源', dataIndex: 'dataset_name' },
            { title: 'Workflow', dataIndex: 'workflow_name' },
            { title: '总数据量', dataIndex: 'total_items' },
            {
              title: '已执行',
              render: (_, record) => (
                <Space direction="vertical" size={2} className="task-progress-cell">
                  <span>{record.completed_items} / {record.total_items}</span>
                  <Progress percent={taskProgress(record)} size="small" showInfo={false} />
                </Space>
              ),
            },
            { title: '失败数', dataIndex: 'failed_items' },
            { title: '通过率', dataIndex: 'pass_rate', render: (value) => `${Math.round(Number(value ?? 0) * 100)}%` },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
            { title: '创建时间', dataIndex: 'created_at', render: (value) => formatTime(value) },
            {
              title: '操作',
              fixed: 'right',
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
      </Card>

      <TaskCreateWizard
        open={createOpen}
        loading={createTaskMutation.isPending}
        preflightLoading={preflightMutation.isPending}
        preflightResult={preflightResult}
        datasets={datasetsQuery.data ?? []}
        workflows={workflowsQuery.data ?? []}
        executionTemplates={Array.isArray(executionTemplatesQuery.data) ? executionTemplatesQuery.data : []}
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
        onClose={() => setDetailTask(null)}
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

function formatTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
