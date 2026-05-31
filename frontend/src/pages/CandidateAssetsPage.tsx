import { CheckCircleOutlined, FileSearchOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { PromptSkillCandidate } from '../types';

export function CandidateAssetsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
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
                </Space>
              ),
            },
          ]}
        />
      </Card>
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
  };
  return labels[status] ?? status;
}

function formatUnknown(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
