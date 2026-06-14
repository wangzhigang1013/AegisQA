import { AuditOutlined, CheckOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useState, type Key } from 'react';

import { api, formatApiError } from '../api/client';
import { DataTableShell, PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { AnnotationTask } from '../types';

type ReviewValues = {
  human_label: string;
  note?: string;
  add_to_golden?: boolean;
};

type AssignValues = {
  assignee: string;
};

type BulkReviewValues = ReviewValues;

export function AnnotationQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sourceTaskId, setSourceTaskId] = useState<string | undefined>();
  const [reviewTask, setReviewTask] = useState<AnnotationTask | null>(null);
  const [assignTask, setAssignTask] = useState<AnnotationTask | null>(null);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const queuePageSize = 8;
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewForm] = Form.useForm<ReviewValues>();
  const [assignForm] = Form.useForm<AssignValues>();
  const [bulkReviewForm] = Form.useForm<BulkReviewValues>();
  const reviewLabel = Form.useWatch('human_label', reviewForm);
  const assignee = Form.useWatch('assignee', assignForm);
  const bulkReviewLabel = Form.useWatch('human_label', bulkReviewForm);

  const queueQuery = useQuery({
    queryKey: ['annotation-queue', statusFilter, assigneeFilter, sourceTaskId, queuePage, queuePageSize],
    queryFn: () => api.annotationQueuePage({ status: statusFilter, assignee: assigneeFilter, source_task_id: sourceTaskId, page: queuePage, pageSize: queuePageSize }),
  });
  const tasksQuery = useQuery({ queryKey: ['tasks-all'], queryFn: () => api.tasksPage({ page: 1, pageSize: 100 }) });
  const candidatesQuery = useQuery({
    queryKey: ['annotation-candidates', sourceTaskId],
    queryFn: () => api.annotationCandidates({ source_task_id: sourceTaskId }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ task, nextAssignee }: { task: AnnotationTask; nextAssignee: string }) =>
      api.assignAnnotationTask(task.task_id, { assignee: nextAssignee }),
    onSuccess: async (task) => {
      setAssignTask(null);
      assignForm.resetFields();
      setNotice(task.assignee === 'current_user' ? `样本已领取：${task.item_id}` : `样本已分派给：${task.assignee}`);
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
    },
    onError: (error) => setNotice(`分派失败：${formatApiError(error)}`),
  });

  const reviewMutation = useMutation({
    mutationFn: (values: ReviewValues) => {
      if (!reviewTask) throw new Error('请选择需要审核的样本。');
      return api.reviewAnnotationTask(reviewTask.task_id, {
        human_label: values.human_label,
        note: values.note,
        add_to_golden: Boolean(values.add_to_golden),
      });
    },
    onSuccess: async (task) => {
      const added = Boolean(task.review?.add_to_golden);
      setReviewTask(null);
      reviewForm.resetFields();
      setNotice(added ? '审核已提交，并回流 Golden Dataset。' : '审核已提交。');
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
    },
    onError: (error) => setNotice(`审核失败：${formatApiError(error)}`),
  });

  const bulkReviewMutation = useMutation({
    mutationFn: (values: BulkReviewValues) =>
      api.bulkReviewAnnotationTasks({
        task_ids: selectedRowKeys.map(String),
        human_label: values.human_label,
        note: values.note,
        add_to_golden: Boolean(values.add_to_golden),
      }),
    onSuccess: async (result) => {
      setBulkReviewOpen(false);
      setSelectedRowKeys([]);
      bulkReviewForm.resetFields();
      setNotice(`批量审核完成：${result.reviewed_count} 条，Golden ${result.candidate_summary.golden} / Assertion ${result.candidate_summary.assertion}。`);
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
      await queryClient.invalidateQueries({ queryKey: ['annotation-candidates'] });
    },
    onError: (error) => setNotice(`批量审核失败：${formatApiError(error)}`),
  });

  const dispatchMutation = useMutation({
    mutationFn: () =>
      api.dispatchAnnotationQueue({
        label_field: 'scene',
        sla_hours: 48,
        overdue_strategy: 'oldest_first',
        assignees: [
          { assignee: 'billing_reviewer', capacity: 5, labels: ['billing', 'payment'] },
          { assignee: 'policy_reviewer', capacity: 5, labels: ['policy', 'safety'] },
          { assignee: 'qa_owner', capacity: 10, labels: [] },
        ],
      }),
    onSuccess: async (result) => {
      setNotice(`自动分派完成：已分派 ${result.assigned_count} 条，跳过 ${result.skipped_count} 条。`);
      await queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
    },
    onError: (error) => setNotice(`自动分派失败：${formatApiError(error)}`),
  });

  const candidateSummary = summarizeCandidates(candidatesQuery.data ?? []);
  const queueItems = queueQuery.data?.items ?? [];
  const queuePagination = queueQuery.data?.pagination;
  const queueSummary = queueQuery.data?.summary;

  function resetQueuePaging() {
    setQueuePage(1);
    setSelectedRowKeys([]);
  }

  function openReview(task: AnnotationTask) {
    setReviewTask(task);
    reviewForm.resetFields();
  }

  function openAssign(task: AnnotationTask) {
    setAssignTask(task);
    assignForm.setFieldsValue({ assignee: task.assignee ?? '' });
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="人工复核"
        title="Annotation Queue 人工审核"
        description="把低分、失败或抽样样本分派给人工审核，审核结论可回流 Golden Dataset，支撑后续 Judge 审计和 Workflow 优化。"
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="筛选条件" extra={<Button icon={<ReloadOutlined />} onClick={() => void queueQuery.refetch()}>刷新队列</Button>}>
        <Space wrap>
          <Select
            allowClear
            className="wide-search"
            placeholder="按状态筛选"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              resetQueuePaging();
            }}
            options={[
              { value: 'pending', label: '待领取' },
              { value: 'assigned', label: '已分派' },
              { value: 'reviewed', label: '已审核' },
            ]}
          />
          <Input
            allowClear
            className="wide-search"
            placeholder="按负责人筛选"
            value={assigneeFilter}
            onChange={(event) => {
              setAssigneeFilter(event.target.value);
              resetQueuePaging();
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className="wide-search"
            placeholder="按来源任务筛选"
            value={sourceTaskId}
            onChange={(value) => {
              setSourceTaskId(value);
              resetQueuePaging();
            }}
            options={(tasksQuery.data?.items ?? []).map((task) => ({ value: task.task_id, label: `${task.name} / ${task.status}` }))}
          />
        </Space>
      </Card>

      <Card className="flat-card" title="候选资产">
        <Space wrap>
          <Tag color="green">Golden {candidateSummary.golden} / Assertion {candidateSummary.assertion}</Tag>
          <Typography.Text type="secondary">候选资产来自已审核样本，后续可进入 Golden Dataset、Assertion DSL 或 CI Gate 建议。</Typography.Text>
        </Space>
      </Card>

      <Card
        className="flat-card"
        title="负责人负载与 SLA"
        extra={<Button icon={<UserAddOutlined />} loading={dispatchMutation.isPending} onClick={() => dispatchMutation.mutate()}>自动分派</Button>}
      >
        <Space direction="vertical" className="full-width-control">
          <Space wrap>
            <Tag color="blue">待处理 {queueSummary?.total_open ?? queueItems.filter((item) => item.status !== 'reviewed').length}</Tag>
            <Tag color="purple">已分派 {queueSummary?.total_assigned ?? queueItems.filter((item) => item.assignee && item.status !== 'reviewed').length}</Tag>
            <Tag color={(queueSummary?.total_overdue ?? 0) > 0 ? 'red' : 'green'}>SLA超时 {queueSummary?.total_overdue ?? 0}</Tag>
          </Space>
          <Space wrap>
            {(queueSummary?.owners ?? summarizeOwners(queueItems)).map((owner) => (
              <Tag key={owner.assignee} color={owner.overdue_count ? 'red' : owner.assignee === '未分派' ? 'gold' : 'blue'}>
                {owner.assignee}：{owner.backlog} / SLA超时 {owner.overdue_count}
              </Tag>
            ))}
          </Space>
        </Space>
      </Card>

      <PageSection
        title="审核队列"
        testId="annotation-queue-table-section"
        extra={
          <Button type="primary" disabled={!selectedRowKeys.length} onClick={() => setBulkReviewOpen(true)}>
            批量审核
          </Button>
        }
      >
        <DataTableShell testId="annotation-queue-table-shell">
          <Table
            rowKey="task_id"
            loading={queueQuery.isLoading}
            scroll={{ x: 'max-content' }}
            dataSource={queueItems}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, getCheckboxProps: (record) => ({ disabled: record.status === 'reviewed' }) }}
            pagination={{
              current: queuePagination?.page ?? queuePage,
              pageSize: queuePagination?.page_size ?? queuePageSize,
              total: queuePagination?.total_items ?? queueItems.length,
              showSizeChanger: false,
              onChange: (page) => {
                setSelectedRowKeys([]);
                setQueuePage(page);
              },
            }}
            columns={[
              { title: '来源任务', dataIndex: 'source_task_name', render: (value) => value || '-' },
              { title: '样本', dataIndex: 'item_id', render: (value) => <code>{value}</code> },
              { title: '状态', dataIndex: 'status', render: renderStatus },
              { title: '负责人', dataIndex: 'assignee', render: (value) => value || '未分派' },
              { title: '业务标签', dataIndex: 'business_label', render: (value) => value || '-' },
              { title: 'SLA', render: (_, record) => renderSla(record.sla_status, record.due_at) },
              { title: '优先级', dataIndex: 'priority', render: (value) => <Tag color={value === 'high' ? 'red' : 'blue'}>{value}</Tag> },
              { title: '原因', dataIndex: 'reason' },
              {
                title: '操作',
                render: (_, record) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<UserAddOutlined />}
                      disabled={record.status === 'reviewed'}
                      loading={assignMutation.isPending}
                      onClick={() => assignMutation.mutate({ task: record, nextAssignee: 'current_user' })}
                    >
                      领取
                    </Button>
                    <Button size="small" onClick={() => openAssign(record)} disabled={record.status === 'reviewed'}>
                      分派
                    </Button>
                    <Button size="small" type="primary" icon={<AuditOutlined />} onClick={() => openReview(record)}>
                      审核
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </DataTableShell>
      </PageSection>

      <Modal
        title="审核样本"
        open={Boolean(reviewTask)}
        forceRender
        onCancel={() => setReviewTask(null)}
        footer={[
          <Button key="cancel" onClick={() => setReviewTask(null)}>取消</Button>,
          <Button key="submit" type="primary" icon={<CheckOutlined />} loading={reviewMutation.isPending} disabled={!reviewLabel} onClick={() => reviewForm.submit()}>
            确认审核
          </Button>,
        ]}
      >
        <Space direction="vertical" className="drawer-stack">
          <Typography.Text type="secondary">样本：{reviewTask?.item_id}</Typography.Text>
          <pre>{JSON.stringify(reviewTask?.payload ?? {}, null, 2)}</pre>
          <Form form={reviewForm} layout="vertical" onFinish={(values) => reviewMutation.mutate(values)}>
            <Form.Item name="human_label" label="人工标签" rules={[{ required: true, message: '请输入人工标签' }]}>
              <Input placeholder="例如：pass / fail" />
            </Form.Item>
            <Form.Item name="note" label="审核说明">
              <Input.TextArea rows={3} placeholder="说明误判原因、修复建议或需要补充的 Golden 信息。" />
            </Form.Item>
            <Form.Item name="add_to_golden" valuePropName="checked">
              <Checkbox>回流 Golden Dataset</Checkbox>
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="分派审核任务"
        open={Boolean(assignTask)}
        forceRender
        onCancel={() => setAssignTask(null)}
        footer={[
          <Button key="cancel" onClick={() => setAssignTask(null)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!assignee}
            loading={assignMutation.isPending}
            onClick={() => assignTask && assignMutation.mutate({ task: assignTask, nextAssignee: assignee })}
          >
            确认分派
          </Button>,
        ]}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item name="assignee" label="负责人" rules={[{ required: true, message: '请输入负责人' }]}>
            <Input placeholder="例如：qa_owner" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量审核样本"
        open={bulkReviewOpen}
        forceRender
        onCancel={() => setBulkReviewOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setBulkReviewOpen(false)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!bulkReviewLabel}
            loading={bulkReviewMutation.isPending}
            onClick={() => bulkReviewForm.submit()}
          >
            确认批量审核
          </Button>,
        ]}
      >
        <Space direction="vertical" className="drawer-stack">
          <Typography.Text type="secondary">已选择 {selectedRowKeys.length} 条样本。批量审核会保留 reviewer、reviewed_at 和来源任务，并按需生成 Golden/Assertion 候选资产。</Typography.Text>
          <Form form={bulkReviewForm} layout="vertical" onFinish={(values) => bulkReviewMutation.mutate(values)}>
            <Form.Item name="human_label" label="批量人工标签" rules={[{ required: true, message: '请输入批量标签' }]}>
              <Input placeholder="批量标签，例如：pass / fail" />
            </Form.Item>
            <Form.Item name="note" label="批量审核说明">
              <Input.TextArea rows={3} placeholder="说明这一批样本的共性问题或回流策略。" />
            </Form.Item>
            <Form.Item name="add_to_golden" valuePropName="checked">
              <Checkbox>批量回流 Golden Dataset</Checkbox>
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </section>
  );
}

