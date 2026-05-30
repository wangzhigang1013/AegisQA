import { DownloadOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
  Timeline,
} from 'antd';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { TaskRecord } from '../types';
import { TaskCreateWizard, type TaskCreateFormValues } from './task/TaskCreateWizard';

type TaskAction = 'execute' | 'pause' | 'resume' | 'cancel' | 'retry';

export function RunsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks, refetchOnMount: 'always' });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets, refetchOnMount: 'always' });

  const datasetVersions = useMemo(
    () => datasetsQuery.data?.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))) ?? [],
    [datasetsQuery.data],
  );
  const tasks = tasksQuery.data ?? [];

  const createTaskMutation = useMutation({
    mutationFn: (values: TaskCreateFormValues) => {
      const datasetVersion = datasetVersions.find((item) => item.version.version_id === values.dataset_version_id)?.version;
      if (!datasetVersion || !values.workflow_version_id) {
        throw new Error('创建任务前必须选择 Dataset Version 和 Workflow Version。');
      }
      return api.createTask({
        name: values.name || '未命名评测任务',
        dataset_id: datasetVersion.dataset_id,
        dataset_version: datasetVersion.version,
        workflow_version_id: values.workflow_version_id,
        chunk_size: values.chunk_size,
        concurrency: values.concurrency,
        sample_repeat_times: values.sample_repeat_times,
        max_retries: values.max_retries,
        retry_backoff_seconds: values.retry_backoff_seconds,
        cost_budget: values.cost_budget,
      });
    },
    onSuccess: async (task) => {
      setCreateOpen(false);
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
        datasets={datasetsQuery.data ?? []}
        workflows={workflowsQuery.data ?? []}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createTaskMutation.mutate(values)}
      />

      <TaskDetailDrawer
        task={detailTask}
        loading={taskActionMutation.isPending}
        onClose={() => setDetailTask(null)}
        onAction={triggerTaskAction}
      />
    </section>
  );
}

function TaskDetailDrawer({
  task,
  loading,
  onClose,
  onAction,
}: {
  task: TaskRecord | null;
  loading: boolean;
  onClose: () => void;
  onAction: (task: TaskRecord, action: TaskAction) => void;
}) {
  const traceQuery = useQuery({
    queryKey: ['task-trace-tree', task?.task_id],
    queryFn: () => api.taskTraceTree(task?.task_id ?? ''),
    enabled: Boolean(task?.task_id),
  });

  return (
    <Drawer title={task ? `任务详情：${task.name}` : '任务详情'} width={720} open={Boolean(task)} onClose={onClose}>
      {task ? (
        <Space direction="vertical" className="drawer-stack" size="large">
          <Space wrap>
            <TaskActionButton task={task} action="execute" loading={loading} onClick={onAction} icon={<PlayCircleOutlined />} label="执行" />
            <TaskActionButton task={task} action="pause" loading={loading} onClick={onAction} icon={<PauseCircleOutlined />} label="暂停" />
            <TaskActionButton task={task} action="resume" loading={loading} onClick={onAction} icon={<PlayCircleOutlined />} label="恢复" />
            <TaskActionButton task={task} action="cancel" loading={loading} onClick={onAction} icon={<StopOutlined />} label="取消" danger />
            <TaskActionButton task={task} action="retry" loading={loading} onClick={onAction} icon={<ReloadOutlined />} label="重试失败项" />
          </Space>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="数据源">{task.dataset_name} v{task.dataset_version}</Descriptions.Item>
            <Descriptions.Item label="Workflow">{task.workflow_name}</Descriptions.Item>
            <Descriptions.Item label="Run">{task.run_id}</Descriptions.Item>
            <Descriptions.Item label="进度">{task.completed_items} / {task.total_items}</Descriptions.Item>
            <Descriptions.Item label="Badcase">{task.badcase_count}</Descriptions.Item>
            <Descriptions.Item label="执行参数">{formatExecutionConfig(task)}</Descriptions.Item>
          </Descriptions>
          <Card size="small" title="Trace Tree">
            {traceQuery.data?.items?.length ? (
              <Timeline
                items={traceQuery.data.items.slice(0, 5).map((item) => ({
                  color: item.status === 'succeeded' ? 'green' : item.status === 'failed' ? 'red' : 'blue',
                  children: `${item.item_id} / ${item.status}`,
                }))}
              />
            ) : (
              <Alert type="info" showIcon message="执行任务后展示 Skill 级调用树、输入输出、耗时、错误和缓存命中。" />
            )}
          </Card>
        </Space>
      ) : null}
    </Drawer>
  );
}

function TaskActionButton({
  task,
  action,
  loading,
  onClick,
  icon,
  label,
  danger = false,
}: {
  task: TaskRecord;
  action: TaskAction;
  loading: boolean;
  onClick: (task: TaskRecord, action: TaskAction) => void;
  icon: ReactNode;
  label: string;
  danger?: boolean;
}) {
  const disabledReason = taskActionDisabledReason(task, action);
  const button = (
    <Button danger={danger} icon={icon} loading={loading} disabled={Boolean(disabledReason)} onClick={() => onClick(task, action)}>
      {label}
    </Button>
  );
  return disabledReason ? <Tooltip title={disabledReason}>{button}</Tooltip> : button;
}

function taskActionDisabledReason(task: TaskRecord, action: TaskAction): string | null {
  const status = task.status;
  if (action === 'execute') {
    if (status === 'completed') return '任务已完成，请复制任务或创建新任务后重新执行。';
    if (status === 'running') return '任务正在执行中。';
    if (status === 'canceled' || status === 'cancelled') return '任务已取消，不能执行。';
    return null;
  }
  if (action === 'pause') return ['queued', 'running'].includes(status) ? null : '只有 queued/running 任务可以暂停。';
  if (action === 'resume') return status === 'paused' ? null : '只有 paused 任务可以恢复。';
  if (action === 'cancel') return ['queued', 'running', 'paused', 'failed'].includes(status) ? null : '当前状态不能取消。';
  if (action === 'retry') return status === 'failed' ? null : '只有 failed 任务可以重试失败项。';
  return null;
}

function taskProgress(task: TaskRecord): number {
  if (!task.total_items) return 0;
  return Math.round((task.completed_items / task.total_items) * 100);
}

function formatExecutionConfig(task: TaskRecord): string {
  const config = task.execution_config;
  if (!config) return '-';
  const retry = config.retry ?? {};
  return [
    `并发 ${config.concurrency ?? '-'}`,
    `repeat ${config.sample_repeat_times ?? '-'}`,
    `重试 ${retry.max_retries ?? '-'}`,
    `退避 ${retry.backoff_seconds ?? '-'}s`,
    `预算 ${config.cost_budget ?? '-'}`,
  ].join(' / ');
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
