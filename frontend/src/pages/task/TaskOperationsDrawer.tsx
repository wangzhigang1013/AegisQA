// @ts-nocheck
import { Download, PauseCircle, PlayCircle, RefreshCw, XCircle, StopCircle, Info, CheckCircle } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { workbenchActionId } from '../../actions/actionRouter';
import { api, formatApiError } from '../../api/client';
import type { TaskPreflightResult, TaskRecord, TaskResultsExportDownload } from '../../types';
import { TaskSnapshotPanel, formatExecutionConfig } from './TaskSnapshotPanel';
import { Modal, Button } from '../../components/AntdShims';
import { Card } from '../../components/ui/Card';

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
  const [activeTab, setActiveTab] = useState('overview');
  
  const taskDetailQuery = useQuery({
    queryKey: ['task', task?.task_id, 'operations-detail'],
    queryFn: () => api.task(task?.task_id ?? ''),
    enabled: Boolean(task?.task_id),
  });
  const activeTask = selectLatestTask(task, taskDetailQuery.data);
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
      if (!activeTask) {
        throw new Error('请先选择任务，再导出结果。');
      }
      const exported = await api.exportTaskResults(activeTask.task_id, format);
      return { exported, task: activeTask };
    },
    onSuccess: ({ exported, task: exportedTask }) => {
      const filename = downloadTaskResultsExport(exported, exportedTask);
      setNotice(`结果导出成功：${filename} 已开始下载。`);
    },
    onError: (error) => setNotice(`结果导出失败：${formatApiError(error)}`),
  });

  return (
    <Modal 
      open={Boolean(task)} 
      onCancel={onClose}
      title={activeTask ? `任务详情：${activeTask.name}` : '任务详情'}
      footer={null}
      width={1000}
    >
      {activeTask ? (
        <div className="space-y-6 mt-4">
          <div className="flex flex-wrap gap-2">
            <TaskActionButton task={activeTask} action="execute" loading={loading || taskDetailQuery.isFetching} onClick={onAction} icon={<PlayCircle className="w-4 h-4" />} label="执行" />
            <TaskActionButton task={activeTask} action="pause" loading={loading || taskDetailQuery.isFetching} onClick={onAction} icon={<PauseCircle className="w-4 h-4" />} label="暂停" />
            <TaskActionButton task={activeTask} action="resume" loading={loading || taskDetailQuery.isFetching} onClick={onAction} icon={<PlayCircle className="w-4 h-4" />} label="恢复" />
            <TaskActionButton task={activeTask} action="cancel" loading={loading || taskDetailQuery.isFetching} onClick={onAction} icon={<StopCircle className="w-4 h-4" />} label="取消" danger />
            <TaskActionButton task={activeTask} action="retry" loading={loading || taskDetailQuery.isFetching} onClick={onAction} icon={<RefreshCw className="w-4 h-4" />} label="重试失败项" />
            <TaskActionButton task={activeTask} action="attempt" loading={loading || taskDetailQuery.isFetching} onClick={onAction} icon={<RefreshCw className="w-4 h-4" />} label="新建 Attempt" />
            <a href={`/tasks/${activeTask.task_id}/trace?return_task_id=${encodeURIComponent(activeTask.task_id)}`} className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">查看 Trace Flow</a>
            <a href={`/tasks/${activeTask.task_id}/trace-tree?return_task_id=${encodeURIComponent(activeTask.task_id)}`} className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">查看 Trace Tree</a>
            <Button variant="outline" icon={<Download className="w-4 h-4" />} loading={exportResultsMutation.isPending && exportResultsMutation.variables === 'csv'} disabled={exportResultsMutation.isPending} onClick={() => exportResultsMutation.mutate('csv')}>导出结果 CSV</Button>
            <Button variant="outline" icon={<Download className="w-4 h-4" />} loading={exportResultsMutation.isPending && exportResultsMutation.variables === 'jsonl'} disabled={exportResultsMutation.isPending} onClick={() => exportResultsMutation.mutate('jsonl')}>导出结果 JSONL</Button>
          </div>
          
          {notice && (
            <div className={`flex items-center justify-between p-4 rounded-md border ${notice.includes('失败') ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
              <div className="flex items-center gap-2">
                {notice.includes('失败') ? <XCircle className="w-5 h-5 text-red-500" /> : <CheckCircle className="w-5 h-5 text-green-500" />}
                <span>{notice}</span>
              </div>
              <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-gray-700">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          )}

          <div>
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                {[
                  { id: 'overview', label: '概览' },
                  { id: 'items', label: '样本' },
                  { id: 'trace', label: 'Trace' },
                  { id: 'badcase', label: 'Badcase' },
                  { id: 'attempts', label: 'Attempts' },
                  { id: 'params', label: '参数' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
            
            <div className="mt-4">
              {activeTab === 'overview' && <TaskSnapshotPanel task={activeTask} />}
              
              {activeTab === 'items' && (
                <Card title="样本执行进度">
                  <div className="border border-gray-200 rounded-md overflow-hidden">
                    <dl className="divide-y divide-gray-200 text-sm">
                      <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">总样本</dt><dd className="w-2/3 px-4 py-2">{activeTask.total_items}</dd></div>
                      <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">已完成</dt><dd className="w-2/3 px-4 py-2">{activeTask.completed_items}</dd></div>
                      <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">失败</dt><dd className="w-2/3 px-4 py-2">{activeTask.failed_items}</dd></div>
                      <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">队列消息</dt><dd className="w-2/3 px-4 py-2">执行队列仅携带 item_id，样本内容从 Dataset Version 按 item_id 回读。</dd></div>
                    </dl>
                  </div>
                </Card>
              )}
              
              {activeTab === 'trace' && (
                <Card title="Trace Tree">
                  {traceQuery.data?.items?.length ? (
                    <div className="space-y-4 px-2 pt-2">
                      {traceQuery.data.items.slice(0, 5).map((item, i) => (
                        <div key={i} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div className={`w-3 h-3 rounded-full mt-1.5 ${item.status === 'succeeded' ? 'bg-green-500' : item.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`} />
                            {i !== (traceQuery.data.items.length) - 1 && <div className="w-0.5 h-full bg-gray-200 my-1" />}
                          </div>
                          <div className="pb-4 text-sm">
                            {item.item_id} / {item.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
                      <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
                      <p className="text-sm mt-0.5">执行任务后展示 Skill 级调用树、输入输出、耗时、错误和缓存命中。</p>
                    </div>
                  )}
                </Card>
              )}
              
              {activeTab === 'badcase' && (
                <Card title="Badcase">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 border">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                          <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">原因</th>
                          <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(reportQuery.data?.badcases ?? []).map((record) => (
                          <tr key={String(record.badcase_id ?? record.item_id)}>
                            <td className="px-4 py-2 text-sm text-gray-900">{record.item_id}</td>
                            <td className="px-4 py-2 text-sm text-gray-600">{record.reason}</td>
                            <td className="px-4 py-2 text-sm"><span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs">{String(record.status ?? 'pending')}</span></td>
                          </tr>
                        ))}
                        {!(reportQuery.data?.badcases?.length) && (
                          <tr><td colSpan={3} className="px-4 py-4 text-center text-sm text-gray-500">暂无 Badcase</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              
              {activeTab === 'attempts' && (
                <Card title="Run Attempts">
                  {activeTask.attempts?.length ? (
                    <div className="space-y-4 px-2 pt-2">
                      {activeTask.attempts.map((attempt, i) => {
                        const isActive = attempt.run_id === activeTask.run_id;
                        const isCompleted = attempt.status === 'completed';
                        const color = isActive ? 'bg-blue-500' : isCompleted ? 'bg-green-500' : 'bg-gray-400';
                        return (
                          <div key={i} className="flex gap-4">
                            <div className="flex flex-col items-center">
                              <div className={`w-3 h-3 rounded-full mt-1.5 ${color}`} />
                              {i !== (activeTask.attempts!.length) - 1 && <div className="w-0.5 h-full bg-gray-200 my-1" />}
                            </div>
                            <div className="pb-4 text-sm">
                              #{attempt.attempt_index} / {attempt.status} / {attempt.run_id} / 通过率 {Math.round(Number(attempt.pass_rate ?? 0) * 100)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
                      <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
                      <p className="text-sm mt-0.5">当前任务还没有历史 Attempt。重新执行时会保留旧报告并创建新的 Run。</p>
                    </div>
                  )}
                </Card>
              )}
              
              {activeTab === 'params' && (
                <Card title="任务冻结参数">
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">{formatExecutionConfig(activeTask)}</p>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto border border-gray-200">{JSON.stringify(activeTask.execution_config ?? {}, null, 2)}</pre>
                    
                    <PreflightEvidenceCard task={activeTask} />
                    
                    <h5 className="font-medium text-gray-900 mt-6">Skill 参数来源</h5>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 border">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Step</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Skill</th>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">参数追踪</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {(traceFlowQuery.data?.items?.[0]?.steps ?? []).map((step, idx) => (
                            <tr key={step.step_id || idx}>
                              <td className="px-4 py-2 text-sm text-gray-900">{step.step_id}</td>
                              <td className="px-4 py-2 text-sm text-gray-600">{step.skill_ref}</td>
                              <td className="px-4 py-2 text-sm">
                                <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto border border-gray-200">{JSON.stringify(step.parameter_trace ?? {}, null, 2)}</pre>
                              </td>
                            </tr>
                          ))}
                          {!(traceFlowQuery.data?.items?.[0]?.steps?.length) && (
                            <tr><td colSpan={3} className="px-4 py-4 text-center text-sm text-gray-500">暂无参数来源数据</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-500">Secret 参数在 Trace Flow 中只展示 secret_ref 或脱敏预览，不展示明文。</p>
                  </div>
                </Card>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="destructive" onClick={onClose}>
                关闭面板
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function PreflightEvidenceCard({ task }: { task: TaskRecord }) {
  const preflight = task.preflight_result;
  const preflightId = task.execution_config?.preflight_id ?? preflight?.preflight_id;
  
  if (!preflight) {
    return (
      <div className="border rounded-md p-4 bg-white mt-4">
        <h4 className="font-medium text-gray-900 border-b pb-2 mb-4">创建前 Preflight 证据</h4>
        <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
          <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
          <p className="text-sm mt-0.5">当前任务没有保存 Preflight 结果，可能来自旧版本任务或导入数据。</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="border rounded-md p-4 bg-white mt-4">
      <h4 className="font-medium text-gray-900 border-b pb-2 mb-4">创建前 Preflight 证据</h4>
      <div className="space-y-4">
        <div className="border border-gray-200 rounded-md overflow-hidden">
          <dl className="divide-y divide-gray-200 text-sm">
            <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">Preflight ID</dt><dd className="w-2/3 px-4 py-2">{preflightId ? <code className="bg-gray-100 px-1 rounded">{preflightId}</code> : '未持久化'}</dd></div>
            <div className="flex bg-white">
              <dt className="w-1/3 px-4 py-2 font-medium text-gray-500">状态</dt>
              <dd className="w-2/3 px-4 py-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  preflight.status === 'passed' ? 'bg-green-100 text-green-800' :
                  preflight.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                  preflight.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {preflight.status}
                </span>
              </dd>
            </div>
            <div className="flex bg-gray-50"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">生成时间</dt><dd className="w-2/3 px-4 py-2">{preflight.created_at ?? '未记录'}</dd></div>
            <div className="flex bg-white"><dt className="w-1/3 px-4 py-2 font-medium text-gray-500">摘要</dt><dd className="w-2/3 px-4 py-2">{preflight.summary}</dd></div>
          </dl>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 border">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">检查项</th>
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">结果</th>
                <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">修复建议</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(preflight.checks ?? []).map(check => (
                <tr key={check.check_id}>
                  <td className="px-4 py-2 text-sm text-gray-900">{check.title}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                      check.status === 'passed' ? 'bg-green-100 text-green-800' :
                      check.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                      check.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {String(check.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{check.message}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{String(check.recommendation || '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function selectLatestTask(parentTask: TaskRecord | null, queriedTask?: TaskRecord): TaskRecord | null {
  if (!parentTask) return queriedTask ?? null;
  if (!queriedTask) return parentTask;
  const parentUpdatedAt = Date.parse(parentTask.updated_at ?? '');
  const queriedUpdatedAt = Date.parse(queriedTask.updated_at ?? '');
  if (Number.isFinite(parentUpdatedAt) && Number.isFinite(queriedUpdatedAt) && parentUpdatedAt > queriedUpdatedAt) {
    return parentTask;
  }
  return queriedTask;
}

function downloadTaskResultsExport(exported: TaskResultsExportDownload, task: TaskRecord) {
  const format = exported.file_format || 'csv';
  const filename = exported.filename || `${safeTaskResultFileName(task.name || task.task_id)}_results.${format}`;
  const blob = exported.blob.type ? exported.blob : new Blob([exported.blob], { type: taskResultExportMimeTypes[format] ?? 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
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
  const actionState = task.available_actions?.find((item) => workbenchActionId(item) === action);
  const disabledReason = actionState
    ? (actionState.enabled === false || actionState.disabled ? actionState.disabled_reason ?? '当前动作不可执行。' : null)
    : taskActionDisabledReason(task, action);
  const actionLabel = actionState?.label ?? label;
  
  const button = (
    <Button 
      variant={danger ? 'danger' : 'outline'} 
      icon={icon} 
      loading={loading} 
      disabled={Boolean(disabledReason)} 
      onClick={() => onClick(task, action)}
      title={disabledReason || undefined}
    >
      {actionLabel}
    </Button>
  );
  
  return button;
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
