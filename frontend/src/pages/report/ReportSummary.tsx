import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';

import type { TaskRecord, TaskReport } from '../../types';

type ReportSummaryProps = {
  task: TaskRecord;
  summary?: TaskReport['task_summary'];
  versionSnapshot?: TaskReport['version_snapshot'];
  preflightEvidence?: TaskReport['preflight_evidence'];
};

export function ReportSummary({ task, summary, versionSnapshot, preflightEvidence }: ReportSummaryProps) {
  const dataset = versionSnapshot?.dataset ?? {};
  const workflow = versionSnapshot?.workflow ?? {};
  const evidence = preflightEvidence ?? task.preflight_result;
  const preflightId = task.execution_config?.preflight_id ?? evidence?.preflight_id;
  return (
    <Card className="mb-4">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-lg">任务摘要与版本快照</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">任务</dt>
            <dd className="mt-1 text-sm text-slate-900 font-medium">{summary?.task_name ?? task.name}</dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">状态</dt>
            <dd className="mt-1">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${task.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                {summary?.status ?? task.status}
              </span>
            </dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">数据集</dt>
            <dd className="mt-1 text-sm text-slate-900">{String(dataset.name ?? task.dataset_name)} / {String(dataset.version_id ?? task.dataset_version_id ?? `v${task.dataset_version}`)}</dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">Workflow</dt>
            <dd className="mt-1 text-sm text-slate-900">{String(workflow.name ?? task.workflow_name)} / {String(workflow.version_id ?? task.workflow_version_id)}</dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">样本量</dt>
            <dd className="mt-1 text-sm text-slate-900">{summary?.sample_count ?? task.total_items}</dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">当前 Attempt</dt>
            <dd className="mt-1 text-sm text-slate-900">{summary?.current_attempt ?? task.current_attempt ?? 1}</dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">执行参数</dt>
            <dd className="mt-1 text-sm text-slate-900">{formatExecutionConfig(versionSnapshot?.execution_config)}</dd>
          </div>
          <div className="sm:col-span-1 border-b border-slate-200 pb-2">
            <dt className="text-sm font-medium text-slate-500">创建前 Preflight 证据</dt>
            <dd className="mt-1 text-sm text-slate-900 flex flex-wrap gap-2 items-center">
              {evidence ? (
                <>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${preflightColorClass(evidence.status)}`}>
                    {evidence.status}
                  </span>
                  {preflightId ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-slate-200 text-slate-700">{preflightId}</span> : null}
                  <span>{evidence.summary}</span>
                </>
              ) : (
                '未记录'
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function preflightColorClass(status: string): string {
  if (status === 'passed') return 'bg-green-100 text-green-700';
  if (status === 'warning') return 'bg-yellow-100 text-yellow-700';
  if (status === 'blocked') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-700';
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
