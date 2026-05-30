import { Card, Descriptions, Progress, Space, Tag } from 'antd';

import type { TaskRecord } from '../../types';

export function TaskSnapshotPanel({ task }: { task: TaskRecord }) {
  return (
    <Card size="small" title="任务快照">
      <Space direction="vertical" className="full-width-control">
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="数据源">{task.dataset_name} v{task.dataset_version}</Descriptions.Item>
          <Descriptions.Item label="Workflow">{task.workflow_name}</Descriptions.Item>
          <Descriptions.Item label="Run">{task.run_id}</Descriptions.Item>
          <Descriptions.Item label="当前 Attempt">{task.current_attempt ?? 1}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag>{task.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="Badcase">{task.badcase_count}</Descriptions.Item>
          <Descriptions.Item label="执行参数">{formatExecutionConfig(task)}</Descriptions.Item>
        </Descriptions>
        <Progress percent={taskProgress(task)} />
      </Space>
    </Card>
  );
}

export function taskProgress(task: TaskRecord): number {
  if (!task.total_items) return 0;
  return Math.round((task.completed_items / task.total_items) * 100);
}

export function formatExecutionConfig(task: TaskRecord): string {
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
