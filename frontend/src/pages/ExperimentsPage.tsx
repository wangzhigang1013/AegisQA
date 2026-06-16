import { FlaskConical, Plus, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { ExperimentRecord } from '../types';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/Dialog';
import { Input } from '../components/ui/Input';

export function ExperimentsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [baselineExperimentId, setBaselineExperimentId] = useState<string | null>(null);
  const [datasetFilter, setDatasetFilter] = useState<string>('');
  const [workflowFilter, setWorkflowFilter] = useState<string>('');
  
  // Form state
  const [experimentName, setExperimentName] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [baselineRunId, setBaselineRunId] = useState('');

  const allExperimentsQuery = useQuery({ queryKey: ['experiments', 'all'], queryFn: () => api.experiments() });
  const experimentsQuery = useQuery({
    queryKey: ['experiments', datasetFilter, workflowFilter],
    queryFn: () => api.experiments({ 
      dataset_id: datasetFilter || undefined, 
      workflow_id: workflowFilter || undefined 
    }),
  });
  const runsQuery = useQuery({ queryKey: ['runs', 'summary', 1, 100], queryFn: () => api.runsPage({ page: 1, pageSize: 100 }) });
  
  const experiments = experimentsQuery.data ?? [];
  const allExperiments = allExperimentsQuery.data ?? experiments;
  const activeExperiment = experiments.find((item) => item.experiment_id === selectedExperimentId) ?? experiments[0];
  const selectedBaseline =
    allExperiments.find((item) => item.experiment_id === baselineExperimentId) ??
    allExperiments.find((item) => item.run_id === activeExperiment?.baseline_run_id);
    
  const comparison = useMemo(() => buildComparison(activeExperiment, selectedBaseline), [activeExperiment, selectedBaseline]);
  const failureDistribution = useMemo(() => buildFailureDistribution(activeExperiment, selectedBaseline), [activeExperiment, selectedBaseline]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createExperimentFromRun({
        name: experimentName,
        run_id: selectedRunId,
        baseline_run_id: baselineRunId || null,
        tags: ['ui-created'],
      }),
    onSuccess: async (experiment) => {
      setNotice(`实验快照已生成：${experiment.name}`);
      setModalOpen(false);
      setExperimentName('');
      setSelectedRunId('');
      setBaselineRunId('');
      setSelectedExperimentId(experiment.experiment_id);
      await queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
    onError: (error) => setNotice(`实验快照生成失败：${formatApiError(error)}`),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRunId || !experimentName) return;
    createMutation.mutate();
  };

  return (
    <section className="page-stack flex flex-col gap-8">
      <PageHeader
        eyebrow="实验与对比"
        title="Experiment 实验中心"
        description="把正式 Run 固化为不可变实验快照，并和 baseline 对比通过率、失败样本与成本变化。"
        primaryAction={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> 生成实验快照
          </Button>
        }
      />

      {notice ? (
        <div className={`p-4 rounded-xl mb-4 border ${notice.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'} flex justify-between items-center`}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      ) : null}

      <PageSection title="实验监控" testId="experiments-monitor-section">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Baseline 对比</CardTitle>
            <Button variant="outline" size="sm" onClick={() => void experimentsQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> 刷新
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-500 font-medium">Dataset 过滤</span>
                <select
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={datasetFilter}
                  onChange={(e) => setDatasetFilter(e.target.value)}
                >
                  <option value="">按 Dataset 过滤 (所有)</option>
                  {uniqueOptions(allExperiments, 'dataset_id').map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-500 font-medium">Workflow 过滤</span>
                <select
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={workflowFilter}
                  onChange={(e) => setWorkflowFilter(e.target.value)}
                >
                  <option value="">按 Workflow 过滤 (所有)</option>
                  {uniqueOptions(allExperiments, 'workflow_id', (item) => item.workflow_name ?? item.workflow_id ?? '-').map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-500 font-medium">过滤结果</span>
                <div>
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                    {experiments.length} 个实验快照
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-500 font-medium">当前实验</span>
                <select
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={activeExperiment?.experiment_id || ''}
                  onChange={(e) => setSelectedExperimentId(e.target.value)}
                >
                  {experiments.map((item) => (
                    <option key={item.experiment_id} value={item.experiment_id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-500 font-medium">Baseline</span>
                <select
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={baselineExperimentId || ''}
                  onChange={(e) => setBaselineExperimentId(e.target.value || null)}
                >
                  <option value="">选择 baseline 实验</option>
                  {allExperiments.filter((item) => item.experiment_id !== activeExperiment?.experiment_id).map((item) => (
                    <option key={item.experiment_id} value={item.experiment_id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-500 font-medium">快照状态</span>
                <div>
                  <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                    activeExperiment?.status === 'snapshotted' 
                      ? 'bg-green-50 text-green-700 ring-green-600/20' 
                      : 'bg-blue-50 text-blue-700 ring-blue-700/10'
                  }`}>
                    {activeExperiment?.status ?? '暂无实验'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <ComparisonCard title="通过率变化" value={formatPercentDelta(comparison.passRateDelta)} />
              <ComparisonCard title="失败样本变化" value={formatNumberDelta(comparison.badcaseDelta)} />
              <ComparisonCard title="P95 耗时变化" value={formatLatencyDelta(comparison.latencyDelta)} />
              <ComparisonCard title="成本变化" value={formatCurrencyDelta(comparison.costDelta)} />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="诊断对比" testId="experiments-diagnosis-section">
        <Card>
          <CardHeader>
            <CardTitle>A/B 对比面板</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-medium text-slate-700">
                  指标对比
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-white border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">指标</th>
                        <th className="px-4 py-3 font-medium">当前实验</th>
                        <th className="px-4 py-3 font-medium">Baseline</th>
                        <th className="px-4 py-3 font-medium">变化</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {buildMetricRows(activeExperiment, selectedBaseline).map((row) => (
                        <tr key={row.metric} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{row.label}</td>
                          <td className="px-4 py-3 text-slate-600">{row.current}</td>
                          <td className="px-4 py-3 text-slate-600">{row.baseline}</td>
                          <td className="px-4 py-3 font-medium">{row.delta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-medium text-slate-700">
                  失败分布对比
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-white border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">失败原因</th>
                        <th className="px-4 py-3 font-medium">当前实验</th>
                        <th className="px-4 py-3 font-medium">Baseline</th>
                        <th className="px-4 py-3 font-medium">变化</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {failureDistribution.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-500">暂无数据</td>
                        </tr>
                      ) : failureDistribution.map((row) => (
                        <tr key={row.reason} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{row.reason}</td>
                          <td className="px-4 py-3 text-slate-600">{row.current}</td>
                          <td className="px-4 py-3 text-slate-600">{row.baseline}</td>
                          <td className="px-4 py-3 font-medium">{row.delta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="快照存档" testId="experiments-list-section">
        <Card>
          <CardHeader>
            <CardTitle>实验快照列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">实验名称</th>
                      <th className="px-4 py-3 font-medium">Run</th>
                      <th className="px-4 py-3 font-medium">Baseline Run</th>
                      <th className="px-4 py-3 font-medium">通过率</th>
                      <th className="px-4 py-3 font-medium">Badcase</th>
                      <th className="px-4 py-3 font-medium">成本</th>
                      <th className="px-4 py-3 font-medium">标签</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {experiments.map((record) => (
                      <tr key={record.experiment_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <button 
                            className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                            onClick={() => setSelectedExperimentId(record.experiment_id)}
                          >
                            {record.name}
                          </button>
                        </td>
                        <td className="px-4 py-3"><code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-800">{record.run_id}</code></td>
                        <td className="px-4 py-3">
                          {record.baseline_run_id ? (
                            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-800">{record.baseline_run_id}</code>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatPercent(record.metrics.pass_rate)}</td>
                        <td className="px-4 py-3 text-slate-700">{record.metrics.badcase_count ?? 0}</td>
                        <td className="px-4 py-3 text-slate-700">{formatCurrency(record.metrics.cost)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {record.tags?.map((tag) => (
                              <span key={tag} className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {experiments.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          {experimentsQuery.isLoading ? '加载中...' : '暂无数据'}
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

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>从 Run 生成实验快照</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">实验名称 <span className="text-red-500">*</span></label>
              <Input 
                placeholder="例如：RAG v2 回归实验" 
                value={experimentName} 
                onChange={(e) => setExperimentName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">选择 Run <span className="text-red-500">*</span></label>
              <select
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={selectedRunId}
                onChange={(e) => setSelectedRunId(e.target.value)}
                required
              >
                <option value="" disabled>选择已完成 Run</option>
                {(runsQuery.data?.items ?? []).map((run) => (
                  <option key={run.run_id} value={run.run_id}>{run.run_id} / {run.status}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Baseline Run</label>
              <select
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                value={baselineRunId}
                onChange={(e) => setBaselineRunId(e.target.value)}
              >
                <option value="">可选，用于生成 diff</option>
                {(runsQuery.data?.items ?? []).map((run) => (
                  <option key={run.run_id} value={run.run_id}>{run.run_id} / {run.status}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="submit" disabled={!selectedRunId || !experimentName || createMutation.isPending}>
                {createMutation.isPending ? '生成中...' : '确认生成'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ComparisonCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-500">{title}</h3>
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
            <FlaskConical className="w-4 h-4" />
          </div>
        </div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
      </CardContent>
    </Card>
  );
}

function buildComparison(active?: ExperimentRecord, selectedBaseline?: ExperimentRecord) {
  const diff = active?.diff ?? diffMetrics(active?.metrics, selectedBaseline?.metrics);
  return {
    passRateDelta: numberMetric(diff?.pass_rate),
    badcaseDelta: numberMetric(diff?.badcase_count),
    latencyDelta: numberMetric(diff?.p95_latency_ms),
    costDelta: numberMetric(diff?.cost),
  };
}

function diffMetrics(metrics?: Record<string, number>, baseline?: Record<string, number> | null): Record<string, number> {
  if (!metrics || !baseline) return {};
  const keys = new Set([...Object.keys(metrics), ...Object.keys(baseline)]);
  return Array.from(keys).reduce<Record<string, number>>((result, key) => {
    result[key] = (metrics[key] ?? 0) - (baseline[key] ?? 0);
    return result;
  }, {});
}

function numberMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-';
}

function formatPercentDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
}

function formatNumberDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function formatCurrency(value: unknown): string {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : '-';
}

function formatCurrencyDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`;
}

function formatLatencyDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value)} ms`;
}

function uniqueOptions(experiments: ExperimentRecord[], key: 'dataset_id' | 'workflow_id', labelOf?: (experiment: ExperimentRecord) => string) {
  const seen = new Map<string, string>();
  experiments.forEach((experiment) => {
    const value = experiment[key];
    if (value && !seen.has(value)) {
      seen.set(value, labelOf ? labelOf(experiment) : value);
    }
  });
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
}

function buildMetricRows(active?: ExperimentRecord, baseline?: ExperimentRecord) {
  return [
    {
      metric: 'pass_rate',
      label: '通过率',
      current: formatPercent(active?.metrics.pass_rate),
      baseline: formatPercent(baseline?.metrics.pass_rate),
      delta: formatPercentDelta(numberMetric(active?.metrics.pass_rate) - numberMetric(baseline?.metrics.pass_rate)),
    },
    {
      metric: 'badcase_count',
      label: 'Badcase',
      current: numberMetric(active?.metrics.badcase_count),
      baseline: numberMetric(baseline?.metrics.badcase_count),
      delta: formatNumberDelta(numberMetric(active?.metrics.badcase_count) - numberMetric(baseline?.metrics.badcase_count)),
    },
    {
      metric: 'p95_latency_ms',
      label: 'P95 耗时',
      current: `${Math.round(numberMetric(active?.metrics.p95_latency_ms))} ms`,
      baseline: `${Math.round(numberMetric(baseline?.metrics.p95_latency_ms))} ms`,
      delta: formatLatencyDelta(numberMetric(active?.metrics.p95_latency_ms) - numberMetric(baseline?.metrics.p95_latency_ms)),
    },
    {
      metric: 'cost',
      label: '成本',
      current: formatCurrency(active?.metrics.cost),
      baseline: formatCurrency(baseline?.metrics.cost),
      delta: formatCurrencyDelta(numberMetric(active?.metrics.cost) - numberMetric(baseline?.metrics.cost)),
    },
  ];
}

function buildFailureDistribution(active?: ExperimentRecord, baseline?: ExperimentRecord) {
  const current = active?.failure_distribution ?? {};
  const base = baseline?.failure_distribution ?? {};
  const reasons = Array.from(new Set([...Object.keys(current), ...Object.keys(base)]));
  return reasons.map((reason) => ({
    reason,
    current: current[reason] ?? 0,
    baseline: base[reason] ?? 0,
    delta: formatNumberDelta((current[reason] ?? 0) - (base[reason] ?? 0)),
  }));
}
