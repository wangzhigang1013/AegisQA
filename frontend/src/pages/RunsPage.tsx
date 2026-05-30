import { DownloadOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
} from 'antd';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { TaskRecord } from '../types';

type TaskFormValues = {
  name: string;
  workflow_version_id: string;
  dataset_version_id: string;
  chunk_size?: number;
  concurrency?: number;
  sample_repeat_times?: number;
};

export function RunsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form] = Form.useForm<TaskFormValues>();
  const watchedWorkflow = Form.useWatch('workflow_version_id', form);
  const watchedDataset = Form.useWatch('dataset_version_id', form);

  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks, refetchOnMount: 'always' });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows, refetchOnMount: 'always' });
  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets, refetchOnMount: 'always' });

  const datasetVersions = useMemo(
    () => datasetsQuery.data?.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))) ?? [],
    [datasetsQuery.data],
  );
  const tasks = tasksQuery.data ?? [];

  const createTaskMutation = useMutation({
    mutationFn: (values: TaskFormValues) => {
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
      });
    },
    onSuccess: async (task) => {
      setCreateOpen(false);
      setDetailTask(task);
      setNotice(`任务已创建：${task.name}`);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `创建失败：${error.message}` : '创建失败'),
  });

  const taskActionMutation = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: 'execute' | 'pause' | 'resume' | 'cancel' | 'retry' }) => {
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
    onError: (error) => setNotice(error instanceof Error ? `操作失败：${error.message}` : '操作失败'),
  });

  function triggerTaskAction(task: TaskRecord, action: 'execute' | 'pause' | 'resume' | 'cancel' | 'retry') {
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
                  <Button icon={<PlayCircleOutlined />} loading={taskActionMutation.isPending} onClick={() => triggerTaskAction(record, 'execute')}>执行</Button>
                  <Button icon={<ReloadOutlined />} loading={taskActionMutation.isPending} onClick={() => triggerTaskAction(record, 'retry')}>重试失败</Button>
                  <Button icon={<DownloadOutlined />} onClick={() => setDetailTask(record)}>详情</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="创建任务向导"
        open={createOpen}
        forceRender
        onCancel={() => setCreateOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setCreateOpen(false)}>取消</Button>,
          <Button
            key="create"
            type="primary"
            loading={createTaskMutation.isPending}
            disabled={!watchedWorkflow || !watchedDataset}
            onClick={() => form.submit()}
          >
            确认创建任务
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createTaskMutation.mutate(values)}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请填写任务名称' }]}>
            <Input placeholder="例如：RAG 回归评测 2026-05-31" />
          </Form.Item>
          <Form.Item name="dataset_version_id" label="Dataset Version" rules={[{ required: true, message: '请选择 Dataset' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择数据版本"
              options={datasetVersions.map(({ version }) => ({ value: version.version_id, label: `${version.name} v${version.version} / ${version.row_count} 条` }))}
            />
          </Form.Item>
          <Form.Item name="workflow_version_id" label="Workflow Version" rules={[{ required: true, message: '请选择 Workflow' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择已发布 Workflow"
              options={(workflowsQuery.data ?? []).map((workflow) => ({ value: workflow.version_id, label: `${workflow.name} v${workflow.version}` }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="chunk_size" label="分片大小">
                <InputNumber min={1} className="full-width-control" placeholder="100" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="concurrency" label="并发">
                <InputNumber min={1} className="full-width-control" placeholder="1" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sample_repeat_times" label="重复次数">
                <InputNumber min={1} className="full-width-control" placeholder="1" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

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
  onAction: (task: TaskRecord, action: 'execute' | 'pause' | 'resume' | 'cancel' | 'retry') => void;
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
            <Button icon={<PlayCircleOutlined />} loading={loading} onClick={() => onAction(task, 'execute')}>执行</Button>
            <Button icon={<PauseCircleOutlined />} loading={loading} onClick={() => onAction(task, 'pause')}>暂停</Button>
            <Button icon={<PlayCircleOutlined />} loading={loading} onClick={() => onAction(task, 'resume')}>恢复</Button>
            <Button danger icon={<StopOutlined />} loading={loading} onClick={() => onAction(task, 'cancel')}>取消</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => onAction(task, 'retry')}>重试失败项</Button>
          </Space>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="数据源">{task.dataset_name} v{task.dataset_version}</Descriptions.Item>
            <Descriptions.Item label="Workflow">{task.workflow_name}</Descriptions.Item>
            <Descriptions.Item label="Run">{task.run_id}</Descriptions.Item>
            <Descriptions.Item label="进度">{task.completed_items} / {task.total_items}</Descriptions.Item>
            <Descriptions.Item label="Badcase">{task.badcase_count}</Descriptions.Item>
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

function taskProgress(task: TaskRecord): number {
  if (!task.total_items) return 0;
  return Math.round((task.completed_items / task.total_items) * 100);
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
