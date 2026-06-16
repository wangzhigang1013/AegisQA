import { Card } from '../../components/ui/Card';
import type { TaskRecord } from '../../types';

export function TaskSnapshotPanel({ task }: { task: TaskRecord }) {
  return (
    <Card title="任务快照">
      <div className="space-y-4">
        <div className="border border-gray-200 rounded-md overflow-hidden">
          <dl className="divide-y divide-gray-200 text-sm">
            <div className="flex bg-gray-50">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">数据源</dt>
              <dd className="w-2/3 px-4 py-2">{task.dataset_name} v{task.dataset_version}</dd>
            </div>
            <div className="flex bg-white">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">Workflow</dt>
              <dd className="w-2/3 px-4 py-2">{task.workflow_name}</dd>
            </div>
            <div className="flex bg-gray-50">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">Run</dt>
              <dd className="w-2/3 px-4 py-2">{task.run_id}</dd>
            </div>
            <div className="flex bg-white">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">当前 Attempt</dt>
              <dd className="w-2/3 px-4 py-2">{task.current_attempt ?? 1}</dd>
            </div>
            <div className="flex bg-gray-50">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">状态</dt>
              <dd className="w-2/3 px-4 py-2"><span className="inline-block px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs">{task.status}</span></dd>
            </div>
            <div className="flex bg-white">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">Badcase</dt>
              <dd className="w-2/3 px-4 py-2">{task.badcase_count}</dd>
            </div>
            <div className="flex bg-gray-50">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">执行参数</dt>
              <dd className="w-2/3 px-4 py-2">{formatExecutionConfig(task)}</dd>
            </div>
          </dl>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div 
            className="bg-blue-600 h-2.5 rounded-full" 
            style={{ width: `${taskProgress(task)}%` }}
            title={`进度：${taskProgress(task)}%`}
          ></div>
        </div>
      </div>
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
