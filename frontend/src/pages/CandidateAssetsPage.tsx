import { CheckCircleOutlined, FileSearchOutlined, InboxOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Input, InputNumber, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
import { ActionToolbar, DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { BaselineChangeNotification, ExperimentBaselineActionResult, ExperimentBaselineImpact, PromptSkillCandidate, PromptSkillCandidatePageResult, PromptSkillCandidateRetestPlanItem, PromptSkillCandidateRetestResult, PromptSkillMetricCard, PromptSkillPromotionRecommendation, WorkflowPromotionReleaseArtifacts, WorkflowPromotionReview } from '../types';

// 默认容量只作为页面初值，用户仍可按团队当日处理能力调整。
const CANDIDATE_OWNER_CAPACITY_LIMIT = 5;
const CANDIDATE_ARCHIVE_STALE_DAYS = 30;
const CANDIDATE_ARCHIVE_STATUSES = ['rejected', 'promoted', 'retested', 'promotion_rejected'];

export function CandidateAssetsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
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
  const queryKey = ['prompt-skill-candidates', statusFilter, candidatePage, candidatePageSize] as const;
  const candidatesQuery = useQuery({
    queryKey,
    queryFn: () => api.promptSkillCandidatesPage({ status: statusFilter, page: candidatePage, pageSize: candidatePageSize }),
  });
  const workloadQuery = useQuery({
    queryKey: ['prompt-skill-candidate-workload'],
    queryFn: () => api.promptSkillCandidateWorkload(),
  });
  const retestPlanQuery = useQuery({
    queryKey: ['prompt-skill-candidate-retest-plan', statusFilter],
    queryFn: () => api.promptSkillCandidateRetestPlan({ status: statusFilter }),
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
    <section className="page-stack">
      <PageHeader
        eyebrow="候选治理"
        title="候选资产中心"
        description="集中管理从修复任务、人工审核和版本对比中沉淀出的候选资产，先审批再进入 Workflow 草稿和复跑验证。"
        primaryAction={<Button icon={<ReloadOutlined />} onClick={() => void candidatesQuery.refetch()}>刷新</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      {baselineNotifications.length ? (
        <Card className="flat-card" title="Baseline 变更提醒" loading={baselineNotificationsQuery.isLoading}>
          <Table
            rowKey="notification_id"
            size="small"
            pagination={false}
            dataSource={baselineNotifications}
            columns={[
              {
                title: '变更',
                render: (_, record) => (
                  <Space direction="vertical" size={2}>
                    <Space wrap size={4}>
                      <Tag color={record.action === 'rollback' ? 'volcano' : 'blue'}>{record.action === 'rollback' ? '回滚' : '应用'}</Tag>
                      <Tag color={record.status === 'acknowledged' ? 'green' : 'gold'}>{record.status === 'acknowledged' ? '已确认' : '未读'}</Tag>
                    </Space>
                    <Typography.Text>{record.message ?? `${record.from_experiment_id ?? '-'} -> ${record.to_experiment_id ?? '-'}`}</Typography.Text>
                    <Typography.Text type="secondary">接收人：{(record.recipients ?? []).join('、') || '-'}</Typography.Text>
                  </Space>
                ),
              },
              {
                title: '影响',
                render: (_, record) => (
                  <Space direction="vertical" size={2}>
                    <Typography.Text>任务：{record.summary?.affected_tasks ?? record.affected_task_ids?.length ?? 0}</Typography.Text>
                    <Typography.Text type="secondary">报告：{record.summary?.affected_reports ?? 0}</Typography.Text>
                    {record.summary?.rollback_guard_status ? <Typography.Text type="secondary">回滚门禁：{record.summary.rollback_guard_status}</Typography.Text> : null}
                  </Space>
                ),
              },
              {
                title: '操作',
                render: (_, record) => (
                  <Button
                    size="small"
                    disabled={record.status === 'acknowledged'}
                    loading={acknowledgeBaselineNotificationMutation.isPending}
                    onClick={() => acknowledgeBaselineNotificationMutation.mutate(record)}
                  >
                    确认已读
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Card className="flat-card" title="负责人工作量" loading={workloadQuery.isLoading}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            <Tag color="blue">候选：{workloadQuery.data?.summary.total_candidates ?? 0}</Tag>
            <Tag color="gold">待处理：{workloadQuery.data?.summary.total_open ?? 0}</Tag>
            <Tag color={(workloadQuery.data?.summary.total_overdue ?? 0) > 0 ? 'red' : 'green'}>逾期：{workloadQuery.data?.summary.total_overdue ?? 0}</Tag>
            <Tag color={(workloadQuery.data?.summary.escalated ?? 0) > 0 ? 'volcano' : 'default'}>已升级：{workloadQuery.data?.summary.escalated ?? 0}</Tag>
          </Space>
          <Space wrap>
            {(workloadQuery.data?.owners ?? []).map((owner) => (
              <Tag key={owner.owner} color={owner.overdue_count > 0 ? 'red' : 'blue'}>
                {owner.owner}：{owner.open_count}，SLA超时 {owner.overdue_count}
              </Tag>
            ))}
          </Space>
          <Space wrap>
            <Input
              aria-label="批量指派负责人"
              placeholder="负责人，例如 qa_owner"
              value={batchAssignOwner}
              onChange={(event) => setBatchAssignOwner(event.target.value)}
              style={{ width: 200 }}
            />
            <InputNumber
              aria-label="负责人开放候选容量"
              min={1}
              precision={0}
              value={batchAssignCapacity}
              onChange={(value) => setBatchAssignCapacity(typeof value === 'number' ? value : null)}
              style={{ width: 150 }}
            />
            <Button disabled={!currentCandidateIds.length || !normalizedBatchAssignOwner} loading={bulkAssignMutation.isPending} onClick={() => bulkAssignMutation.mutate()}>
              指派当前列表给 {normalizedBatchAssignOwner || '负责人'}
            </Button>
            <Typography.Text type="secondary">
              {batchAssignCapacity ? `开放候选容量上限：${batchAssignCapacity} 个` : '开放候选容量上限：不限制'}
            </Typography.Text>
            <Button disabled={!currentCandidateIds.length} loading={bulkReviewMutation.isPending} onClick={() => bulkReviewMutation.mutate()}>
              批量审批当前列表
            </Button>
            <Button disabled={!currentCandidateIds.length} icon={<InboxOutlined />} loading={bulkArchiveMutation.isPending} onClick={() => bulkArchiveMutation.mutate()}>
              归档终态候选
            </Button>
            <Button danger loading={escalateOverdueMutation.isPending} onClick={() => escalateOverdueMutation.mutate()}>
              升级逾期候选
            </Button>
          </Space>
        </Space>
      </Card>

      <Card className="flat-card" title="复跑优先级" loading={retestPlanQuery.isLoading}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {retestPlanQuery.isError ? (
            <Alert type="error" showIcon message={`复跑计划加载失败：${formatApiError(retestPlanQuery.error)}`} />
          ) : null}
          <Space wrap>
            <Tag color="blue">候选：{retestPlanQuery.data?.summary.total_candidates ?? 0}</Tag>
            <Tag color="green">可复跑：{retestPlanQuery.data?.summary.ready_for_retest ?? 0}</Tag>
            <Tag color="gold">待发布：{retestPlanQuery.data?.summary.needs_publish ?? 0}</Tag>
            <Tag color="purple">待建草稿：{retestPlanQuery.data?.summary.needs_draft ?? 0}</Tag>
            <Tag color="default">已复跑：{retestPlanQuery.data?.summary.already_retested ?? 0}</Tag>
            <Tag color={(retestPlanQuery.data?.summary.overdue ?? 0) > 0 ? 'red' : 'default'}>逾期：{retestPlanQuery.data?.summary.overdue ?? 0}</Tag>
            <Tag color={(retestPlanQuery.data?.summary.escalated ?? 0) > 0 ? 'volcano' : 'default'}>已升级：{retestPlanQuery.data?.summary.escalated ?? 0}</Tag>
          </Space>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!readyRetestCount}
              loading={bulkRetestMutation.isPending}
              onClick={() => bulkRetestMutation.mutate()}
            >
              批量复跑可执行候选
            </Button>
            <Typography.Text type="secondary">
              仅执行“直接复跑”的候选；待发布、待建草稿或已复跑候选会保留为跳过项。
            </Typography.Text>
          </Space>
          <Table<PromptSkillCandidateRetestPlanItem>
            rowKey="candidate_id"
            size="small"
            pagination={{ pageSize: 5 }}
            dataSource={retestPlanQuery.data?.items ?? []}
            locale={{ emptyText: '暂无候选资产需要复跑决策' }}
            columns={[
              {
                title: '优先级',
                width: 210,
                render: (_, record) => (
                  <Space direction="vertical" size={0}>
                    <Space size={6}>
                      <Tag color="blue">#{record.rank}</Tag>
                      <Typography.Text strong>{record.candidate_id}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary">分数：{record.priority_score}</Typography.Text>
                  </Space>
                ),
              },
              {
                title: '下一步',
                width: 150,
                dataIndex: 'next_action',
                render: (value: string) => <Tag color={retestActionColor(value)}>{retestActionLabel(value)}</Tag>,
              },
              {
                title: '负责人/SLA',
                width: 170,
                render: (_, record) => (
                  <Space direction="vertical" size={2}>
                    <Typography.Text>{record.owner ?? '未指派'}</Typography.Text>
                    <Typography.Text type="secondary">截止：{record.due_at ? formatDateTime(record.due_at) : '-'}</Typography.Text>
                    <Space wrap size={4}>
                      {record.overdue ? <Tag color="red">逾期</Tag> : null}
                      {record.escalation_status === 'escalated' ? <Tag color="volcano">已升级</Tag> : null}
                    </Space>
                  </Space>
                ),
              },
              {
                title: '排序原因',
                render: (_, record) => (
                  <Space wrap size={4}>
                    {record.reasons.map((reason) => (
                      <Tag key={`${record.candidate_id}-${reason}`} color={reasonTagColor(reason)}>
                        {reason}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
              {
                title: '入口',
                width: 110,
                render: (_, record) => (
                  record.target_url ? (
                    <Button size="small" href={record.target_url}>
                      打开入口
                    </Button>
                  ) : (
                    <Typography.Text type="secondary">-</Typography.Text>
                  )
                ),
              },
            ]}
          />
        </Space>
      </Card>

      <PageSection title="Prompt/Skill 候选配置" testId="candidate-assets-table-section">
        <ActionToolbar className="toolbar-row" testId="candidate-assets-toolbar">
          <Select
            allowClear
            placeholder="按状态筛选"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setCandidatePage(1);
            }}
            style={{ width: 220 }}
            options={[
              { value: 'candidate', label: '待审批' },
              { value: 'approved', label: '已审批' },
              { value: 'rejected', label: '已拒绝' },
              { value: 'draft_created', label: '已生成草稿' },
              { value: 'retested', label: '已复跑' },
              { value: 'promoted', label: '已晋升' },
              { value: 'archived', label: '已归档' },
            ]}
          />
          <Tag color="blue">{candidatePagination?.total_items ?? candidates.length} 个候选资产</Tag>
        </ActionToolbar>
        <DataTableShell testId="candidate-assets-table-shell">
          <Table
            rowKey="candidate_id"
            loading={candidatesQuery.isLoading}
            scroll={{ x: 'max-content' }}
            dataSource={candidates}
            pagination={{
              current: candidatePagination?.page ?? candidatePage,
              pageSize: candidatePagination?.page_size ?? candidatePageSize,
              total: candidatePagination?.total_items ?? candidates.length,
              showSizeChanger: false,
              onChange: setCandidatePage,
            }}
            columns={[
              {
                title: '候选资产',
                dataIndex: 'candidate_id',
                render: (value: string, record) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">来源任务：{record.source_task_id ?? '-'}</Typography.Text>
                  </Space>
                ),
              },
              { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
              { title: 'Baseline', dataIndex: 'baseline_experiment_id', render: (value: string) => <code>{value}</code> },
              {
                title: '负责人/SLA',
                render: (_, record) => (
                  <Space direction="vertical" size={2}>
                    <Typography.Text>{record.owner ?? '未指派'}</Typography.Text>
                    <Typography.Text type="secondary">截止：{record.due_at ? formatDateTime(record.due_at) : '-'}</Typography.Text>
                    <Space wrap size={4}>
                      {record.overdue ? <Tag color="red">逾期</Tag> : null}
                      {record.escalation_status === 'escalated' ? <Tag color="volcano">已升级</Tag> : null}
                    </Space>
                  </Space>
                ),
              },
              {
                title: '版本差异',
                dataIndex: 'version_diffs',
                render: (diffs: PromptSkillCandidate['version_diffs']) => (
                  <Space direction="vertical" size={4}>
                    {diffs.map((diff, index) => (
                      <Space key={`${diff.step_id}-${diff.field}-${index}`} wrap>
                        <Tag>{diff.step_id}.{diff.field}</Tag>
                        <Typography.Text>{formatUnknown(diff.baseline_value)}</Typography.Text>
                        <Typography.Text type="secondary">{'->'}</Typography.Text>
                        <Typography.Text>{formatUnknown(diff.current_value)}</Typography.Text>
                      </Space>
                    ))}
                  </Space>
                ),
              },
              {
                title: '动作',
                render: (_, record) => (
                  <Space wrap>
                    <Button
                      size="small"
                      icon={<CheckCircleOutlined />}
                      disabled={record.status !== 'candidate'}
                      loading={approveMutation.isPending}
                      onClick={() => approveMutation.mutate(record)}
                    >
                      审批通过
                    </Button>
                    <Button
                      size="small"
                      icon={<StopOutlined />}
                      disabled={record.status !== 'candidate'}
                      loading={rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate(record)}
                    >
                      拒绝
                    </Button>
                    <Button
                      size="small"
                      icon={<FileSearchOutlined />}
                      disabled={record.status !== 'approved' && !record.workflow_draft_id}
                      loading={draftMutation.isPending}
                      onClick={() => draftMutation.mutate(record)}
                    >
                      生成草稿
                    </Button>
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      disabled={!record.workflow_draft_id}
                      loading={retestMutation.isPending}
                      onClick={() => retestMutation.mutate(record)}
                    >
                      复跑对比
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </DataTableShell>
      </PageSection>

      {lastRetest ? (
        <Card className="flat-card" title="三方指标对比">
          <Space direction="vertical" size={12}>
            <Space wrap>
              {renderMetricCard('Baseline', lastRetest.scorecard.baseline)}
              {renderMetricCard('Current', lastRetest.scorecard.current)}
              {renderMetricCard('Candidate', lastRetest.scorecard.candidate)}
            </Space>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="current_to_candidate">
                current_to_candidate pass_rate_delta={formatDelta(lastRetest.comparisons.current_to_candidate?.pass_rate_delta)}
                ，badcase_delta={formatUnknown(lastRetest.comparisons.current_to_candidate?.badcase_delta)}
              </Descriptions.Item>
              <Descriptions.Item label="baseline_to_candidate">
                baseline_to_candidate 通过率变化 {formatDelta(lastRetest.comparisons.baseline_to_candidate?.pass_rate_delta)}
                ，badcase_delta={formatUnknown(lastRetest.comparisons.baseline_to_candidate?.badcase_delta)}
              </Descriptions.Item>
            </Descriptions>
            {lastRetest.promotion_recommendation
              ? renderPromotionRecommendation(lastRetest.promotion_recommendation, () => promotionReviewMutation.mutate(), promotionReviewMutation.isPending)
              : null}
            <Button type="primary" href={lastRetest.target_url}>
              查看候选任务报告
            </Button>
          </Space>
        </Card>
      ) : null}

      {lastPromotionReview ? (
        <Card className="flat-card" title="Workflow 晋升审批">
          <Space direction="vertical" size={8}>
            <Space wrap>
              <Typography.Text strong>{lastPromotionReview.review_id}</Typography.Text>
              <Tag color={promotionReviewStatusColor(lastPromotionReview.status)}>{promotionReviewStatusLabel(lastPromotionReview.status)}</Tag>
            </Space>
            <Typography.Text>候选版本：{lastPromotionReview.candidate_workflow_version_id ?? '-'}</Typography.Text>
            <Typography.Text type="secondary">当前版本：{lastPromotionReview.current_workflow_version_id ?? '-'}</Typography.Text>
            <Space wrap>
              {lastPromotionReview.target_url ? <Button href={lastPromotionReview.target_url}>打开 Workflow 市场</Button> : null}
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                disabled={lastPromotionReview.status !== 'pending_review'}
                loading={approvePromotionReviewMutation.isPending}
                onClick={() => approvePromotionReviewMutation.mutate(lastPromotionReview)}
              >
                通过晋升
              </Button>
            </Space>
          </Space>
        </Card>
      ) : null}

      {lastReleaseArtifacts ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {lastReleaseArtifacts.baseline_suggestion ? (
            <Card className="flat-card" title="Baseline 替换建议">
              <Space direction="vertical" size={6}>
                <Typography.Text>建议 baseline：{lastReleaseArtifacts.baseline_suggestion.suggested_experiment_id ?? '-'}</Typography.Text>
                <Typography.Text type="secondary">原 baseline：{lastReleaseArtifacts.baseline_suggestion.previous_baseline_experiment_id ?? '-'}</Typography.Text>
                <Typography.Text type="secondary">{lastReleaseArtifacts.baseline_suggestion.reason ?? '审批通过后生成的 baseline 候选。'}</Typography.Text>
                {lastBaselineApplication ? <Typography.Text>当前 baseline：{lastBaselineApplication.baseline.current_experiment_id ?? '-'}</Typography.Text> : null}
                {lastBaselineApplication?.ci_gate_guard ? <Typography.Text>应用门禁：{lastBaselineApplication.ci_gate_guard.status}</Typography.Text> : null}
                {lastBaselineImpact ? (
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="影响范围">影响任务：{lastBaselineImpact.summary.affected_tasks}，报告：{lastBaselineImpact.summary.affected_reports}</Descriptions.Item>
                    <Descriptions.Item label="指标变化">pass_rate_delta={formatDelta(lastBaselineImpact.metric_delta.pass_rate_delta)}，badcase_delta={formatUnknown(lastBaselineImpact.metric_delta.badcase_delta)}</Descriptions.Item>
                  </Descriptions>
                ) : null}
                {lastBaselineRollback?.rollback_guard ? (
                  <Typography.Text>回滚门禁：{lastBaselineRollback.rollback_guard.status}</Typography.Text>
                ) : null}
                <Space wrap>
                  {lastReleaseArtifacts.baseline_suggestion.target_url ? <Button href={lastReleaseArtifacts.baseline_suggestion.target_url}>打开实验中心</Button> : null}
                  <Button
                    loading={baselineImpactMutation.isPending}
                    onClick={() => baselineImpactMutation.mutate()}
                  >
                    查看影响
                  </Button>
                  <Button
                    type="primary"
                    disabled={lastReleaseArtifacts.baseline_suggestion.status === 'applied'}
                    loading={applyBaselineMutation.isPending}
                    onClick={() => applyBaselineMutation.mutate()}
                  >
                    应用 baseline
                  </Button>
                  <Button
                    danger
                    disabled={!lastBaselineApplication || lastBaselineApplication.suggestion.status !== 'applied'}
                    loading={rollbackBaselineMutation.isPending}
                    onClick={() => rollbackBaselineMutation.mutate()}
                  >
                    回滚 baseline
                  </Button>
                </Space>
              </Space>
            </Card>
          ) : null}
          {lastReleaseArtifacts.release_record ? (
            <Card className="flat-card" title="CI Gate 发布记录">
              <Space direction="vertical" size={6}>
                <Space wrap>
                  <Tag color={releaseRecordStatusColor(lastReleaseArtifacts.release_record.status)}>{lastReleaseArtifacts.release_record.status}</Tag>
                  <Typography.Text>阻断项：{lastReleaseArtifacts.release_record.blocking_failures}</Typography.Text>
                  <Typography.Text type="secondary">门禁：{lastReleaseArtifacts.release_record.ci_gate_config_ids.length} 个</Typography.Text>
                </Space>
                <Typography.Text>Workflow 版本：{lastReleaseArtifacts.release_record.workflow_version_id ?? '-'}</Typography.Text>
                {lastReleaseArtifacts.release_record.target_url ? <Button href={lastReleaseArtifacts.release_record.target_url}>打开 CI Gate</Button> : null}
              </Space>
            </Card>
          ) : null}
        </Space>
      ) : null}
    </section>
  );
}

function statusColor(status: string) {
  if (status === 'archived') return 'default';
  if (status === 'promoted') return 'cyan';
  if (status === 'approved') return 'green';
  if (status === 'rejected') return 'red';
  if (status === 'draft_created') return 'blue';
  return 'gold';
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

function retestActionColor(action: string) {
  if (action === 'retest_candidate') return 'green';
  if (action === 'publish_workflow_draft') return 'gold';
  if (action === 'create_workflow_draft') return 'purple';
  if (action === 'review_retest_result') return 'blue';
  return 'default';
}

function reasonTagColor(reason: string) {
  if (reason.includes('逾期')) return 'red';
  if (reason.includes('升级')) return 'volcano';
  if (reason.includes('发布')) return 'gold';
  if (reason.includes('复跑')) return 'green';
  return 'blue';
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
    <Card size="small">
      <Space direction="vertical" size={2}>
        <Typography.Text strong>{label}：{formatPercent(card?.pass_rate)}</Typography.Text>
        <Typography.Text type="secondary">Badcase：{formatUnknown(card?.badcase_count)} / P95：{formatUnknown(card?.p95_latency_ms)}ms</Typography.Text>
      </Space>
    </Card>
  );
}

function renderPromotionRecommendation(recommendation: PromptSkillPromotionRecommendation, onCreateReview: () => void, loading: boolean) {
  return (
    <Alert
      showIcon
      type={recommendation.decision === 'promote' ? 'success' : recommendation.decision === 'review' ? 'warning' : 'error'}
      message={
        <Space wrap>
          <Typography.Text strong>晋升建议</Typography.Text>
          <Tag color={promotionDecisionColor(recommendation.decision)}>{promotionDecisionLabel(recommendation.decision)}</Tag>
        </Space>
      }
      description={
        <Space direction="vertical" size={8}>
          <Typography.Text>{recommendation.summary}</Typography.Text>
          <Space wrap>
            {recommendation.checks.map((check) => (
              <Tag key={check.check_id} color={checkStatusColor(check.status)}>
                {check.message}
              </Tag>
            ))}
          </Space>
          <Space wrap>
            {recommendation.next_actions.map((action) => (
              action.action === 'create_promotion_review' ? (
                <Button
                  key={action.action}
                  size="small"
                  type="primary"
                  loading={loading}
                  disabled={recommendation.decision === 'hold'}
                  onClick={onCreateReview}
                >
                  {action.label}
                </Button>
              ) : (
                <Tag key={action.action} color="blue">
                  {action.label}
                </Tag>
              )
            ))}
          </Space>
        </Space>
      }
    />
  );
}

function promotionDecisionColor(decision: string) {
  if (decision === 'promote') return 'green';
  if (decision === 'review') return 'gold';
  return 'red';
}

function promotionDecisionLabel(decision: string) {
  const labels: Record<string, string> = {
    promote: '建议晋升',
    review: '建议复核',
    hold: '暂不晋升',
  };
  return labels[decision] ?? decision;
}

function checkStatusColor(status: string) {
  if (status === 'passed') return 'green';
  if (status === 'warning') return 'gold';
  if (status === 'failed') return 'red';
  return 'default';
}

function promotionReviewStatusColor(status: string) {
  if (status === 'approved') return 'green';
  if (status === 'rejected') return 'red';
  return 'gold';
}

function promotionReviewStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_review: '待审批',
    approved: '已通过',
    rejected: '已拒绝',
  };
  return labels[status] ?? status;
}

function releaseRecordStatusColor(status: string) {
  if (status === 'ready_to_release') return 'green';
  if (status === 'blocked') return 'red';
  if (status.startsWith('pending')) return 'gold';
  return 'blue';
}
