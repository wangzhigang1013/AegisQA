import { CheckCircleOutlined, CheckOutlined, FileSearchOutlined, ReloadOutlined, RollbackOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { RepairTaskRecord } from '../types';

type ResolveValues = {
  resolution_note: string;
};

type ReopenValues = {
  reason: string;
};

export function RepairTasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [sourceTaskId, setSourceTaskId] = useState<string | undefined>();
  const [resolveTask, setResolveTask] = useState<RepairTaskRecord | null>(null);
  const [reopenTask, setReopenTask] = useState<RepairTaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolveForm] = Form.useForm<ResolveValues>();
  const [reopenForm] = Form.useForm<ReopenValues>();
  const resolutionNote = Form.useWatch('resolution_note', resolveForm);
  const reopenReason = Form.useWatch('reason', reopenForm);

  const repairTasksQuery = useQuery({
    queryKey: ['repair-tasks', sourceTaskId],
    queryFn: () => api.repairTasks({ source_task_id: sourceTaskId }),
  });
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });

  const visibleRepairTasks = useMemo(() => {
    const records = repairTasksQuery.data ?? [];
    return statusFilter ? records.filter((record) => record.status === statusFilter) : records;
  }, [repairTasksQuery.data, statusFilter]);

  const taskNameById = useMemo(() => {
    return Object.fromEntries((tasksQuery.data ?? []).map((task) => [task.task_id, task.name]));
  }, [tasksQuery.data]);

  const startMutation = useMutation({
    mutationFn: (record: RepairTaskRecord) => api.startRepairTask(record.repair_task_id, { owner: 'qa_owner' }),
    onSuccess: async (record) => {
      setNotice(`修复任务已领取：${record.owner ?? 'qa_owner'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
    },
    onError: (error) => setNotice(`领取失败：${formatApiError(error)}`),
  });

  const resolveMutation = useMutation({
    mutationFn: (values: ResolveValues) => {
      if (!resolveTask) throw new Error('请选择需要完成的修复任务。');
      return api.resolveRepairTask(resolveTask.repair_task_id, { resolution_note: values.resolution_note });
    },
    onSuccess: async (record) => {
      setResolveTask(null);
      resolveForm.resetFields();
      setNotice(`修复任务已完成：${record.resolution_note ?? '已记录修复说明'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
    },
    onError: (error) => setNotice(`完成失败：${formatApiError(error)}`),
  });

  const reopenMutation = useMutation({
    mutationFn: (values: ReopenValues) => {
      if (!reopenTask) throw new Error('请选择需要重开的修复任务。');
      return api.reopenRepairTask(reopenTask.repair_task_id, { reason: values.reason });
    },
    onSuccess: async (record) => {
      setReopenTask(null);
      reopenForm.resetFields();
      setNotice(`修复任务已重开：${record.reopen_reason ?? '已记录重开原因'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
    },
    onError: (error) => setNotice(`重开失败：${formatApiError(error)}`),
  });

  const actionMutation = useMutation({
    mutationFn: ({ record, action }: { record: RepairTaskRecord; action: string }) =>
      api.runRepairTaskAction(record.repair_task_id, { action, assignee: 'qa_owner', limit: 20 }),
    onSuccess: (payload) => {
      mergeRepairTask(payload.repair_task);
      const history = payload.repair_task.action_history ?? [];
      const summary = history[history.length - 1]?.result_summary ?? `${payload.action} 已执行。`;
      setNotice(summary);
      void queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['ci-gates'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-report', payload.repair_task.source_task_id] });
    },
    onError: (error) => setNotice(`动作执行失败：${formatApiError(error)}`),
  });

  function openResolve(record: RepairTaskRecord) {
    setResolveTask(record);
    resolveForm.setFieldsValue({ resolution_note: record.resolution_note ?? '' });
  }

  function openReopen(record: RepairTaskRecord) {
    setReopenTask(record);
    reopenForm.setFieldsValue({ reason: record.reopen_reason ?? '' });
  }

  function mergeRepairTask(updated: RepairTaskRecord) {
    queryClient.setQueriesData<RepairTaskRecord[]>({ queryKey: ['repair-tasks'] }, (current) => {
      if (!current) return current;
      return current.map((item) => {
        if (item.repair_task_id !== updated.repair_task_id) return item;
        const seen = new Set<string>();
        const actionHistory = [...(item.action_history ?? []), ...(updated.action_history ?? [])].filter((entry) => {
          const key = `${entry.action}:${entry.created_at ?? ''}:${entry.result_summary ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return { ...item, ...updated, action_history: actionHistory };
      });
    });
  }

  function runAction(record: RepairTaskRecord, action: string) {
    actionMutation.mutate({ record, action });
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="诊断闭环"
        title="修复任务工作台"
        description="把任务报告中的根因诊断沉淀为可领取、可完成、可重开的修复工作项，确保问题不会停在报告页面。"
        primaryAction={
          <Space>
            <Button href="/reports">回到报告中心</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void repairTasksQuery.refetch()}>
              刷新
            </Button>
          </Space>
        }
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="筛选条件">
        <Space wrap>
          <Select
            allowClear
            className="wide-search"
            placeholder="按状态筛选"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'open', label: '待处理' },
              { value: 'in_progress', label: '处理中' },
              { value: 'resolved', label: '已完成' },
            ]}
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
          <Typography.Text type="secondary">
            当前展示 {visibleRepairTasks.length} 个修复工作项。
          </Typography.Text>
        </Space>
      </Card>

      <Card className="flat-card" title="修复任务列表">
        <Table
          rowKey="repair_task_id"
          loading={repairTasksQuery.isLoading}
          dataSource={visibleRepairTasks}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '修复任务',
              dataIndex: 'title',
              render: (value, record) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{value}</Typography.Text>
                  <Typography.Text type="secondary">{record.recommendation}</Typography.Text>
                </Space>
              ),
            },
            { title: '状态', dataIndex: 'status', width: 96, render: renderStatus },
            { title: '根因', dataIndex: 'cause_type', width: 140, render: renderCauseType },
            { title: '级别', dataIndex: 'severity', width: 90, render: renderSeverity },
            { title: '影响样本', dataIndex: 'affected_items', width: 96 },
            {
              title: '证据',
              dataIndex: 'evidence',
              render: (items: string[]) => <Typography.Text>{items?.[0] ?? '-'}</Typography.Text>,
            },
            {
              title: '动作历史',
              dataIndex: 'action_history',
              width: 180,
              render: (items: RepairTaskRecord['action_history']) => (
                <Space direction="vertical" size={2}>
                  {items?.length ? items.map((item) => <Tag key={`${item.action}-${item.created_at ?? item.result_summary}`} color="blue">{item.action}</Tag>) : <Typography.Text type="secondary">未触发</Typography.Text>}
                </Space>
              ),
            },
            {
              title: '最近结果',
              dataIndex: 'last_action_result',
              width: 220,
              render: (_, record) => <RecentActionResult record={record} />,
            },
            {
              title: '来源任务',
              dataIndex: 'source_task_id',
              width: 160,
              render: (value) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{value}</Typography.Text>
                  {taskNameById[String(value)] ? <Typography.Text type="secondary">{taskNameById[String(value)]}</Typography.Text> : null}
                </Space>
              ),
            },
            { title: '负责人', dataIndex: 'owner', width: 120, render: (value) => value || '未领取' },
            {
              title: '操作',
              fixed: 'right',
              width: 300,
              render: (_, record) => (
                <Space wrap>
                  <Button size="small" href={`/reports?task_id=${record.source_task_id}`}>
                    查看报告
                  </Button>
                  <Button size="small" href={`/tasks/${record.source_task_id}/trace`}>
                    Trace
                  </Button>
                  <Button
                    size="small"
                    icon={<FileSearchOutlined />}
                    loading={actionMutation.isPending}
                    onClick={() => runAction(record, 'seed_annotation_queue')}
                  >
                    发起人工审核
                  </Button>
                  <Button
                    size="small"
                    icon={<CheckCircleOutlined />}
                    loading={actionMutation.isPending}
                    onClick={() => runAction(record, 'evaluate_ci_gate')}
                  >
                    CI Gate 复测
                  </Button>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={actionMutation.isPending}
                    onClick={() => runAction(record, 'retest_and_compare')}
                  >
                    复跑对比
                  </Button>
                  <Button
                    size="small"
                    icon={<FileSearchOutlined />}
                    loading={actionMutation.isPending}
                    onClick={() => runAction(record, 'generate_remediation_plan')}
                  >
                    生成建议
                  </Button>
                  <Button size="small" href={`/reports?task_id=${record.source_task_id}&panel=parameter-governance`}>
                    参数治理
                  </Button>
                  <Button
                    size="small"
                    icon={<UserAddOutlined />}
                    disabled={record.status !== 'open'}
                    loading={startMutation.isPending}
                    onClick={() => startMutation.mutate(record)}
                  >
                    领取
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    disabled={record.status === 'resolved'}
                    onClick={() => openResolve(record)}
                  >
                    完成
                  </Button>
                  <Button
                    size="small"
                    icon={<RollbackOutlined />}
                    disabled={record.status !== 'resolved'}
                    onClick={() => openReopen(record)}
                  >
                    重开
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="完成修复任务"
        open={Boolean(resolveTask)}
        forceRender
        onCancel={() => setResolveTask(null)}
        footer={[
          <Button key="cancel" onClick={() => setResolveTask(null)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!resolutionNote}
            loading={resolveMutation.isPending}
            onClick={() => resolveForm.submit()}
          >
            确认完成
          </Button>,
        ]}
      >
        <Space direction="vertical" className="drawer-stack">
          <Typography.Text type="secondary">修复任务：{resolveTask?.title}</Typography.Text>
          <Form form={resolveForm} layout="vertical" onFinish={(values) => resolveMutation.mutate(values)}>
            <Form.Item name="resolution_note" label="修复说明" rules={[{ required: true, message: '请填写修复说明' }]}>
              <Input.TextArea rows={4} placeholder="说明本次修复做了什么、如何验证" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="重开修复任务"
        open={Boolean(reopenTask)}
        forceRender
        onCancel={() => setReopenTask(null)}
        footer={[
          <Button key="cancel" onClick={() => setReopenTask(null)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!reopenReason}
            loading={reopenMutation.isPending}
            onClick={() => reopenForm.submit()}
          >
            确认重开
          </Button>,
        ]}
      >
        <Form form={reopenForm} layout="vertical" onFinish={(values) => reopenMutation.mutate(values)}>
          <Form.Item name="reason" label="重开原因" rules={[{ required: true, message: '请填写重开原因' }]}>
            <Input.TextArea rows={4} placeholder="说明为什么复测失败或需要再次处理" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function renderStatus(status: string) {
  const colorMap: Record<string, string> = {
    open: 'gold',
    in_progress: 'blue',
    resolved: 'green',
  };
  const labelMap: Record<string, string> = {
    open: '待处理',
    in_progress: '处理中',
    resolved: '已完成',
  };
  return <Tag color={colorMap[status] ?? 'default'}>{labelMap[status] ?? status}</Tag>;
}

function renderSeverity(value: string) {
  const color = value === 'critical' ? 'red' : value === 'warning' ? 'orange' : 'blue';
  return <Tag color={color}>{value}</Tag>;
}

function RecentActionResult({ record }: { record: RepairTaskRecord }) {
  const recommendations = extractRecommendations(record);
  if (recommendations.length) {
    return (
      <Space direction="vertical" size={2}>
        {recommendations.slice(0, 3).map((item) => (
          <Typography.Text key={`${item.area}-${item.title}`} type="secondary">
            {item.title}
          </Typography.Text>
        ))}
      </Space>
    );
  }
  const summary = record.action_history?.[record.action_history.length - 1]?.result_summary;
  return <Typography.Text type="secondary">{summary ?? '暂无结果'}</Typography.Text>;
}

function extractRecommendations(record: RepairTaskRecord): { area: string; title: string }[] {
  const result = record.last_action_result?.result;
  const recommendations = result?.recommendations;
  if (!Array.isArray(recommendations)) return [];
  return recommendations
    .map((item) => {
      if (!isRecord(item) || typeof item.title !== 'string') return null;
      return { area: typeof item.area === 'string' ? item.area : 'unknown', title: item.title };
    })
    .filter((item): item is { area: string; title: string } => Boolean(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function renderCauseType(value: string) {
  const labels: Record<string, string> = {
    runtime_error: '运行时错误',
    data_quality: '数据质量',
    weak_segment: '弱分层风险',
    judge_or_answer_quality: '回答或裁判质量',
    parameter_risk: '参数风险',
  };
  return labels[value] ?? value;
}
