import { CheckCircleOutlined, CheckOutlined, FileSearchOutlined, ReloadOutlined, RollbackOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Form, Input, Modal, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { RepairTaskPageResult, RepairTaskRecord, RepairTaskTree } from '../types';

type ResolveValues = {
  resolution_note: string;
};

type ReopenValues = {
  reason: string;
};

type AssignValues = {
  owner: string;
  due_at?: string;
};

export function RepairTasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [sourceTaskId, setSourceTaskId] = useState<string | undefined>();
  const [resolveTask, setResolveTask] = useState<RepairTaskRecord | null>(null);
  const [reopenTask, setReopenTask] = useState<RepairTaskRecord | null>(null);
  const [assignTask, setAssignTask] = useState<RepairTaskRecord | null>(null);
  const [treeTask, setTreeTask] = useState<RepairTaskRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairPage, setRepairPage] = useState(1);
  const repairPageSize = 8;
  const [resolveForm] = Form.useForm<ResolveValues>();
  const [reopenForm] = Form.useForm<ReopenValues>();
  const [assignForm] = Form.useForm<AssignValues>();
  const resolutionNote = Form.useWatch('resolution_note', resolveForm);
  const reopenReason = Form.useWatch('reason', reopenForm);
  const assignOwner = Form.useWatch('owner', assignForm);

  const repairTasksQuery = useQuery({
    queryKey: ['repair-tasks', sourceTaskId, statusFilter, repairPage, repairPageSize],
    queryFn: () => api.repairTasksPage({ source_task_id: sourceTaskId, status: statusFilter, page: repairPage, pageSize: repairPageSize }),
  });
  const repairTaskTreeQuery = useQuery({
    queryKey: ['repair-task-tree', treeTask?.repair_task_id],
    queryFn: () => api.repairTaskTree(treeTask?.repair_task_id ?? ''),
    enabled: Boolean(treeTask),
  });
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });

  const visibleRepairTasks = repairTasksQuery.data?.items ?? [];
  const repairPagination = repairTasksQuery.data?.pagination;

  const taskNameById = useMemo(() => {
    return Object.fromEntries((tasksQuery.data ?? []).map((task) => [task.task_id, task.name]));
  }, [tasksQuery.data]);

  const startMutation = useMutation({
    mutationFn: (record: RepairTaskRecord) => api.startRepairTask(record.repair_task_id, { owner: 'qa_owner' }),
    onSuccess: async (record) => {
      setNotice(`修复任务已领取：${record.owner ?? 'qa_owner'}。`);
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
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
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
    },
    onError: (error) => setNotice(`完成失败：${formatApiError(error)}`),
  });

  const assignMutation = useMutation({
    mutationFn: (values: AssignValues) => {
      if (!assignTask) throw new Error('请选择需要指派的修复任务。');
      return api.assignRepairTask(assignTask.repair_task_id, { owner: values.owner, due_at: values.due_at || null });
    },
    onSuccess: async (record) => {
      setAssignTask(null);
      assignForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['repair-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
      mergeRepairTasks([record]);
      setNotice(`修复任务已指派给：${record.owner}${record.overdue ? '，当前已逾期。' : '。'}`);
    },
    onError: (error) => setNotice(`指派失败：${formatApiError(error)}`),
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
      await queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
    },
    onError: (error) => setNotice(`重开失败：${formatApiError(error)}`),
  });

  const actionMutation = useMutation({
    mutationFn: ({ record, action }: { record: RepairTaskRecord; action: string }) =>
      api.runRepairTaskAction(record.repair_task_id, { action, assignee: 'qa_owner', limit: 20 }),
    onSuccess: (payload) => {
      const followups = extractRepairTasks(payload.result);
      mergeRepairTasks([payload.repair_task, ...followups]);
      const history = payload.repair_task.action_history ?? [];
      const summary = history[history.length - 1]?.result_summary ?? `${payload.action} 已执行。`;
      setNotice(summary);
      void queryClient.invalidateQueries({ queryKey: ['annotation-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['ci-gates'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task-report', payload.repair_task.source_task_id] });
      void queryClient.invalidateQueries({ queryKey: ['repair-task-tree'] });
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

  function openAssign(record: RepairTaskRecord) {
    setAssignTask(record);
    assignForm.setFieldsValue({ owner: record.owner ?? '', due_at: record.due_at ?? '' });
  }

  function mergeRepairTasks(updatedTasks: RepairTaskRecord[]) {
    queryClient.setQueryData<RepairTaskPageResult>(['repair-tasks', sourceTaskId, statusFilter, repairPage, repairPageSize], (current) => {
      if (!current) return current;
      const byId = new Map(current.items.map((item) => [item.repair_task_id, item]));
      updatedTasks.forEach((updated) => {
        const keepInCurrentList = (!sourceTaskId || updated.source_task_id === sourceTaskId) && (!statusFilter || updated.status === statusFilter);
        if (!keepInCurrentList) {
          byId.delete(updated.repair_task_id);
          return;
        }
        const existing = byId.get(updated.repair_task_id);
        if (!existing) {
          byId.set(updated.repair_task_id, updated);
          return;
        }
        const seen = new Set<string>();
        const actionHistory = [...(existing.action_history ?? []), ...(updated.action_history ?? [])].filter((entry) => {
          const key = `${entry.action}:${entry.created_at ?? ''}:${entry.result_summary ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        byId.set(updated.repair_task_id, { ...existing, ...updated, action_history: actionHistory });
      });
      return { ...current, items: Array.from(byId.values()) };
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
            aria-label="修复任务状态筛选"
            placeholder="按状态筛选"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setRepairPage(1);
            }}
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
            aria-label="修复任务来源任务筛选"
            placeholder="按来源任务筛选"
            value={sourceTaskId}
            onChange={(value) => {
              setSourceTaskId(value);
              setRepairPage(1);
            }}
            options={(tasksQuery.data ?? []).map((task) => ({ value: task.task_id, label: `${task.name} / ${task.status}` }))}
          />
          <Typography.Text type="secondary">
            当前展示 {repairPagination?.total_items ?? visibleRepairTasks.length} 个修复工作项。
          </Typography.Text>
        </Space>
      </Card>

      <Card className="flat-card" title="修复任务列表">
        <Table
          rowKey="repair_task_id"
          loading={repairTasksQuery.isLoading}
          dataSource={visibleRepairTasks}
          pagination={{
            current: repairPagination?.page ?? repairPage,
            pageSize: repairPagination?.page_size ?? repairPageSize,
            total: repairPagination?.total_items ?? visibleRepairTasks.length,
            showSizeChanger: false,
            onChange: setRepairPage,
          }}
          columns={[
            {
              title: '修复任务',
              dataIndex: 'title',
              render: (value, record) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{value}</Typography.Text>
                  <Typography.Text type="secondary">{record.recommendation}</Typography.Text>
                  {record.parent_repair_task_id ? <Tag color="purple">子任务</Tag> : null}
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
              title: '推荐动作',
              dataIndex: 'recommended_action',
              width: 170,
              render: (value, record) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{value || record.next_actions?.[0] || '-'}</Typography.Text>
                  {record.target_url ? <Button size="small" href={record.target_url}>打开入口</Button> : null}
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
            { title: '负责人', dataIndex: 'owner', width: 150, render: (_, record) => <RepairOwner record={record} onAssign={() => openAssign(record)} /> },
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
                  <Button size="small" onClick={() => setTreeTask(record)}>
                    查看进度
                  </Button>
                  <Button
                    size="small"
                    aria-label={`指派修复任务：${record.title}`}
                    onClick={() => openAssign(record)}
                    disabled={record.status === 'resolved'}
                  >
                    指派
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
                  <Button
                    size="small"
                    icon={<FileSearchOutlined />}
                    loading={actionMutation.isPending}
                    onClick={() => runAction(record, 'create_followup_repair_tasks')}
                  >
                    拆分子任务
                  </Button>
                  {hasRepairAction(record, 'fix_dataset_fields') ? (
                    <Button
                      size="small"
                      icon={<FileSearchOutlined />}
                      loading={actionMutation.isPending}
                      onClick={() => runAction(record, 'fix_dataset_fields')}
                    >
                      字段修复计划
                    </Button>
                  ) : null}
                  {hasRepairAction(record, 'plan_workflow_parameter_changes') ? (
                    <Button
                      size="small"
                      icon={<FileSearchOutlined />}
                      loading={actionMutation.isPending}
                      onClick={() => runAction(record, 'plan_workflow_parameter_changes')}
                    >
                      参数 diff/回滚
                    </Button>
                  ) : null}
                  {hasRepairAction(record, 'compare_prompt_skill_versions') ? (
                    <Button
                      size="small"
                      icon={<FileSearchOutlined />}
                      loading={actionMutation.isPending}
                      onClick={() => runAction(record, 'compare_prompt_skill_versions')}
                    >
                      版本对比
                    </Button>
                  ) : null}
                  {hasCandidateAction(record, 'create_prompt_skill_candidate') ? (
                    <Button
                      size="small"
                      icon={<FileSearchOutlined />}
                      loading={actionMutation.isPending}
                      onClick={() => runAction(record, 'create_prompt_skill_candidate')}
                    >
                      沉淀候选
                    </Button>
                  ) : null}
                  {hasCandidateAction(record, 'create_workflow_draft_from_version_diff') ? (
                    <Button
                      size="small"
                      icon={<FileSearchOutlined />}
                      loading={actionMutation.isPending}
                      onClick={() => runAction(record, 'create_workflow_draft_from_version_diff')}
                    >
                      生成草稿
                    </Button>
                  ) : null}
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

      <Modal
        title="指派修复任务"
        open={Boolean(assignTask)}
        forceRender
        onCancel={() => setAssignTask(null)}
        footer={[
          <Button key="cancel" onClick={() => setAssignTask(null)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            disabled={!assignOwner}
            loading={assignMutation.isPending}
            onClick={() => assignForm.submit()}
          >
            确认指派
          </Button>,
        ]}
      >
        <Space direction="vertical" className="drawer-stack">
          <Typography.Text type="secondary">修复任务：{assignTask?.title}</Typography.Text>
          <Form form={assignForm} layout="vertical" onFinish={(values) => assignMutation.mutate(values)}>
            <Form.Item name="owner" label="负责人" rules={[{ required: true, message: '请填写负责人' }]}>
              <Input placeholder="例如：dataset_owner" />
            </Form.Item>
            <Form.Item name="due_at" label="截止时间">
              <Input placeholder="例如：2026-06-01T00:00:00+00:00" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <RepairTaskTreeDrawer
        tree={repairTaskTreeQuery.data}
        loading={repairTaskTreeQuery.isLoading}
        open={Boolean(treeTask)}
        onClose={() => setTreeTask(null)}
      />
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
  const fieldActions = extractFieldFixActions(record);
  if (fieldActions.length) {
    return (
      <Space direction="vertical" size={2}>
        <Typography.Text type="secondary">字段修复计划</Typography.Text>
        {fieldActions.slice(0, 3).map((item) => (
          <Typography.Text key={`${item.field}-${item.action}`} type={item.required_by_workflow ? 'danger' : 'secondary'}>
            {item.field}：{item.recommendation}
          </Typography.Text>
        ))}
      </Space>
    );
  }
  const parameterDiffs = extractParameterDiffs(record);
  if (parameterDiffs.length) {
    return (
      <Space direction="vertical" size={2}>
        <Typography.Text type="secondary">参数 diff/回滚计划</Typography.Text>
        {parameterDiffs.slice(0, 3).map((item) => (
          <Typography.Text key={`${item.step_id}-${item.parameter}`} type={item.source === 'task_override' ? 'warning' : 'secondary'}>
            {item.step_id}.{item.parameter}：当前 {String(item.current_value_preview ?? '-')}，Workflow 默认 {String(item.workflow_value_preview ?? '-')}。{item.recommendation}
          </Typography.Text>
        ))}
      </Space>
    );
  }
  const versionDiffs = extractPromptSkillVersionDiffs(record);
  if (versionDiffs.length) {
    return (
      <Space direction="vertical" size={2}>
        <Typography.Text type="secondary">Prompt/Skill 版本对比</Typography.Text>
        {versionDiffs.slice(0, 3).map((item) => (
          <Typography.Text key={`${item.step_id}-${item.field}`} type={item.field === 'prompt_version' ? 'warning' : 'secondary'}>
            {item.step_id}.{item.field}：baseline {String(item.baseline_value ?? '-')}，当前 {String(item.current_value ?? '-')}。建议：{item.recommended_action}
          </Typography.Text>
        ))}
      </Space>
    );
  }
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

function hasRepairAction(record: RepairTaskRecord, action: string) {
  return record.recommended_action === action || record.next_actions?.includes(action) || record.last_action_result?.action === action;
}

function hasCandidateAction(record: RepairTaskRecord, action: string) {
  const candidateSources = [record.last_action_result?.result?.candidate_actions, record.version_compare_plan?.candidate_actions];
  return candidateSources.some((candidateActions) => {
    if (!Array.isArray(candidateActions)) return false;
    return candidateActions.some((item) => isRecord(item) && item.action === action);
  });
}

function RepairOwner({ record, onAssign }: { record: RepairTaskRecord; onAssign: () => void }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text>{record.owner || '未领取'}</Typography.Text>
      {record.due_at ? <Typography.Text type={record.overdue ? 'danger' : 'secondary'}>{record.overdue ? '已逾期' : '截止'}：{record.due_at}</Typography.Text> : null}
      {record.status !== 'resolved' ? (
        <Button size="small" aria-label={`快速指派负责人：${record.title}`} onClick={onAssign}>
          指派
        </Button>
      ) : null}
    </Space>
  );
}

function RepairTaskTreeDrawer({
  tree,
  loading,
  open,
  onClose,
}: {
  tree?: RepairTaskTree;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const summary = tree?.summary;
  const percent = Math.round((summary?.completion_rate ?? 0) * 100);
  return (
    <Drawer title="修复树进度" width={720} open={open} onClose={onClose}>
      <Space direction="vertical" className="drawer-stack">
        <Typography.Text type="secondary">
          父任务：{tree?.repair_task.title ?? '加载中'}
        </Typography.Text>
        <Space wrap>
          <Typography.Text strong>整体状态：{summary ? renderStatus(summary.overall_status) : '-'}</Typography.Text>
          <Typography.Text>
            已完成 {summary?.resolved_children ?? 0} / {summary?.total_children ?? 0}
          </Typography.Text>
          <Typography.Text type="secondary">阻塞子任务 {summary?.blocking_children.length ?? 0} 个</Typography.Text>
          <Typography.Text type={(summary?.overdue_children ?? 0) > 0 ? 'danger' : 'secondary'}>
            逾期子任务 {summary?.overdue_children ?? 0} 个
          </Typography.Text>
        </Space>
        <Progress percent={percent} status={percent === 100 ? 'success' : 'active'} />

        <Typography.Title level={5}>下一步动作</Typography.Title>
        <Table
          size="small"
          rowKey="repair_task_id"
          loading={loading}
          dataSource={summary?.next_actions ?? []}
          pagination={false}
          columns={[
            { title: '子任务', dataIndex: 'title' },
            { title: '状态', dataIndex: 'status', width: 110, render: renderStatus },
            { title: '负责人', dataIndex: 'owner', width: 120, render: (value) => value || '未领取' },
            { title: '截止时间', dataIndex: 'due_at', width: 210, render: (value, record) => value ? <Typography.Text type={record.overdue ? 'danger' : 'secondary'}>{value}</Typography.Text> : '-' },
            { title: '推荐动作', dataIndex: 'recommended_action', width: 180 },
            {
              title: '入口',
              dataIndex: 'target_url',
              width: 120,
              render: (value: string | null) => (value ? <Button size="small" href={value}>打开</Button> : '-'),
            },
          ]}
        />

        <Typography.Title level={5}>子任务明细</Typography.Title>
        <Table
          size="small"
          rowKey="repair_task_id"
          loading={loading}
          dataSource={tree?.children ?? []}
          pagination={false}
          columns={[
            { title: '标题', dataIndex: 'title' },
            { title: '状态', dataIndex: 'status', width: 110, render: renderStatus },
            { title: '根因', dataIndex: 'cause_type', width: 140, render: renderCauseType },
            { title: '推荐动作', dataIndex: 'recommended_action', width: 180, render: (value) => value || '-' },
            { title: '负责人', dataIndex: 'owner', width: 120, render: (value) => value || '未领取' },
            { title: '截止时间', dataIndex: 'due_at', width: 210, render: (value, record) => value ? <Typography.Text type={record.overdue ? 'danger' : 'secondary'}>{value}</Typography.Text> : '-' },
          ]}
        />
      </Space>
    </Drawer>
  );
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

function extractRepairTasks(result: Record<string, unknown>): RepairTaskRecord[] {
  const repairTasks = result.repair_tasks;
  if (!Array.isArray(repairTasks)) return [];
  return repairTasks.filter((item): item is RepairTaskRecord => isRecord(item) && typeof item.repair_task_id === 'string');
}

function extractFieldFixActions(record: RepairTaskRecord): { field: string; action: string; recommendation: string; required_by_workflow: boolean }[] {
  const result = record.last_action_result?.result;
  const fieldActions = result?.field_actions;
  if (!Array.isArray(fieldActions)) return [];
  return fieldActions
    .map((item) => {
      if (!isRecord(item) || typeof item.field !== 'string') return null;
      return {
        field: item.field,
        action: typeof item.action === 'string' ? item.action : 'inspect',
        recommendation: typeof item.recommendation === 'string' ? item.recommendation : '请检查该字段的数据质量。',
        required_by_workflow: Boolean(item.required_by_workflow),
      };
    })
    .filter((item): item is { field: string; action: string; recommendation: string; required_by_workflow: boolean } => Boolean(item));
}

function extractParameterDiffs(record: RepairTaskRecord): {
  step_id: string;
  parameter: string;
  source: string;
  current_value_preview: unknown;
  workflow_value_preview: unknown;
  recommendation: string;
}[] {
  const result = record.last_action_result?.result;
  const diffs = result?.parameter_diffs;
  if (!Array.isArray(diffs)) return [];
  return diffs
    .map((item) => {
      if (!isRecord(item) || typeof item.step_id !== 'string' || typeof item.parameter !== 'string') return null;
      return {
        step_id: item.step_id,
        parameter: item.parameter,
        source: typeof item.source === 'string' ? item.source : 'unknown',
        current_value_preview: item.current_value_preview,
        workflow_value_preview: item.workflow_value_preview,
        recommendation: typeof item.recommendation === 'string' ? item.recommendation : '请确认该参数来源是否符合本次评测目标。',
      };
    })
    .filter((item): item is {
      step_id: string;
      parameter: string;
      source: string;
      current_value_preview: unknown;
      workflow_value_preview: unknown;
      recommendation: string;
    } => Boolean(item));
}

function extractPromptSkillVersionDiffs(record: RepairTaskRecord): {
  step_id: string;
  field: string;
  baseline_value: unknown;
  current_value: unknown;
  recommended_action: string;
}[] {
  const result = record.last_action_result?.result;
  const candidates = result?.baseline_candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .flatMap((candidate) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.version_diffs)) return [];
      return candidate.version_diffs;
    })
    .map((item) => {
      if (!isRecord(item) || typeof item.step_id !== 'string' || typeof item.field !== 'string') return null;
      return {
        step_id: item.step_id,
        field: item.field,
        baseline_value: item.baseline_value,
        current_value: item.current_value,
        recommended_action: typeof item.recommended_action === 'string' ? item.recommended_action : 'review_version_diff',
      };
    })
    .filter((item): item is {
      step_id: string;
      field: string;
      baseline_value: unknown;
      current_value: unknown;
      recommended_action: string;
    } => Boolean(item));
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
    annotation: '人工审核',
    workflow_parameters: '参数治理',
    dataset: '数据修复',
  };
  return labels[value] ?? value;
}