function summarizeCandidates(candidates: { kind: string }[]) {
  return {
    golden: candidates.filter((candidate) => candidate.kind === 'golden').length,
    assertion: candidates.filter((candidate) => candidate.kind === 'assertion').length,
  };
}

function summarizeOwners(tasks: AnnotationTask[]) {
  const owners = new Map<string, { assignee: string; backlog: number; overdue_count: number }>();
  tasks
    .filter((task) => task.status !== 'reviewed')
    .forEach((task) => {
      const assignee = task.assignee || '未分派';
      const current = owners.get(assignee) ?? { assignee, backlog: 0, overdue_count: 0 };
      current.backlog += 1;
      if (task.overdue || task.sla_status === 'overdue') {
        current.overdue_count += 1;
      }
      owners.set(assignee, current);
    });
  return [...owners.values()];
}

function renderStatus(status: string) {
  const color = status === 'reviewed' ? 'green' : status === 'assigned' ? 'blue' : 'gold';
  const label = status === 'reviewed' ? '已审核' : status === 'assigned' ? '已分派' : '待领取';
  return <Tag color={color}>{label}</Tag>;
}

function renderSla(status?: string | null, dueAt?: string | null) {
  const color = status === 'overdue' ? 'red' : status === 'unassigned' ? 'gold' : status === 'reviewed' ? 'green' : 'blue';
  const label = status === 'overdue' ? '已超时' : status === 'unassigned' ? '未分派' : status === 'reviewed' ? '已审核' : 'SLA内';
  return (
    <Space size={4} wrap>
      <Tag color={color}>{label}</Tag>
      {dueAt ? <Typography.Text type="secondary">{formatAnnotationTime(dueAt)}</Typography.Text> : null}
    </Space>
  );
}

function formatAnnotationTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}
