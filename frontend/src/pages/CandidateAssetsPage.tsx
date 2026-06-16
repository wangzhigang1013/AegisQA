import { CheckCircle, FileSearch, Inbox, PlayCircle, RefreshCw, Ban } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
import { ActionToolbar, DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { BaselineChangeNotification, ExperimentBaselineActionResult, ExperimentBaselineImpact, PromptSkillCandidate, PromptSkillCandidatePageResult, PromptSkillCandidateRetestPlanItem, PromptSkillCandidateRetestResult, PromptSkillMetricCard, PromptSkillPromotionRecommendation, WorkflowPromotionReleaseArtifacts, WorkflowPromotionReview } from '../types';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

const CANDIDATE_OWNER_CAPACITY_LIMIT = 5;
const CANDIDATE_ARCHIVE_STALE_DAYS = 30;
const CANDIDATE_ARCHIVE_STATUSES = ['rejected', 'promoted', 'retested', 'promotion_rejected'];

export function CandidateAssetsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRetest, setLastRetest] = useState<PromptSkillCandidateRetestResult | null>(null);
  const [lastPromotionReview, setLastPromotionReview] = useState<WorkflowPromotionReview | null>(null);
  const [lastReleaseArtifacts, setLastReleaseArtifacts] = useState<WorkflowPromotionReleaseArtifacts | null>(null);
  const [lastBaselineApplication, setLastBaselineApplication] = useState<ExperimentBaselineActionResult | null>(null);
  const [lastBaselineImpact, setLastBaselineImpact] = useState<ExperimentBaselineImpact | null>(null);
  const [lastBaselineRollback, setLastBaselineRollback] = useState<ExperimentBaselineActionResult | null>(null);
  const [lastBaselineNotifications, setLastBaselineNotifications] = useState<BaselineChangeNotification[]>([]);
  const [batchAssignOwner, setBatchAssignOwner] = useState('qa_owner');
  const [batchAssignCapacity, setBatchAssignCapacity] = useState<number | null>(CANDIDATE_OWNER_CAPACITY_LIMIT);
  const [candidatePage, setCandidatePage] = useState(1);
  const candidatePageSize = 8;
  
  const queryKey = ['prompt-skill-candidates', statusFilter || undefined, candidatePage, candidatePageSize] as const;
  
  const candidatesQuery = useQuery({
    queryKey,
    queryFn: () => api.promptSkillCandidatesPage({ status: statusFilter || undefined, page: candidatePage, pageSize: candidatePageSize }),
  });
  
  const workloadQuery = useQuery({
    queryKey: ['prompt-skill-candidate-workload'],
    queryFn: () => api.promptSkillCandidateWorkload(),
  });
  
  const retestPlanQuery = useQuery({
    queryKey: ['prompt-skill-candidate-retest-plan', statusFilter || undefined],
    queryFn: () => api.promptSkillCandidateRetestPlan({ status: statusFilter || undefined }),
  });
  
  const baselineNotificationsQuery = useQuery({
    queryKey: ['baseline-change-notifications', 'unread'],
    queryFn: () => api.baselineChangeNotifications({ status: 'unread' }),
  });

  const candidates = candidatesQuery.data?.items ?? [];
  const candidatePagination = candidatesQuery.data?.pagination;
  const currentCandidateIds = candidates.map((candidate) => candidate.candidate_id);
  const baselineNotifications = mergeBaselineNotifications(lastBaselineNotifications, baselineNotificationsQuery.data ?? []);
  const retestPlanItems = retestPlanQuery.data?.items ?? [];
  const retestPlanCandidateIds = retestPlanItems.map((item) => item.candidate_id);
  const readyRetestCount = retestPlanQuery.data?.summary.ready_for_retest ?? 0;
  const normalizedBatchAssignOwner = batchAssignOwner.trim();

  function invalidateCandidateSummaries() {
    void queryClient.invalidateQueries({ queryKey: ['prompt-skill-candidate-workload'] });
    void queryClient.invalidateQueries({ queryKey: ['prompt-skill-candidate-retest-plan'] });
  }

  function mergeCandidate(candidate: PromptSkillCandidate) {
    queryClient.setQueryData<PromptSkillCandidatePageResult>(queryKey, (current) => {
      if (!current) return current;
      const keepInCurrentList = (!statusFilter || candidate.status === statusFilter) && !(candidate.status === 'archived' && statusFilter !== 'archived');
      if (!keepInCurrentList) {
        return { ...current, items: current.items.filter((item) => item.candidate_id !== candidate.candidate_id) };
      }
      const exists = current.items.some((item) => item.candidate_id === candidate.candidate_id);
      return { ...current, items: exists ? current.items.map((item) => (item.candidate_id === candidate.candidate_id ? candidate : item)) : [candidate, ...current.items] };
    });
  }

  function mergeCandidates(items: PromptSkillCandidate[]) {
    items.forEach(mergeCandidate);
  }

  const approveMutation = useMutation({
    mutationFn: (candidate: PromptSkillCandidate) =>
      api.reviewPromptSkillCandidate(candidate.candidate_id, {
        decision: 'approved',
        reviewer: 'qa_owner',
        note: '确认 baseline 指标或版本更适合当前修复目标，允许创建 Workflow 草稿。',
      }),
    onSuccess: (candidate) => {
      mergeCandidate(candidate);
      invalidateCandidateSummaries();
      setNotice(`候选资产已审批：${candidate.candidate_id}`);
    },
    onError: (error) => setNotice(`候选资产审批失败：${formatApiError(error)}`),
  });

  const rejectMutation = useMutation({
    mutationFn: (candidate: PromptSkillCandidate) =>
      api.reviewPromptSkillCandidate(candidate.candidate_id, {
        decision: 'rejected',
        reviewer: 'qa_owner',
        note: '当前版本差异不适合作为修复候选，保留记录但不进入草稿复跑。',
      }),
    onSuccess: (candidate) => {
      mergeCandidate(candidate);
      invalidateCandidateSummaries();
      setNotice(`候选资产已拒绝：${candidate.candidate_id}`);
    },
    onError: (error) => setNotice(`候选资产拒绝失败：${formatApiError(error)}`),
  });

  const bulkReviewMutation = useMutation({
    mutationFn: () =>
      api.bulkReviewPromptSkillCandidates({
        candidate_ids: currentCandidateIds,
        decision: 'approved',
        reviewer: 'qa_owner',
        note: '批量确认当前列表候选资产进入后续草稿和复跑验证。',
      }),
    onSuccess: (payload) => {
      mergeCandidates(payload.candidates);
      invalidateCandidateSummaries();
      setNotice(`批量审批完成：${payload.reviewed_count} 个`);
    },
    onError: (error) => setNotice(`批量审批失败：${formatApiError(error)}`),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: () =>
      api.bulkAssignPromptSkillCandidates({
        candidate_ids: currentCandidateIds,
        owner: normalizedBatchAssignOwner,
        due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        actor: 'lead',
        max_open_per_owner: batchAssignCapacity,
      }),
    onSuccess: (payload) => {
      mergeCandidates(payload.candidates);
      invalidateCandidateSummaries();
      const skippedCount = payload.skipped_count ?? payload.skipped?.length ?? 0;
      setNotice(
        skippedCount > 0
          ? `候选资产已指派：${payload.assigned_count} 个，容量跳过 ${skippedCount} 个`
          : `候选资产已指派：${payload.assigned_count} 个`,
      );
    },
    onError: (error) => setNotice(`候选资产指派失败：${formatApiError(error)}`),
  });

  const bulkArchiveMutation = useMutation({
    mutationFn: () =>
      api.bulkArchivePromptSkillCandidates({
        candidate_ids: currentCandidateIds,
        statuses: CANDIDATE_ARCHIVE_STATUSES,
        stale_before: archiveStaleBeforeIso(),
        actor: 'ops',
        note: `归档 ${CANDIDATE_ARCHIVE_STALE_DAYS} 天前已结束的候选资产。`,
      }),
    onSuccess: (payload) => {
      const archivedIds = new Set(payload.candidates.map((candidate) => candidate.candidate_id));
      if (statusFilter === 'archived') {
        mergeCandidates(payload.candidates);
      } else {
        queryClient.setQueryData<PromptSkillCandidatePageResult>(queryKey, (current) =>
          current ? { ...current, items: current.items.filter((candidate) => !archivedIds.has(candidate.candidate_id)) } : current,
        );
      }
      invalidateCandidateSummaries();
      void queryClient.invalidateQueries({ queryKey: ['prompt-skill-candidates'] });
      setNotice(`已归档候选：${payload.archived_count} 个，跳过 ${payload.skipped_count} 个`);
    },
    onError: (error) => setNotice(`候选资产归档失败：${formatApiError(error)}`),
  });

  const escalateOverdueMutation = useMutation({
    mutationFn: () => api.escalateOverduePromptSkillCandidates({ actor: 'lead' }),
    onSuccess: (payload) => {
      mergeCandidates(payload.candidates);
      invalidateCandidateSummaries();
      setNotice(`逾期候选已升级：${payload.escalated_count} 个`);
    },
    onError: (error) => setNotice(`逾期候选升级失败：${formatApiError(error)}`),
  });

  const draftMutation = useMutation({
    mutationFn: (candidate: PromptSkillCandidate) => api.createPromptSkillCandidateDraft(candidate.candidate_id),
    onSuccess: (payload) => {
      mergeCandidate(payload.candidate);
      void queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
      invalidateCandidateSummaries();
      setNotice(`Workflow 草稿已创建：${payload.draft.draft_id}`);
    },
    onError: (error) => setNotice(`Workflow 草稿创建失败：${formatApiError(error)}`),
  });

  const retestMutation = useMutation({
    mutationFn: (candidate: PromptSkillCandidate) => api.retestPromptSkillCandidate(candidate.candidate_id),
    onSuccess: (payload) => {
      mergeCandidate(payload.candidate);
      setLastRetest(payload);
      invalidateCandidateSummaries();
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setNotice(`候选复跑已完成：${payload.task.task_id}`);
    },
    onError: (error) => setNotice(`候选复跑失败：${formatApiError(error)}`),
  });

  const bulkRetestMutation = useMutation({
    mutationFn: () =>
      api.bulkRetestPromptSkillCandidates({
        candidate_ids: retestPlanCandidateIds,
        max_count: 10,
        actor: 'qa_owner',
      }),
    onSuccess: (payload) => {
      void queryClient.invalidateQueries({ queryKey: ['prompt-skill-candidates'] });
      invalidateCandidateSummaries();
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setNotice(`批量复跑完成：${payload.retested_count} 个，跳过 ${payload.skipped_count} 个`);
    },
    onError: (error) => setNotice(`批量复跑失败：${formatApiError(error)}`),
  });

  const promotionReviewMutation = useMutation({
    mutationFn: () => {
      if (!lastRetest?.candidate.candidate_id) throw new Error('请先完成候选复跑。');
      return api.createWorkflowPromotionReview(lastRetest.candidate.candidate_id, {
        requester: 'qa_owner',
        note: '候选指标达标，提交晋升审批。',
      });
    },
    onSuccess: (payload) => {
      mergeCandidate(payload.candidate);
      setLastPromotionReview(payload.review);
      setLastReleaseArtifacts(payload.release_artifacts ?? null);
      setNotice(`晋升审批已创建：${payload.review.review_id}`);
    },
    onError: (error) => setNotice(`晋升审批创建失败：${formatApiError(error)}`),
  });

  const approvePromotionReviewMutation = useMutation({
    mutationFn: (review: WorkflowPromotionReview) =>
      api.approveWorkflowPromotionReview(review.review_id, {
        reviewer: 'release_owner',
        note: '同意晋升为推荐 Workflow 版本，并生成 baseline 建议与 CI Gate 发布记录。',
      }),
    onSuccess: (payload) => {
      mergeCandidate(payload.candidate);
      setLastPromotionReview(payload.review);
      setLastReleaseArtifacts(payload.release_artifacts ?? null);
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      void queryClient.invalidateQueries({ queryKey: ['ci-gates'] });
      setNotice(`晋升审批已通过：${payload.review.review_id}`);
    },
    onError: (error) => setNotice(`晋升审批通过失败：${formatApiError(error)}`),
  });

  const applyBaselineMutation = useMutation({
    mutationFn: () => {
      const suggestionId = lastReleaseArtifacts?.baseline_suggestion?.suggestion_id;
      if (!suggestionId) throw new Error('缺少 baseline 替换建议。');
      return api.applyExperimentBaselineSuggestion(suggestionId, {
        actor: 'release_owner',
        note: '候选版本通过晋升审批和发布门禁，应用为新 baseline。',
      });
    },
    onSuccess: (payload) => {
      setLastBaselineApplication(payload);
      setLastBaselineRollback(null);
      setLastBaselineNotifications(payload.notifications ?? []);
      setLastReleaseArtifacts((current) => (current ? { ...current, baseline_suggestion: payload.suggestion } : current));
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      void queryClient.invalidateQueries({ queryKey: ['baseline-change-notifications'] });
      setNotice(`Baseline 已应用：${payload.baseline.current_experiment_id}`);
    },
    onError: (error) => setNotice(`Baseline 应用失败：${formatApiError(error)}`),
  });

  const baselineImpactMutation = useMutation({
    mutationFn: () => {
      const suggestionId = lastReleaseArtifacts?.baseline_suggestion?.suggestion_id;
      if (!suggestionId) throw new Error('缺少 baseline 替换建议。');
      return api.experimentBaselineImpact(suggestionId);
    },
    onSuccess: (payload) => {
      setLastBaselineImpact(payload);
      setNotice(`Baseline 影响分析已生成：影响任务 ${payload.summary.affected_tasks} 个`);
    },
    onError: (error) => setNotice(`Baseline 影响分析失败：${formatApiError(error)}`),
  });

  const rollbackBaselineMutation = useMutation({
    mutationFn: () => {
      const suggestionId = lastReleaseArtifacts?.baseline_suggestion?.suggestion_id;
      if (!suggestionId) throw new Error('缺少 baseline 替换建议。');
      return api.rollbackExperimentBaselineSuggestion(suggestionId, {
        actor: 'release_owner',
        note: '回滚到原 baseline。',
      });
    },
    onSuccess: (payload) => {
      setLastBaselineApplication(payload);
      setLastBaselineRollback(payload);
      setLastBaselineNotifications(payload.notifications ?? []);
      setLastReleaseArtifacts((current) => (current ? { ...current, baseline_suggestion: payload.suggestion } : current));
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      void queryClient.invalidateQueries({ queryKey: ['baseline-change-notifications'] });
      setNotice(`Baseline 已回滚：${payload.baseline.current_experiment_id}`);
    },
    onError: (error) => setNotice(`Baseline 回滚失败：${formatApiError(error)}`),
  });

  const acknowledgeBaselineNotificationMutation = useMutation({
    mutationFn: (notification: BaselineChangeNotification) =>
      api.acknowledgeBaselineChangeNotification(notification.notification_id, {
        actor: 'qa_owner',
        note: '已确认收到 baseline 变更提醒，并会复核受影响任务。',
      }),
    onSuccess: (payload) => {
      setLastBaselineNotifications((current) => mergeBaselineNotifications(current, [payload]));
      void queryClient.invalidateQueries({ queryKey: ['baseline-change-notifications'] });
      setNotice(`Baseline 提醒已确认：${payload.acknowledged_by ?? 'qa_owner'}`);
    },
    onError: (error) => setNotice(`Baseline 提醒确认失败：${formatApiError(error)}`),
  });

  return (
    <section className="page-stack flex flex-col gap-8">
      <PageHeader
        eyebrow="候选治理"
        title="候选资产中心"
        description="集中管理从修复任务、人工审核和版本对比中沉淀出的候选资产，先审批再进入 Workflow 草稿和复跑验证。"
        primaryAction={
          <Button onClick={() => void candidatesQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> 刷新
          </Button>
        }
      />

      {notice && (
        <div className={`p-4 rounded-xl mb-4 border flex justify-between items-center ${
          notice.includes('失败') 
            ? 'bg-red-50 border-red-200 text-red-700' 
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      )}

      {baselineNotifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Baseline 变更提醒</CardTitle>
          </CardHeader>
          <CardContent>
            {baselineNotificationsQuery.isLoading ? (
              <div className="text-slate-500 py-4 text-center">加载中...</div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">变更</th>
                      <th className="px-4 py-3 font-medium">影响</th>
                      <th className="px-4 py-3 font-medium w-32">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {baselineNotifications.map(record => (
                      <tr key={record.notification_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap gap-2">
                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                record.action === 'rollback' ? 'bg-orange-50 text-orange-700 ring-orange-600/20' : 'bg-blue-50 text-blue-700 ring-blue-700/10'
                              }`}>
                                {record.action === 'rollback' ? '回滚' : '应用'}
                              </span>
                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                record.status === 'acknowledged' ? 'bg-green-50 text-green-700 ring-green-600/20' : 'bg-yellow-50 text-yellow-800 ring-yellow-600/20'
                              }`}>
                                {record.status === 'acknowledged' ? '已确认' : '未读'}
                              </span>
                            </div>
                            <div className="text-slate-900">{record.message ?? `${record.from_experiment_id ?? '-'} -> ${record.to_experiment_id ?? '-'}`}</div>
                            <div className="text-xs text-slate-500">接收人：{(record.recipients ?? []).join('、') || '-'}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="text-slate-900">任务：{record.summary?.affected_tasks ?? record.affected_task_ids?.length ?? 0}</div>
                            <div className="text-xs text-slate-500">报告：{record.summary?.affected_reports ?? 0}</div>
                            {record.summary?.rollback_guard_status && (
                              <div className="text-xs text-slate-500">回滚门禁：{record.summary.rollback_guard_status}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={record.status === 'acknowledged' || acknowledgeBaselineNotificationMutation.isPending}
                            onClick={() => acknowledgeBaselineNotificationMutation.mutate(record)}
                          >
                            确认已读
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>负责人工作量</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                候选：{workloadQuery.data?.summary.total_candidates ?? 0}
              </span>
              <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-sm font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">
                待处理：{workloadQuery.data?.summary.total_open ?? 0}
              </span>
              <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                (workloadQuery.data?.summary.total_overdue ?? 0) > 0 ? 'bg-red-50 text-red-700 ring-red-600/10' : 'bg-green-50 text-green-700 ring-green-600/20'
              }`}>
                逾期：{workloadQuery.data?.summary.total_overdue ?? 0}
              </span>
              <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                (workloadQuery.data?.summary.escalated ?? 0) > 0 ? 'bg-orange-50 text-orange-700 ring-orange-600/20' : 'bg-slate-100 text-slate-700 ring-slate-500/10'
              }`}>
                已升级：{workloadQuery.data?.summary.escalated ?? 0}
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {(workloadQuery.data?.owners ?? []).map((owner) => (
                <span key={owner.owner} className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                  owner.overdue_count > 0 ? 'bg-red-50 text-red-700 ring-red-600/10' : 'bg-blue-50 text-blue-700 ring-blue-700/10'
                }`}>
                  {owner.owner}：{owner.open_count}，SLA超时 {owner.overdue_count}
                </span>
              ))}
            </div>
            
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <Input
                placeholder="负责人，例如 qa_owner"
                value={batchAssignOwner}
                onChange={(event) => setBatchAssignOwner(event.target.value)}
                className="w-48"
              />
              <Input
                type="number"
                min={1}
                step={1}
                value={batchAssignCapacity ?? ''}
                onChange={(e) => setBatchAssignCapacity(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="w-32"
                placeholder="不限制"
              />
              <Button 
                variant="secondary"
                disabled={!currentCandidateIds.length || !normalizedBatchAssignOwner || bulkAssignMutation.isPending} 
                onClick={() => bulkAssignMutation.mutate()}
              >
                指派当前列表给 {normalizedBatchAssignOwner || '负责人'}
              </Button>
              <span className="text-sm text-slate-500">
                {batchAssignCapacity ? `开放候选容量上限：${batchAssignCapacity} 个` : '开放候选容量上限：不限制'}
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2 mt-2">
              <Button 
                variant="outline"
                disabled={!currentCandidateIds.length || bulkReviewMutation.isPending} 
                onClick={() => bulkReviewMutation.mutate()}
              >
                批量审批当前列表
              </Button>
              <Button 
                variant="outline"
                disabled={!currentCandidateIds.length || bulkArchiveMutation.isPending} 
                onClick={() => bulkArchiveMutation.mutate()}
              >
                <Inbox className="w-4 h-4 mr-2" /> 归档终态候选
              </Button>
              <Button 
                variant="destructive" 
                disabled={escalateOverdueMutation.isPending}
                onClick={() => escalateOverdueMutation.mutate()}
              >
                升级逾期候选
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>复跑优先级</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {retestPlanQuery.isError && (
              <div className="p-4 rounded-xl border bg-red-50 border-red-200 text-red-700 flex justify-between items-center">
                <span>复跑计划加载失败：{formatApiError(retestPlanQuery.error)}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                候选：{retestPlanQuery.data?.summary.total_candidates ?? 0}
              </span>
              <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-sm font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                可复跑：{retestPlanQuery.data?.summary.ready_for_retest ?? 0}
              </span>
              <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-sm font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">
                待发布：{retestPlanQuery.data?.summary.needs_publish ?? 0}
              </span>
              <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-sm font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                待建草稿：{retestPlanQuery.data?.summary.needs_draft ?? 0}
              </span>
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-500/10">
                已复跑：{retestPlanQuery.data?.summary.already_retested ?? 0}
              </span>
              <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                (retestPlanQuery.data?.summary.overdue ?? 0) > 0 ? 'bg-red-50 text-red-700 ring-red-600/10' : 'bg-slate-100 text-slate-700 ring-slate-500/10'
              }`}>
                逾期：{retestPlanQuery.data?.summary.overdue ?? 0}
              </span>
              <span className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ring-1 ring-inset ${
                (retestPlanQuery.data?.summary.escalated ?? 0) > 0 ? 'bg-orange-50 text-orange-700 ring-orange-600/20' : 'bg-slate-100 text-slate-700 ring-slate-500/10'
              }`}>
                已升级：{retestPlanQuery.data?.summary.escalated ?? 0}
              </span>
            </div>
            
            <div className="flex flex-wrap items-center gap-4">
              <Button
                disabled={!readyRetestCount || bulkRetestMutation.isPending}
                onClick={() => bulkRetestMutation.mutate()}
              >
                <PlayCircle className="w-4 h-4 mr-2" /> 批量复跑可执行候选
              </Button>
              <span className="text-sm text-slate-500">
                仅执行“直接复跑”的候选；待发布、待建草稿或已复跑候选会保留为跳过项。
              </span>
            </div>
            
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium min-w-[210px]">优先级</th>
                      <th className="px-4 py-3 font-medium min-w-[150px]">下一步</th>
                      <th className="px-4 py-3 font-medium min-w-[170px]">负责人/SLA</th>
                      <th className="px-4 py-3 font-medium">排序原因</th>
                      <th className="px-4 py-3 font-medium w-[110px]">入口</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {retestPlanItems.map(record => (
                      <tr key={record.candidate_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">#{record.rank}</span>
                              <span className="font-semibold">{record.candidate_id}</span>
                            </div>
                            <div className="text-xs text-slate-500">分数：{record.priority_score}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${retestActionColorClass(record.next_action)}`}>
                            {retestActionLabel(record.next_action)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div>{record.owner ?? '未指派'}</div>
                            <div className="text-xs text-slate-500">截止：{record.due_at ? formatDateTime(record.due_at) : '-'}</div>
                            <div className="flex gap-1">
                              {record.overdue && <span className="bg-red-50 text-red-700 text-[10px] px-1 rounded">逾期</span>}
                              {record.escalation_status === 'escalated' && <span className="bg-orange-50 text-orange-700 text-[10px] px-1 rounded">已升级</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {record.reasons.map((reason) => (
                              <span key={`${record.candidate_id}-${reason}`} className={`text-[10px] px-1.5 py-0.5 rounded-sm ${reasonTagColorClass(reason)}`}>
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {record.target_url ? (
                            <a href={record.target_url} className="text-xs text-blue-600 hover:underline px-2 py-1 border border-slate-200 rounded-md hover:bg-slate-50 inline-block">
                              打开入口
                            </a>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {retestPlanItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">暂无候选资产需要复跑决策</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <PageSection title="Prompt/Skill 候选配置" testId="candidate-assets-table-section">
        <ActionToolbar className="toolbar-row flex justify-between items-center mb-4" testId="candidate-assets-toolbar">
          <div className="flex items-center gap-4">
            <select
              className="flex h-10 w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCandidatePage(1);
              }}
            >
              <option value="">按状态筛选 (全部)</option>
              <option value="candidate">待审批</option>
              <option value="approved">已审批</option>
              <option value="rejected">已拒绝</option>
              <option value="draft_created">已生成草稿</option>
              <option value="retested">已复跑</option>
              <option value="promoted">已晋升</option>
              <option value="archived">已归档</option>
            </select>
          </div>
          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-sm font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
            {candidatePagination?.total_items ?? candidates.length} 个候选资产
          </span>
        </ActionToolbar>
        
        <DataTableShell testId="candidate-assets-table-shell">
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">候选资产</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">Baseline</th>
                    <th className="px-4 py-3 font-medium">负责人/SLA</th>
                    <th className="px-4 py-3 font-medium">版本差异</th>
                    <th className="px-4 py-3 font-medium min-w-[300px]">动作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {candidates.map(record => (
                    <tr key={record.candidate_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-slate-900">{record.candidate_id}</span>
                          <span className="text-xs text-slate-500">来源任务：{record.source_task_id ?? '-'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusColorClass(record.status)}`}>
                          {statusLabel(record.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3"><code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-800">{record.baseline_experiment_id}</code></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <div>{record.owner ?? '未指派'}</div>
                          <div className="text-xs text-slate-500">截止：{record.due_at ? formatDateTime(record.due_at) : '-'}</div>
                          <div className="flex gap-1">
                            {record.overdue && <span className="bg-red-50 text-red-700 text-[10px] px-1 rounded">逾期</span>}
                            {record.escalation_status === 'escalated' && <span className="bg-orange-50 text-orange-700 text-[10px] px-1 rounded">已升级</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          {(record.version_diffs || []).map((diff, index) => (
                            <div key={`${diff.step_id}-${diff.field}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-600">
                                {diff.step_id}.{diff.field}
                              </span>
                              <span className="text-slate-700">{formatUnknown(diff.baseline_value)}</span>
                              <span className="text-slate-400">{'->'}</span>
                              <span className="text-slate-900 font-medium">{formatUnknown(diff.current_value)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={record.status !== 'candidate' || approveMutation.isPending}
                            onClick={() => approveMutation.mutate(record)}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" /> 审批通过
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={record.status !== 'candidate' || rejectMutation.isPending}
                            onClick={() => rejectMutation.mutate(record)}
                          >
                            <Ban className="w-3 h-3 mr-1" /> 拒绝
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={record.status !== 'approved' && !record.workflow_draft_id || draftMutation.isPending}
                            onClick={() => draftMutation.mutate(record)}
                          >
                            <FileSearch className="w-3 h-3 mr-1" /> 生成草稿
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!record.workflow_draft_id || retestMutation.isPending}
                            onClick={() => retestMutation.mutate(record)}
                          >
                            <PlayCircle className="w-3 h-3 mr-1" /> 复跑对比
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {candidates.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {candidatesQuery.isLoading ? '加载中...' : '暂无数据'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center p-4 text-sm text-slate-500 border-t border-slate-200">
              <button 
                disabled={candidatePage <= 1}
                onClick={() => setCandidatePage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-slate-50"
              >
                上一页
              </button>
              <span>第 {candidatePage} 页</span>
              <button 
                disabled={candidates.length < candidatePageSize}
                onClick={() => setCandidatePage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-slate-50"
              >
                下一页
              </button>
            </div>
          </div>
        </DataTableShell>
      </PageSection>

      {lastRetest && (
        <Card>
          <CardHeader>
            <CardTitle>三方指标对比</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {renderMetricCard('Baseline', lastRetest.scorecard.baseline)}
              {renderMetricCard('Current', lastRetest.scorecard.current)}
              {renderMetricCard('Candidate', lastRetest.scorecard.candidate)}
            </div>
            
            <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
              <div className="grid grid-cols-[200px_1fr] border-b border-slate-100">
                <div className="bg-slate-50 p-3 font-medium text-slate-700 border-r border-slate-100">current_to_candidate</div>
                <div className="p-3 text-slate-600">
                  current_to_candidate pass_rate_delta={formatDelta(lastRetest.comparisons.current_to_candidate?.pass_rate_delta)}
                  ，badcase_delta={formatUnknown(lastRetest.comparisons.current_to_candidate?.badcase_delta)}
                </div>
              </div>
              <div className="grid grid-cols-[200px_1fr]">
                <div className="bg-slate-50 p-3 font-medium text-slate-700 border-r border-slate-100">baseline_to_candidate</div>
                <div className="p-3 text-slate-600">
                  baseline_to_candidate 通过率变化 {formatDelta(lastRetest.comparisons.baseline_to_candidate?.pass_rate_delta)}
                  ，badcase_delta={formatUnknown(lastRetest.comparisons.baseline_to_candidate?.badcase_delta)}
                </div>
              </div>
            </div>

            {lastRetest.promotion_recommendation && renderPromotionRecommendation(lastRetest.promotion_recommendation, () => promotionReviewMutation.mutate(), promotionReviewMutation.isPending)}
            
            <div>
              <a href={lastRetest.target_url} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-blue-600 text-white hover:bg-blue-600/90 h-10 px-4 py-2">
                查看候选任务报告
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {lastPromotionReview && (
        <Card>
          <CardHeader>
            <CardTitle>Workflow 晋升审批</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-lg text-slate-900">{lastPromotionReview.review_id}</span>
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${promotionReviewStatusColorClass(lastPromotionReview.status)}`}>
                  {promotionReviewStatusLabel(lastPromotionReview.status)}
                </span>
              </div>
              <div className="text-sm text-slate-700">候选版本：{lastPromotionReview.candidate_workflow_version_id ?? '-'}</div>
              <div className="text-sm text-slate-500">当前版本：{lastPromotionReview.current_workflow_version_id ?? '-'}</div>
              <div className="flex gap-3 mt-2">
                {lastPromotionReview.target_url && (
                  <a href={lastPromotionReview.target_url} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-slate-100 hover:text-slate-900 h-10 px-4 py-2">
                    打开 Workflow 市场
                  </a>
                )}
                <Button
                  disabled={lastPromotionReview.status !== 'pending_review' || approvePromotionReviewMutation.isPending}
                  onClick={() => approvePromotionReviewMutation.mutate(lastPromotionReview)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> 通过晋升
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {lastReleaseArtifacts && (
        <div className="flex flex-col gap-6">
          {lastReleaseArtifacts.baseline_suggestion && (
            <Card>
              <CardHeader>
                <CardTitle>Baseline 替换建议</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="text-sm text-slate-800">建议 baseline：{lastReleaseArtifacts.baseline_suggestion.suggested_experiment_id ?? '-'}</div>
                <div className="text-sm text-slate-500">原 baseline：{lastReleaseArtifacts.baseline_suggestion.previous_baseline_experiment_id ?? '-'}</div>
                <div className="text-sm text-slate-500">{lastReleaseArtifacts.baseline_suggestion.reason ?? '审批通过后生成的 baseline 候选。'}</div>
                
                {lastBaselineApplication && <div className="text-sm font-medium text-slate-800">当前 baseline：{lastBaselineApplication.baseline.current_experiment_id ?? '-'}</div>}
                {lastBaselineApplication?.ci_gate_guard && <div className="text-sm text-slate-700">应用门禁：{lastBaselineApplication.ci_gate_guard.status}</div>}
                
                {lastBaselineImpact && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden text-sm mt-2">
                    <div className="grid grid-cols-[100px_1fr] border-b border-slate-100">
                      <div className="bg-slate-50 p-2 font-medium text-slate-700 border-r border-slate-100">影响范围</div>
                      <div className="p-2 text-slate-600">影响任务：{lastBaselineImpact.summary.affected_tasks}，报告：{lastBaselineImpact.summary.affected_reports}</div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr]">
                      <div className="bg-slate-50 p-2 font-medium text-slate-700 border-r border-slate-100">指标变化</div>
                      <div className="p-2 text-slate-600">pass_rate_delta={formatDelta(lastBaselineImpact.metric_delta.pass_rate_delta)}，badcase_delta={formatUnknown(lastBaselineImpact.metric_delta.badcase_delta)}</div>
                    </div>
                  </div>
                )}
                
                {lastBaselineRollback?.rollback_guard && (
                  <div className="text-sm text-slate-700">回滚门禁：{lastBaselineRollback.rollback_guard.status}</div>
                )}
                
                <div className="flex flex-wrap gap-3 mt-4">
                  {lastReleaseArtifacts.baseline_suggestion.target_url && (
                    <a href={lastReleaseArtifacts.baseline_suggestion.target_url} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border border-slate-200 bg-white hover:bg-slate-50 h-10 px-4 py-2">
                      打开实验中心
                    </a>
                  )}
                  <Button
                    variant="outline"
                    loading={baselineImpactMutation.isPending}
                    onClick={() => baselineImpactMutation.mutate()}
                  >
                    查看影响
                  </Button>
                  <Button
                    disabled={lastReleaseArtifacts.baseline_suggestion.status === 'applied' || applyBaselineMutation.isPending}
                    onClick={() => applyBaselineMutation.mutate()}
                  >
                    应用 baseline
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={!lastBaselineApplication || lastBaselineApplication.suggestion.status !== 'applied' || rollbackBaselineMutation.isPending}
                    onClick={() => rollbackBaselineMutation.mutate()}
                  >
                    回滚 baseline
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          
          {lastReleaseArtifacts.release_record && (
            <Card>
              <CardHeader>
                <CardTitle>CI Gate 发布记录</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${releaseRecordStatusColorClass(lastReleaseArtifacts.release_record.status)}`}>
                    {lastReleaseArtifacts.release_record.status}
                  </span>
                  <span className="text-sm text-slate-800">阻断项：{lastReleaseArtifacts.release_record.blocking_failures}</span>
                  <span className="text-sm text-slate-500">门禁：{lastReleaseArtifacts.release_record.ci_gate_config_ids.length} 个</span>
                </div>
                <div className="text-sm text-slate-800">Workflow 版本：{lastReleaseArtifacts.release_record.workflow_version_id ?? '-'}</div>
                {lastReleaseArtifacts.release_record.target_url && (
                  <div className="mt-2">
                    <a href={lastReleaseArtifacts.release_record.target_url} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border border-slate-200 bg-white hover:bg-slate-50 h-10 px-4 py-2">
                      打开 CI Gate
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

function archiveStaleBeforeIso() {
  return new Date(Date.now() - CANDIDATE_ARCHIVE_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function retestActionLabel(action: string) {
  const labels: Record<string, string> = {
    retest_candidate: '直接复跑',
    publish_workflow_draft: '先发布草稿',
    create_workflow_draft: '先创建草稿',
    review_retest_result: '查看复跑结果',
  };
  return labels[action] ?? action;
}

function retestActionColorClass(action: string) {
  if (action === 'retest_candidate') return 'bg-green-50 text-green-700 ring-green-600/20';
  if (action === 'publish_workflow_draft') return 'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
  if (action === 'create_workflow_draft') return 'bg-purple-50 text-purple-700 ring-purple-700/10';
  if (action === 'review_retest_result') return 'bg-blue-50 text-blue-700 ring-blue-700/10';
  return 'bg-slate-100 text-slate-700 ring-slate-500/10';
}

function reasonTagColorClass(reason: string) {
  if (reason.includes('逾期')) return 'bg-red-50 text-red-700 border border-red-200';
  if (reason.includes('升级')) return 'bg-orange-50 text-orange-700 border border-orange-200';
  if (reason.includes('发布')) return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
  if (reason.includes('复跑')) return 'bg-green-50 text-green-700 border border-green-200';
  return 'bg-blue-50 text-blue-700 border border-blue-200';
}

function formatUnknown(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function formatPercent(value: unknown) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '-';
}

function formatDelta(value: unknown) {
  return typeof value === 'number' ? Number(value.toFixed(4)).toString() : '-';
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', { hour12: false });
}

function mergeBaselineNotifications(...groups: BaselineChangeNotification[][]) {
  const byId = new Map<string, BaselineChangeNotification>();
  groups.flat().filter((notification) => notification?.notification_id).forEach((notification) => {
    byId.set(notification.notification_id, notification);
  });
  return Array.from(byId.values()).sort((left, right) => String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')));
}

function renderMetricCard(label: string, card?: PromptSkillMetricCard) {
  return (
    <div className="p-4 border border-slate-200 rounded-xl shadow-sm bg-white">
      <div className="font-semibold text-slate-900 mb-1">{label}：{formatPercent(card?.pass_rate)}</div>
      <div className="text-sm text-slate-500">Badcase：{formatUnknown(card?.badcase_count)} / P95：{formatUnknown(card?.p95_latency_ms)}ms</div>
    </div>
  );
}

function renderPromotionRecommendation(recommendation: PromptSkillPromotionRecommendation, onCreateReview: () => void, loading: boolean) {
  const typeClass = recommendation.decision === 'promote' ? 'bg-green-50 border-green-200' : 
                    recommendation.decision === 'review' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';
                    
  return (
    <div className={`p-4 rounded-xl border ${typeClass} flex flex-col gap-3`}>
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-900">晋升建议</span>
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${promotionDecisionColorClass(recommendation.decision)}`}>
          {promotionDecisionLabel(recommendation.decision)}
        </span>
      </div>
      <div className="text-sm text-slate-800">{recommendation.summary}</div>
      <div className="flex flex-wrap gap-2">
        {recommendation.checks.map((check) => (
          <span key={check.check_id} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${checkStatusColorClass(check.status)}`}>
            {check.message}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {recommendation.next_actions.map((action) => (
          action.action === 'create_promotion_review' ? (
            <Button
              key={action.action}
              size="sm"
              disabled={recommendation.decision === 'hold' || loading}
              onClick={onCreateReview}
            >
              {action.label}
            </Button>
          ) : (
            <span key={action.action} className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
              {action.label}
            </span>
          )
        ))}
      </div>
    </div>
  );
}

function promotionDecisionColorClass(decision: string) {
  if (decision === 'promote') return 'bg-green-50 text-green-700 ring-green-600/20';
  if (decision === 'review') return 'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
  return 'bg-red-50 text-red-700 ring-red-600/10';
}

function promotionDecisionLabel(decision: string) {
  const labels: Record<string, string> = {
    promote: '建议晋升',
    review: '建议复核',
    hold: '暂不晋升',
  };
  return labels[decision] ?? decision;
}

function checkStatusColorClass(status: string) {
  if (status === 'passed') return 'bg-green-50 text-green-700 ring-green-600/20';
  if (status === 'warning') return 'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
  if (status === 'failed') return 'bg-red-50 text-red-700 ring-red-600/10';
  return 'bg-slate-100 text-slate-700 ring-slate-500/10';
}

function promotionReviewStatusColorClass(status: string) {
  if (status === 'approved') return 'bg-green-50 text-green-700 ring-green-600/20';
  if (status === 'rejected') return 'bg-red-50 text-red-700 ring-red-600/10';
  return 'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
}

function promotionReviewStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_review: '待审批',
    approved: '已通过',
    rejected: '已拒绝',
  };
  return labels[status] ?? status;
}

function releaseRecordStatusColorClass(status: string) {
  if (status === 'ready_to_release') return 'bg-green-50 text-green-700 ring-green-600/20';
  if (status === 'blocked') return 'bg-red-50 text-red-700 ring-red-600/10';
  if (status.startsWith('pending')) return 'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
  return 'bg-blue-50 text-blue-700 ring-blue-700/10';
}

function statusColorClass(status: string) {
  if (status === 'archived') return 'bg-slate-100 text-slate-700 ring-slate-500/10';
  if (status === 'promoted') return 'bg-cyan-50 text-cyan-700 ring-cyan-600/20';
  if (status === 'approved') return 'bg-green-50 text-green-700 ring-green-600/20';
  if (status === 'rejected') return 'bg-red-50 text-red-700 ring-red-600/10';
  if (status === 'draft_created') return 'bg-blue-50 text-blue-700 ring-blue-700/10';
  return 'bg-yellow-50 text-yellow-800 ring-yellow-600/20';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    candidate: '待审批',
    approved: '已审批',
    rejected: '已拒绝',
    draft_created: '已生成草稿',
    retested: '已复跑',
    promoted: '已晋升',
    promotion_rejected: '晋升拒绝',
    archived: '已归档',
  };
  return labels[status] ?? status;
}
