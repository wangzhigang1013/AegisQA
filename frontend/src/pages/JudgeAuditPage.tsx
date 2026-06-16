// @ts-nocheck
import { ClipboardCheck, GitMerge } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { LazyECharts } from '../components/LazyECharts';
import { MetricTile } from '../components/MetricTile';
import { PageHeader } from '../components/PageHeader';

import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/Dialog';

type AuditFormValues = {
  profile_id?: string;
  dataset_version_id: string;
  human_labels: string;
  judge_labels: string;
};

type ProfileFormValues = {
  name: string;
  model: string;
  prompt: string;
  threshold: number;
};

type CrossValidationFormValues = {
  dataset_version_id: string;
  human_labels: string;
  judge_outputs_json: string;
};

export function JudgeAuditPage() {
  const queryClient = useQueryClient();
  const [auditOpen, setAuditOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [crossOpen, setCrossOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  
  // State for forms
  const [auditForm, setAuditForm] = useState<AuditFormValues>({
    dataset_version_id: 'dataset:v1',
    human_labels: 'pass,fail',
    judge_labels: 'pass,pass'
  });
  
  const [profileForm, setProfileForm] = useState<ProfileFormValues>({
    name: '默认裁判',
    model: 'demo-model',
    prompt: '请判断回答是否满足参考答案。',
    threshold: 0.6
  });
  
  const [crossForm, setCrossForm] = useState<CrossValidationFormValues>({
    dataset_version_id: 'dataset-demo:v1',
    human_labels: 'pass,fail',
    judge_outputs_json: JSON.stringify({ 'judge-a': ['pass', 'fail'], 'judge-b': ['pass', 'pass'] }, null, 2)
  });

  const profilesQuery = useQuery({ queryKey: ['judge-profiles'], queryFn: api.judgeProfiles });
  const auditsQuery = useQuery({ queryKey: ['judge-audits'], queryFn: api.judgeAudits });
  const trendsQuery = useQuery({ queryKey: ['judge-audit-trends'], queryFn: api.judgeAuditTrends });
  const latestAudit = auditsQuery.data?.[0] ?? null;

  const createProfileMutation = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      api.createJudgeProfile({
        name: values.name,
        model: values.model,
        prompt: values.prompt,
        threshold: values.threshold,
        rubric: { pass: '满足评测标准', fail: '不满足评测标准' },
        output_schema: { type: 'object', properties: { label: { type: 'string' }, score: { type: 'number' } } },
      }),
    onSuccess: async (profile) => {
      setNotice(`Judge Profile 已创建：${profile.name}`);
      setProfileOpen(false);
      // reset logic can be done if needed, but not strictly necessary since initial values are re-used
      await queryClient.invalidateQueries({ queryKey: ['judge-profiles'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `创建 Profile 失败：${error.message}` : '创建 Profile 失败'),
  });

  const createAuditMutation = useMutation({
    mutationFn: (values: AuditFormValues) => {
      const profileId = values.profile_id ?? profilesQuery.data?.[0]?.profile_id;
      if (!profileId) {
        throw new Error('请先创建或选择 Judge Profile');
      }
      const humanLabels = values.human_labels.split(',').map((item) => item.trim()).filter(Boolean);
      const judgeLabels = values.judge_labels.split(',').map((item) => item.trim()).filter(Boolean);
      return api.createJudgeAudit(profileId, {
        dataset_version_id: values.dataset_version_id,
        human_labels: humanLabels,
        judge_labels: judgeLabels,
      });
    },
    onSuccess: async (audit) => {
      setNotice(`审计完成：Accuracy ${audit.accuracy.toFixed(2)}`);
      setAuditOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['judge-audits'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `创建审计失败：${error.message}` : '创建审计失败'),
  });

  const crossValidationMutation = useMutation({
    mutationFn: (values: CrossValidationFormValues) => {
      const judgeOutputs = JSON.parse(values.judge_outputs_json) as Record<string, string[]>;
      return api.crossValidateJudges({
        dataset_version_id: values.dataset_version_id,
        human_labels: values.human_labels.split(',').map((item) => item.trim()).filter(Boolean),
        judge_outputs_by_profile: judgeOutputs,
      });
    },
    onSuccess: () => setNotice('多 Judge 一致性分析完成。'),
    onError: (error) => setNotice(error instanceof Error ? `一致性分析失败：${error.message}` : '一致性分析失败'),
  });

  const matrixOption = useMemo(() => {
    const matrix = latestAudit?.confusion_matrix ?? { pass: { pass: 0, fail: 0 }, fail: { pass: 0, fail: 0 } };
    const labels = Object.keys(matrix);
    return {
      tooltip: {},
      xAxis: { type: 'category', data: labels.map((label) => `judge: ${label}`) },
      yAxis: { type: 'category', data: labels.map((label) => `human: ${label}`) },
      visualMap: { min: 0, max: 12, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
      series: [
        {
          type: 'heatmap',
          data: labels.flatMap((human, y) => labels.map((judge, x) => [x, y, matrix[human]?.[judge] ?? 0])),
        },
      ],
    };
  }, [latestAudit]);

  const trendsOption = useMemo(() => {
    const profile = trendsQuery.data?.profiles[0];
    const series = profile?.series ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Accuracy', 'Kappa'] },
      grid: { left: 36, right: 20, top: 40, bottom: 32 },
      xAxis: { type: 'category', data: series.map((item) => item.dataset_version_id) },
      yAxis: { type: 'value', min: 0, max: 1 },
      series: [
        { name: 'Accuracy', type: 'line', data: series.map((item) => item.accuracy), smooth: true },
        { name: 'Kappa', type: 'line', data: series.map((item) => item.cohen_kappa), smooth: true },
      ],
    };
  }, [trendsQuery.data]);

  return (
    <section className="page-stack flex flex-col gap-6">
      <PageHeader
        eyebrow="裁判可信度"
        title="Judge 审计"
        description="用 Golden Dataset 审计 Judge Profile，关注 Accuracy、Precision、Recall、F1、Kappa 和多裁判一致性。"
        primaryAction={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setProfileOpen(true)}>
              <GitMerge className="mr-2 h-4 w-4" /> 创建 Profile
            </Button>
            <Button variant="outline" onClick={() => setCrossOpen(true)}>
              多 Judge 一致性
            </Button>
            <Button onClick={() => setAuditOpen(true)}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> 创建审计
            </Button>
          </div>
        }
      />

      {notice && (
        <div className={`p-4 rounded-xl mb-4 border flex justify-between items-center ${
          notice.includes('失败') || notice.includes('请先') 
            ? 'bg-yellow-50 border-yellow-200 text-yellow-800' 
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricTile title="Accuracy" value={latestAudit?.accuracy ?? 0} icon={<ClipboardCheck />} tone="green" note="整体" />
        <MetricTile title="Precision" value={latestAudit?.precision ?? 0} icon={<ClipboardCheck />} tone="blue" note="正例" />
        <MetricTile title="Recall" value={latestAudit?.recall ?? 0} icon={<ClipboardCheck />} tone="violet" note="召回" />
        <MetricTile title="Kappa" value={latestAudit?.cohen_kappa ?? 0} icon={<GitMerge />} tone="amber" note="一致性" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>混淆矩阵</CardTitle>
          </CardHeader>
          <CardContent>
            <LazyECharts option={matrixOption} style={{ height: 300 }} />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>错判样本</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">样本</th>
                    <th className="px-4 py-3 font-medium">人工</th>
                    <th className="px-4 py-3 font-medium">Judge</th>
                    <th className="px-4 py-3 font-medium">偏差</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(latestAudit?.misclassified_items ?? []).map((record, index) => (
                    <tr key={index} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{record.index}</td>
                      <td className="px-4 py-3">{record.human_label}</td>
                      <td className="px-4 py-3">{record.judge_label}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10">
                          {record.bias ?? 'misclassified'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(latestAudit?.misclassified_items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        暂无错判样本
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Judge 偏差趋势 {trendsQuery.isLoading && <span className="text-sm font-normal text-slate-500 ml-2">加载中...</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-500/10">
                  审计 {trendsQuery.data?.summary.audit_count ?? 0}
                </span>
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-500/10">
                  Profile {trendsQuery.data?.summary.profile_count ?? 0}
                </span>
                <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                  (trendsQuery.data?.summary.low_consistency_count ?? 0) > 0 ? 'bg-orange-50 text-orange-700 ring-orange-600/20' : 'bg-green-50 text-green-700 ring-green-600/20'
                }`}>
                  低一致性 {trendsQuery.data?.summary.low_consistency_count ?? 0}
                </span>
              </div>
              <LazyECharts option={trendsOption} style={{ height: 280 }} />
            </div>
            <div>
              <h5 className="font-semibold text-lg text-slate-900 mb-4">低一致性 Profile</h5>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Profile</th>
                      <th className="px-4 py-2 font-medium">Accuracy</th>
                      <th className="px-4 py-2 font-medium">Kappa</th>
                      <th className="px-4 py-2 font-medium">建议</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(trendsQuery.data?.low_consistency_profiles ?? []).map((profile) => (
                      <tr key={profile.profile_id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">{profile.profile_id}</td>
                        <td className="px-4 py-2">{Number(profile.accuracy ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-2">{Number(profile.cohen_kappa ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-2">{profile.message}</td>
                      </tr>
                    ))}
                    {(trendsQuery.data?.low_consistency_profiles ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          暂无低一致性 Profile
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>创建 Judge 审计</DialogTitle>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              createAuditMutation.mutate(auditForm);
            }} 
            className="flex flex-col gap-4 py-4"
          >
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Judge Profile</label>
              <select 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={auditForm.profile_id || ''}
                onChange={(e) => setAuditForm({...auditForm, profile_id: e.target.value})}
              >
                <option value="">请选择 Profile...</option>
                {(profilesQuery.data ?? []).map((profile) => (
                  <option key={profile.profile_id} value={profile.profile_id}>{profile.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Golden Dataset Version <span className="text-red-500">*</span></label>
              <Input 
                value={auditForm.dataset_version_id} 
                onChange={(e) => setAuditForm({...auditForm, dataset_version_id: e.target.value})} 
                required 
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">人工标签，逗号分隔 <span className="text-red-500">*</span></label>
              <Input 
                value={auditForm.human_labels} 
                onChange={(e) => setAuditForm({...auditForm, human_labels: e.target.value})} 
                required 
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Judge 标签，逗号分隔 <span className="text-red-500">*</span></label>
              <Input 
                value={auditForm.judge_labels} 
                onChange={(e) => setAuditForm({...auditForm, judge_labels: e.target.value})} 
                required 
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setAuditOpen(false)}>取消</Button>
              <Button type="submit" disabled={createAuditMutation.isPending}>开始审计</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>创建 Judge Profile</DialogTitle>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              createProfileMutation.mutate(profileForm);
            }} 
            className="flex flex-col gap-4 py-4"
          >
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">名称 <span className="text-red-500">*</span></label>
              <Input 
                value={profileForm.name} 
                onChange={(e) => setProfileForm({...profileForm, name: e.target.value})} 
                required 
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">模型 <span className="text-red-500">*</span></label>
              <Input 
                value={profileForm.model} 
                onChange={(e) => setProfileForm({...profileForm, model: e.target.value})} 
                required 
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Prompt <span className="text-red-500">*</span></label>
              <textarea 
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                rows={4}
                value={profileForm.prompt}
                onChange={(e) => setProfileForm({...profileForm, prompt: e.target.value})}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">阈值</label>
              <Input 
                type="number"
                min="0" max="1" step="0.05"
                value={profileForm.threshold} 
                onChange={(e) => setProfileForm({...profileForm, threshold: parseFloat(e.target.value)})} 
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setProfileOpen(false)}>取消</Button>
              <Button type="submit" disabled={createProfileMutation.isPending}>保存 Profile</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={crossOpen} onOpenChange={setCrossOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>多 Judge 一致性</DialogTitle>
          </DialogHeader>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              crossValidationMutation.mutate(crossForm);
            }} 
            className="flex flex-col gap-4 py-4"
          >
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Golden Dataset Version <span className="text-red-500">*</span></label>
              <Input 
                value={crossForm.dataset_version_id} 
                onChange={(e) => setCrossForm({...crossForm, dataset_version_id: e.target.value})} 
                required 
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">人工标签，逗号分隔 <span className="text-red-500">*</span></label>
              <Input 
                value={crossForm.human_labels} 
                onChange={(e) => setCrossForm({...crossForm, human_labels: e.target.value})} 
                required 
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Judge 输出 JSON <span className="text-red-500">*</span></label>
              <textarea 
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                rows={6}
                value={crossForm.judge_outputs_json}
                onChange={(e) => setCrossForm({...crossForm, judge_outputs_json: e.target.value})}
                required
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setCrossOpen(false)}>取消</Button>
              <Button type="submit" disabled={crossValidationMutation.isPending}>开始一致性分析</Button>
            </div>
          </form>
          
          {crossValidationMutation.data && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <h4 className="text-sm font-semibold mb-2">一致性结果</h4>
              <div className="rounded-md border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Judge Pair</th>
                      <th className="px-3 py-2 font-medium">一致率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(crossValidationMutation.data.pairwise_agreement).map(([pair, agreement]) => (
                      <tr key={pair} className="hover:bg-slate-50">
                        <td className="px-3 py-2">{pair}</td>
                        <td className="px-3 py-2">{Math.round(Number(agreement ?? 0) * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
