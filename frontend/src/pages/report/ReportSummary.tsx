import { Card, Descriptions, Tag } from 'antd';

import type { TaskRecord, TaskReport } from '../../types';

type ReportSummaryProps = {
  task: TaskRecord;
  summary?: TaskReport['task_summary'];
  versionSnapshot?: TaskReport['version_snapshot'];
};

export function ReportSummary({ task, summary, versionSnapshot }: ReportSummaryProps) {
  const dataset = versionSnapshot?.dataset ?? {};
  const workflow = versionSnapshot?.workflow ?? {};
  return (
    <Card className="flat-card" title="任务摘要与版本快照">
      <Descriptions bordered size="small" column={1}>
        <Descriptions.Item label="任务">{summary?.task_name ?? task.name}</Descriptions.Item>
        <Descriptions.Item label="状态"><Tag color={task.status === 'completed' ? 'green' : 'orange'}>{summary?.status ?? task.status}</Tag></Descriptions.Item>
        <Descriptions.Item label="数据集">{String(dataset.name ?? task.dataset_name)} / {String(dataset.version_id ?? task.dataset_version_id ?? `v${task.dataset_version}`)}</Descriptions.Item>
        <Descriptions.Item label="Workflow">{String(workflow.name ?? task.workflow_name)} / {String(workflow.version_id ?? task.workflow_version_id)}</Descriptions.Item>
        <Descriptions.Item label="样本量">{summary?.sample_count ?? task.total_items}</Descriptions.Item>
        <Descriptions.Item label="当前 Attempt">{summary?.current_attempt ?? task.current_attempt ?? 1}</Descriptions.Item>
        <Descriptions.Item label="执行参数">{formatExecutionConfig(versionSnapshot?.execution_config)}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function formatExecutionConfig(config: Record<string, unknown> | undefined): string {
  if (!config) return '-';
  const retry = asRecord(config.retry);
  return [
    `并发 ${config.concurrency ?? '-'}`,
    `repeat ${config.sample_repeat_times ?? '-'}`,
    `重试 ${retry?.max_retries ?? '-'}`,
    `预算 ${config.cost_budget ?? '-'}`,
  ].join(' / ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
