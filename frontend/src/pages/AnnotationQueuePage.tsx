import { AuditOutlined, CheckOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
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

export function AnnotationQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sourceTaskId, setSourceTaskId] = useState<string | undefined>();
  const [reviewTask, setReviewTask] = useState<AnnotationTask | null>(null);
  const [assignTask, setAssignTask] = useState<AnnotationTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewForm] = Form.useForm<ReviewValues>();
  const [assignForm] = Form.useForm<AssignValues>();
  const reviewLabel = Form.useWatch('human_label', reviewForm);
  const assignee = Form.useWatch('assignee', assignForm);

  const queueQuery = useQuery({
    queryKey: ['annotation-queue', statusFilter, assigneeFilter, sourceTaskId],
    queryFn: () => api.annotationQueue({ status: statusFilter, assignee: assigneeFilter, source_task_id: sourceTaskId }),
  });
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });

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
            onChange={setStatusFilter}
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
            onChange={(event) => setAssigneeFilter(event.target.value)}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className="wide-search"
            placeholder="按来源任务筛选"
            value={sourceTaskId}
            onChange={setSourceTaskId}
            options={(tasksQuery.data ?? []).map((task) => ({ value: task.task_id, label: `${task.name} / ${task.status}` }))}
          />
        </Space>
      </Card>

      <Card className="flat-card" title="审核队列">
        <Table
          rowKey="task_id"
          loading={queueQuery.isLoading}
          dataSource={queueQuery.data ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '来源任务', dataIndex: 'source_task_name', render: (value) => value || '-' },
            { title: '样本', dataIndex: 'item_id', render: (value) => <code>{value}</code> },
            { title: '状态', dataIndex: 'status', render: renderStatus },
            { title: '负责人', dataIndex: 'assignee', render: (value) => value || '未分派' },
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
      </Card>

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
    </section>
  );
}

function renderStatus(status: string) {
  const color = status === 'reviewed' ? 'green' : status === 'assigned' ? 'blue' : 'gold';
  const label = status === 'reviewed' ? '已审核' : status === 'assigned' ? '已分派' : '待领取';
  return <Tag color={color}>{label}</Tag>;
}
