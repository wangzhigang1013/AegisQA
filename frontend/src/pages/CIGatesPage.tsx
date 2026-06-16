import { CheckCircle, Plus, RefreshCw, Ban } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { CIGateConfigRecord, CIGateEvaluationPageResult, CIGateEvaluationRecord, CIGateEvaluationResult } from '../types';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/Dialog';
import { Input } from '../components/ui/Input';

type TargetKind = 'task' | 'run';

export function CIGatesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>();
  const [targetKind, setTargetKind] = useState<TargetKind>('task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [evaluation, setEvaluation] = useState<CIGateEvaluationResult | null>(null);
  const [evaluationPage, setEvaluationPage] = useState(1);
  const evaluationPageSize = 6;
  
  // Form State
  const [configName, setConfigName] = useState('');
  const [configDescription, setConfigDescription] = useState('');
  const [passRateThreshold, setPassRateThreshold] = useState<number>(0.8);
  const [badcaseThreshold, setBadcaseThreshold] = useState<number>(0);
  const [latencyThreshold, setLatencyThreshold] = useState<number>(3000);

  const configsQuery = useQuery({ queryKey: ['ci-gates'], queryFn: api.ciGateConfigs });
  const tasksQuery = useQuery({ queryKey: ['tasks-all'], queryFn: () => api.tasksPage({ page: 1, pageSize: 100 }) });
  const runsQuery = useQuery({ queryKey: ['runs', 'summary', 1, 100], queryFn: () => api.runsPage({ page: 1, pageSize: 100 }) });

  const configs = configsQuery.data ?? [];
  const tasks = tasksQuery.data?.items ?? [];
  const runs = runsQuery.data?.items ?? [];
  const activeConfigId = selectedConfigId ?? configs[0]?.config_id;
  const activeTaskId = selectedTaskId ?? tasks[0]?.task_id;
  const activeRunId = selectedRunId ?? runs[0]?.run_id;
  const canEvaluate = Boolean(activeConfigId && (targetKind === 'task' ? activeTaskId : activeRunId));
  
  const evaluationsQuery = useQuery({
    queryKey: ['ci-gate-evaluations', activeConfigId, evaluationPage, evaluationPageSize],
    queryFn: () => api.ciGateEvaluationsPage({ config_id: activeConfigId, page: evaluationPage, pageSize: evaluationPageSize }),
  });
  
  const evaluationHistory = evaluationsQuery.data?.items ?? [];
  const historySummary = buildHistorySummary(evaluationsQuery.data?.summary, evaluationHistory);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createCIGateConfig({
        name: configName,
        description: configDescription,
        status: 'active',
        gates: [
          {
            gate_id: 'pass-rate',
            metric: 'pass_rate',
            operator: '>=',
            threshold: passRateThreshold,
            blocking: true,
          },
          {
            gate_id: 'badcase-budget',
            metric: 'badcase_count',
            operator: '<=',
            threshold: badcaseThreshold,
            blocking: false,
          },
          {
            gate_id: 'latency-budget',
            metric: 'p95_latency_ms',
            operator: '<=',
            threshold: latencyThreshold,
            blocking: false,
          },
        ],
      }),
    onSuccess: async (config) => {
      setCreateOpen(false);
      setConfigName('');
      setConfigDescription('');
      setPassRateThreshold(0.8);
      setBadcaseThreshold(0);
      setLatencyThreshold(3000);
      setSelectedConfigId(config.config_id);
      setEvaluationPage(1);
      setNotice(`质量门禁配置已创建：${config.name}`);
      await queryClient.invalidateQueries({ queryKey: ['ci-gates'] });
    },
    onError: (error) => setNotice(`质量门禁配置创建失败：${formatApiError(error)}`),
  });

  const evaluateMutation = useMutation({
    mutationFn: () => {
      if (!activeConfigId) throw new Error('请先选择质量门禁配置。');
      if (targetKind === 'task') {
        if (!activeTaskId) throw new Error('请先选择任务。');
        return api.evaluateCIGates({ config_id: activeConfigId, task_id: activeTaskId });
      }
      if (!activeRunId) throw new Error('请先选择 Run。');
      return api.evaluateCIGates({ config_id: activeConfigId, run_id: activeRunId });
    },
    onSuccess: async (result) => {
      setEvaluation(result);
      setEvaluationPage(1);
      setNotice(result.status === 'blocked' ? `质量门禁阻断：${result.blocking_failures} 条阻断规则未通过。` : '质量门禁通过，可以进入后续发布流程。');
      await queryClient.invalidateQueries({ queryKey: ['ci-gate-evaluations'] });
    },
    onError: (error) => setNotice(`质量门禁评估失败：${formatApiError(error)}`),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!configName) return;
    createMutation.mutate();
  };

  return (
    <section className="page-stack flex flex-col gap-8">
      <PageHeader
        eyebrow="发布质量控制"
        title="CI Gate 质量门禁"
        description="把通过率、Badcase、耗时等指标固化为发布门槛，支持直接对任务或 Run 执行阻断评估。"
        primaryAction={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> 创建质量门禁
          </Button>
        }
      />

      {notice ? (
        <div className={`p-4 rounded-xl mb-4 border ${notice.includes('失败') || notice.includes('阻断') ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-green-50 border-green-200 text-green-700'} flex justify-between items-center`}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      ) : null}

      <PageSection title="评估中心" testId="ci-gates-evaluation-section">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Gate 评估控制台</CardTitle>
            <Button variant="outline" size="sm" onClick={() => void configsQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> 刷新配置
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
              <div className="flex flex-col gap-2 lg:col-span-3">
                <span className="text-sm text-slate-500 font-medium">质量门禁配置</span>
                <select
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={activeConfigId || ''}
                  onChange={(e) => {
                    setSelectedConfigId(e.target.value);
                    setEvaluationPage(1);
                  }}
                >
                  <option value="" disabled>选择质量门禁</option>
                  {configs.map((config) => (
                    <option key={config.config_id} value={config.config_id}>{config.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 lg:col-span-3">
                <span className="text-sm text-slate-500 font-medium">评估目标</span>
                <div className="flex rounded-xl overflow-hidden border border-slate-200 p-0.5 bg-slate-50">
                  <button
                    className={`flex-1 text-sm h-8 flex items-center justify-center rounded-lg transition-colors ${targetKind === 'task' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => setTargetKind('task')}
                  >
                    任务
                  </button>
                  <button
                    className={`flex-1 text-sm h-8 flex items-center justify-center rounded-lg transition-colors ${targetKind === 'run' ? 'bg-white shadow-sm font-medium text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => setTargetKind('run')}
                  >
                    Run
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 lg:col-span-4">
                <span className="text-sm text-slate-500 font-medium">{targetKind === 'task' ? '选择任务' : '选择 Run'}</span>
                {targetKind === 'task' ? (
                  <select
                    className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    value={activeTaskId || ''}
                    onChange={(e) => setSelectedTaskId(e.target.value)}
                  >
                    <option value="" disabled>选择任务</option>
                    {tasks.map((task) => (
                      <option key={task.task_id} value={task.task_id}>{task.name} / {task.status}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    value={activeRunId || ''}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                  >
                    <option value="" disabled>选择 Run</option>
                    {runs.map((run) => (
                      <option key={run.run_id} value={run.run_id}>{run.run_id} / {run.status}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="lg:col-span-2">
                <Button 
                  className="w-full" 
                  disabled={!canEvaluate || evaluateMutation.isPending} 
                  onClick={() => evaluateMutation.mutate()}
                >
                  {evaluateMutation.isPending ? '评估中...' : '执行 Gate 评估'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {evaluation && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
            <div className="lg:col-span-4">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>评估结果</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                      evaluation.status === 'passed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {evaluation.status === 'passed' ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                      {evaluation.status === 'passed' ? '通过' : '阻断'}
                    </span>
                  </div>
                  <div className="text-slate-700">阻断规则：<span className="font-semibold">{evaluation.blocking_failures}</span></div>
                  <div className="text-slate-500 text-sm">
                    目标：{evaluation.target ? `${evaluation.target.kind} / ${evaluation.target.id}` : '手动指标'}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-8">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>阻断原因</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {evaluation.results.map((item) => (
                    <div 
                      key={item.gate_id} 
                      className={`p-4 rounded-xl border flex flex-col gap-1 ${
                        item.status === 'passed' 
                          ? 'bg-green-50 border-green-200 text-green-800' 
                          : item.blocking 
                            ? 'bg-red-50 border-red-200 text-red-800' 
                            : 'bg-orange-50 border-orange-200 text-orange-800'
                      }`}
                    >
                      <div className="font-medium flex items-center gap-2">
                        {item.status === 'passed' ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                        {item.message}
                      </div>
                      <div className="text-sm opacity-80">
                        指标 {item.metric} 实际值 <span className="font-bold">{formatMetric(item.actual)}</span>，规则 {item.operator} {formatMetric(item.threshold)}，{item.blocking ? '阻断' : '仅预警'}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </PageSection>

      <PageSection title="评估报表" testId="ci-gates-report-section">
        <Card>
          <CardHeader>
            <CardTitle>历史趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <HistoryTile title="历史评估" value={historySummary.total} note={`最近：${historySummary.latestStatus}`} />
              <HistoryTile title="阻断次数" value={historySummary.blocked} note="blocking gate 未通过" />
              <HistoryTile title="通过次数" value={historySummary.passed} note="可进入发布流程" />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>评估历史</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">评估 ID</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">目标</th>
                      <th className="px-4 py-3 font-medium">阻断规则</th>
                      <th className="px-4 py-3 font-medium">主要原因</th>
                      <th className="px-4 py-3 font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {evaluationHistory.map((record) => (
                      <tr key={record.evaluation_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3"><code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-800">{record.evaluation_id}</code></td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                            record.status === 'passed' ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20' : 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20'
                          }`}>
                            {record.status === 'passed' ? '通过' : '阻断'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatTarget(record.target)}</td>
                        <td className="px-4 py-3 text-slate-700">{record.blocking_failures}</td>
                        <td className="px-4 py-3 text-slate-700">{record.results.find((item) => item.status === 'failed')?.message ?? '全部规则通过'}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(record.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                    {evaluationHistory.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          {evaluationsQuery.isLoading ? '加载中...' : '暂无数据'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="flex justify-between items-center mt-4 text-sm text-slate-500">
              <button 
                disabled={evaluationPage <= 1}
                onClick={() => setEvaluationPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-slate-50"
              >
                上一页
              </button>
              <span>第 {evaluationPage} 页</span>
              <button 
                disabled={evaluationHistory.length < evaluationPageSize}
                onClick={() => setEvaluationPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-slate-50"
              >
                下一页
              </button>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="门禁配置" testId="ci-gates-config-section">
        <Card>
          <CardHeader>
            <CardTitle>质量门禁配置列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">配置名称</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">规则数</th>
                      <th className="px-4 py-3 font-medium">规则摘要</th>
                      <th className="px-4 py-3 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {configs.map((record) => (
                      <tr key={record.config_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <button 
                            className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                            onClick={() => setSelectedConfigId(record.config_id)}
                          >
                            {record.name}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                            record.status === 'active' ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{record.gates.length}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {record.gates.map((gate) => (
                              <span key={gate.gate_id} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                                gate.blocking ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10' : 'bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20'
                              }`}>
                                {gate.metric} {gate.operator} {formatMetric(gate.threshold)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 max-w-xs truncate" title={record.description}>{record.description}</td>
                      </tr>
                    ))}
                    {configs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          {configsQuery.isLoading ? '加载中...' : '暂无数据'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建质量门禁配置</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">配置名称 <span className="text-red-500">*</span></label>
              <Input 
                placeholder="例如：发布质量门禁" 
                value={configName} 
                onChange={(e) => setConfigName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">说明</label>
              <textarea
                className="flex w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
                rows={3}
                placeholder="说明这个门禁适用于发布、回归还是线上评分。"
                value={configDescription}
                onChange={(e) => setConfigDescription(e.target.value)}
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex flex-col">通过率下限</label>
                <Input 
                  type="number" 
                  min="0" max="1" step="0.01" 
                  value={passRateThreshold} 
                  onChange={(e) => setPassRateThreshold(parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex flex-col">Badcase 上限</label>
                <Input 
                  type="number" 
                  min="0" step="1" 
                  value={badcaseThreshold} 
                  onChange={(e) => setBadcaseThreshold(parseInt(e.target.value, 10))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex flex-col">P95 耗时上限(ms)</label>
                <Input 
                  type="number" 
                  min="1" step="100" 
                  value={latencyThreshold} 
                  onChange={(e) => setLatencyThreshold(parseInt(e.target.value, 10))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={!configName || createMutation.isPending}>
                {createMutation.isPending ? '保存中...' : '保存配置'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function formatMetric(value: unknown): string {
  if (typeof value !== 'number') return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function HistoryTile({ title, value, note }: { title: string; value: number; note: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-6">
        <h3 className="text-sm font-medium text-slate-500 mb-2">{title}</h3>
        <div className="text-3xl font-bold text-slate-900 mb-2">{value}</div>
        <div className="text-sm text-slate-400">{note}</div>
      </CardContent>
    </Card>
  );
}

function buildHistorySummary(summary: CIGateEvaluationPageResult['summary'] | undefined, history: CIGateEvaluationRecord[]) {
  if (summary) {
    return {
      total: summary.total_evaluations,
      blocked: summary.blocked,
      passed: summary.passed,
      latestStatus: formatHistoryStatus(summary.latest_status),
    };
  }
  const blocked = history.filter((item) => item.status === 'blocked').length;
  const passed = history.filter((item) => item.status === 'passed').length;
  const latest = history[history.length - 1];
  return {
    total: history.length,
    blocked,
    passed,
    latestStatus: latest ? (latest.status === 'passed' ? '通过' : '阻断') : '暂无',
  };
}

function formatHistoryStatus(status: string): string {
  if (status === 'passed') return '通过';
  if (status === 'blocked') return '阻断';
  return status || '暂无';
}

function formatTarget(target: CIGateEvaluationRecord['target']): string {
  if (!target) return '手动指标';
  return `${target.kind} / ${target.id}`;
}
