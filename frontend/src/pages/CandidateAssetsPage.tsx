import { CheckCircleOutlined, FileSearchOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { PromptSkillCandidate, PromptSkillCandidateRetestResult, PromptSkillMetricCard, PromptSkillPromotionRecommendation, WorkflowPromotionReview } from '../types';

export function CandidateAssetsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRetest, setLastRetest] = useState<PromptSkillCandidateRetestResult | null>(null);
  const [lastPromotionReview, setLastPromotionReview] = useState<WorkflowPromotionReview | null>(null);
  const queryKey = ['prompt-skill-candidates', statusFilter] as const;
  const candidatesQuery = useQuery({
    queryKey,
    queryFn: () => api.promptSkillCandidates({ status: statusFilter }),
  });
  const candidates = candidatesQuery.data ?? [];

  function mergeCandidate(candidate: PromptSkillCandidate) {
    queryClient.setQueryData<PromptSkillCandidate[]>(queryKey, (current = []) => {
      if (statusFilter && candidate.status !== statusFilter) {
        return current.filter((item) => item.candidate_id !== candidate.candidate_id);
      }
      const exists = current.some((item) => item.candidate_id === candidate.candidate_id);
      return exists ? current.map((item) => (item.candidate_id === candidate.candidate_id ? candidate : item)) : [candidate, ...current];
    });
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
      setNotice(`候选资产已拒绝：${candidate.candidate_id}`);
    },
    onError: (error) => setNotice(`候选资产拒绝失败：${formatApiError(error)}`),
  });

  const draftMutation = useMutation({
    mutationFn: (candidate: PromptSkillCandidate) => api.createPromptSkillCandidateDraft(candidate.candidate_id),
    onSuccess: (payload) => {
      mergeCandidate(payload.candidate);
      void queryClient.invalidateQueries({ queryKey: ['workflow-drafts'] });
      setNotice(`Workflow 草稿已创建：${payload.draft.draft_id}`);
    },
    onError: (error) => setNotice(`Workflow 草稿创建失败：${formatApiError(error)}`),
  });

  const retestMutation = useMutation({
    mutationFn: (candidate: PromptSkillCandidate) => api.retestPromptSkillCandidate(candidate.candidate_id),
    onSuccess: (payload) => {
      mergeCandidate(payload.candidate);
      setLastRetest(payload);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      setNotice(`候选复跑已完成：${payload.task.task_id}`);
    },
    onError: (error) => setNotice(`候选复跑失败：${formatApiError(error)}`),
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
      setNotice(`晋升审批已创建：${payload.review.review_id}`);
    },
    onError: (error) => setNotice(`晋升审批创建失败：${formatApiError(error)}`),
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

      <Card className="flat-card" title="Prompt/Skill 候选配置">
        <Space className="toolbar-row" wrap>
          <Select
            allowClear
            placeholder="按状态筛选"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 220 }}
            options={[
              { value: 'candidate', label: '待审批' },
              { value: 'approved', label: '已审批' },
              { value: 'rejected', label: '已拒绝' },
              { value: 'draft_created', label: '已生成草稿' },
            ]}
          />
          <Tag color="blue">{candidates.length} 个候选资产</Tag>
        </Space>
        <Table
          rowKey="candidate_id"
          loading={candidatesQuery.isLoading}
          dataSource={candidates}
          pagination={{ pageSize: 8 }}
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
      </Card>

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
                baseline_to_candidate pass_rate_delta={formatDelta(lastRetest.comparisons.baseline_to_candidate?.pass_rate_delta)}
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
            {lastPromotionReview.target_url ? <Button href={lastPromotionReview.target_url}>打开 Workflow 市场</Button> : null}
          </Space>
        </Card>
      ) : null}
    </section>
  );
}

function statusColor(status: string) {
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
  };
  return labels[status] ?? status;
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
