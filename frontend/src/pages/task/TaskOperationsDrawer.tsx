import { DownloadOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Drawer, Space, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { api, formatApiError } from '../../api/client';
import type { TaskPreflightResult, TaskRecord, TaskResultsExportDownload } from '../../types';
import { TaskSnapshotPanel, formatExecutionConfig } from './TaskSnapshotPanel';

export type TaskAction = 'execute' | 'pause' | 'resume' | 'cancel' | 'retry' | 'attempt';

export function TaskOperationsDrawer({
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
  const [notice, setNotice] = useState<string | null>(null);
  const traceQuery = useQuery({
    queryKey: ['task-trace-tree', task?.task_id],
    queryFn: () => api.taskTraceTree(task?.task_id ?? '', { page: 1, pageSize: 5 }),
    enabled: Boolean(task?.task_id),
  });
  const reportQuery = useQuery({
    queryKey: ['task-report', task?.task_id],
    queryFn: () => api.taskReport(task?.task_id ?? '', { badcasePage: 1, badcasePageSize: 8 }),
    enabled: Boolean(task?.task_id),
  });
  const traceFlowQuery = useQuery({
    queryKey: ['task-trace-flow', task?.task_id],
    queryFn: () => api.taskTraceFlow(task?.task_id ?? ''),
    enabled: Boolean(task?.task_id),
  });
  const exportResultsMutation = useMutation({
    mutationFn: async (format: 'csv' | 'jsonl') => {
      if (!task) {
        throw new Error('请先选择任务，再导出结果。');
      }
      const exported = await api.exportTaskResults(task.task_id, format);
      return { exported, task };
    },
    onSuccess: ({ exported, task: exportedTask }) => {
      const filename = downloadTaskResultsExport(exported, exportedTask);
      setNotice(`结果导出成功：${filename} 已开始下载。`);
    },
    onError: (error) => setNotice(`结果导出失败：${formatApiError(error)}`),
  });

  return (
    <Drawer title={task ? `任务详情：${task.name}` : '任务详情'} width={820} open={Boolean(task)} onClose={onClose}>
      {task ? (
        <Space direction="vertical" className="drawer-stack" size="large">
          <Space wrap>
            <TaskActionButton task={task} action="execute" loading={loading} onClick={onAction} icon={<PlayCircleOutlined />} label="执行" />
            <TaskActionButton task={task} action="pause" loading={loading} onClick={onAction} icon={<PauseCircleOutlined />} label="暂停" />
            <TaskActionButton task={task} action="resume" loading={loading} onClick={onAction} icon={<PlayCircleOutlined />} label="恢复" />
            <TaskActionButton task={task} action="cancel" loading={loading} onClick={onAction} icon={<StopOutlined />} label="取消" danger />
            <TaskActionButton task={task} action="retry" loading={loading} onClick={onAction} icon={<ReloadOutlined />} label="重试失败项" />
            <TaskActionButton task={task} action="attempt" loading={loading} onClick={onAction} icon={<ReloadOutlined />} label="新建 Attempt" />
            <Button href={`/tasks/${task.task_id}/trace?return_task_id=${encodeURIComponent(task.task_id)}`}>查看 Trace Flow</Button>
            <Button href={`/tasks/${task.task_id}/trace-tree?return_task_id=${encodeURIComponent(task.task_id)}`}>查看 Trace Tree</Button>
            <Button icon={<DownloadOutlined />} loading={exportResultsMutation.isPending && exportResultsMutation.variables === 'csv'} disabled={exportResultsMutation.isPending} onClick={() => exportResultsMutation.mutate('csv')}>导出结果 CSV</Button>
            <Button icon={<DownloadOutlined />} loading={exportResultsMutation.isPending && exportResultsMutation.variables === 'jsonl'} disabled={exportResultsMutation.isPending} onClick={() => exportResultsMutation.mutate('jsonl')}>导出结果 JSONL</Button>
          </Space>
          {notice ? <Alert showIcon type={notice.includes('失败') ? 'error' : 'success'} message={notice} closable onClose={() => setNotice(null)} /> : null}

          <Tabs
            items={[
              {
                key: 'overview',
                label: '概览',
                children: <TaskSnapshotPanel task={task} />,
              },
              {
                key: 'items',
                label: '样本',
                children: (
                  <Card size="small" title="样本执行进度">
                    <Descriptions bordered column={1} size="small">
                      <Descriptions.Item label="总样本">{task.total_items}</Descriptions.Item>
                      <Descriptions.Item label="已完成">{task.completed_items}</Descriptions.Item>
                      <Descriptions.Item label="失败">{task.failed_items}</Descriptions.Item>
                      <Descriptions.Item label="队列消息">执行队列仅携带 item_id，样本内容从 Dataset Version 按 item_id 回读。</Descriptions.Item>
                    </Descriptions>
                  </Card>
                ),
              },
              {
                key: 'trace',
                label: 'Trace',
                children: (
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
                ),
              },
              {
                key: 'badcase',
                label: 'Badcase',
                children: (
                  <Card size="small" title="Badcase">
                    <Table
                      size="small"
                      rowKey={(record) => String(record.badcase_id ?? record.item_id)}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      dataSource={reportQuery.data?.badcases ?? []}
                      columns={[
                        { title: 'Item', dataIndex: 'item_id' },
                        { title: '原因', dataIndex: 'reason' },
                        { title: '状态', dataIndex: 'status', render: (value) => <Tag>{String(value ?? 'pending')}</Tag> },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'attempts',
                label: 'Attempts',
                children: (
                  <Card size="small" title="Run Attempts">
                    {task.attempts?.length ? (
                      <Timeline
                        items={task.attempts.map((attempt) => ({
                          color: attempt.run_id === task.run_id ? 'blue' : attempt.status === 'completed' ? 'green' : 'gray',
                          children: `#${attempt.attempt_index} / ${attempt.status} / ${attempt.run_id} / 通过率 ${Math.round(Number(attempt.pass_rate ?? 0) * 100)}%`,
                        }))}
                      />
                    ) : (
                      <Alert type="info" showIcon message="当前任务还没有历史 Attempt。重新执行时会保留旧报告并创建新的 Run。" />
                    )}
                  </Card>
                ),
              },
              {
                key: 'params',
                label: '参数',
                children: (
                  <Card size="small" title="任务冻结参数">
                    <Typography.Paragraph>{formatExecutionConfig(task)}</Typography.Paragraph>
                    <pre className="json-block">{JSON.stringify(task.execution_config ?? {}, null, 2)}</pre>
                    <PreflightEvidenceCard task={task} />
                    <Typography.Title level={5}>Skill 参数来源</Typography.Title>
                    <Table
                      size="small"
                      rowKey="step_id"
                      pagination={false}
                      dataSource={traceFlowQuery.data?.items?.[0]?.steps ?? []}
                      columns={[
                        { title: 'Step', dataIndex: 'step_id' },
                        { title: 'Skill', dataIndex: 'skill_ref' },
                        {
                          title: '参数追踪',
                          render: (_, step) => <pre className="json-block">{JSON.stringify(step.parameter_trace ?? {}, null, 2)}</pre>,
                        },
                      ]}
                    />
                    <Typography.Text type="secondary">Secret 参数在 Trace Flow 中只展示 secret_ref 或脱敏预览，不展示明文。</Typography.Text>
                  </Card>
                ),
              },
            ]}
          />
        </Space>
      ) : null}
    </Drawer>
  );
}

function PreflightEvidenceCard({ task }: { task: TaskRecord }) {
  const preflight = task.preflight_result;
  const preflightId = task.execution_config?.preflight_id ?? preflight?.preflight_id;
  if (!preflight) {
    return (
      <Card size="small" title="创建前 Preflight 证据">
        <Alert type="info" showIcon message="当前任务没有保存 Preflight 结果，可能来自旧版本任务或导入数据。" />
      </Card>
    );
  }
  return (
    <Card size="small" title="创建前 Preflight 证据">
      <Space direction="vertical" className="full-width-control">
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Preflight ID">{preflightId ? <Typography.Text code>{preflightId}</Typography.Text> : '未持久化'}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={preflightColor(preflight.status)}>{preflight.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="生成时间">{preflight.created_at ?? '未记录'}</Descriptions.Item>
          <Descriptions.Item label="摘要">{preflight.summary}</Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          rowKey="check_id"
          pagination={false}
          dataSource={preflight.checks ?? []}
          columns={[
            { title: '检查项', dataIndex: 'title' },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag color={preflightColor(String(value))}>{String(value)}</Tag> },
            { title: '结果', dataIndex: 'message' },
            { title: '修复建议', dataIndex: 'recommendation', render: (value) => String(value || '-') },
          ]}
        />
      </Space>
    </Card>
  );
}

function preflightColor(status: TaskPreflightResult['status']) {
  if (status === 'passed') return 'green';
  if (status === 'warning') return 'gold';
  if (status === 'blocked') return 'red';
  return 'default';
}

function downloadTaskResultsExport(exported: TaskResultsExportDownload, task: TaskRecord) {
  const format = exported.file_format || 'csv';
  const filename = exported.filename || `${safeTaskResultFileName(task.name || task.task_id)}_results.${format}`;
  const blob = exported.blob.type ? exported.blob : new Blob([exported.blob], { type: taskResultExportMimeTypes[format] ?? 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  // 下载必须通过临时 a 标签触发，完成后立即清理，避免 Drawer 多次打开后残留 DOM。
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return filename;
}

function safeTaskResultFileName(name: string) {
  const normalized = name.trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'task-results';
}

const taskResultExportMimeTypes: Record<string, string> = {
  csv: 'text/csv;charset=utf-8',
  jsonl: 'application/x-ndjson;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

export function TaskActionButton({
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
  if (action === 'attempt') return ['queued', 'running', 'paused'].includes(status) ? '当前任务仍有活动执行实例，结束后才能新建 Attempt。' : null;
  return null;
}
