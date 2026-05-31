import { CheckCircleOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { CIGateConfigRecord, CIGateEvaluationPageResult, CIGateEvaluationRecord, CIGateEvaluationResult } from '../types';

type CIGateCreateValues = {
  name: string;
  description?: string;
  pass_rate_threshold?: number;
  badcase_threshold?: number;
  latency_threshold?: number;
};

type TargetKind = 'task' | 'run';

export function CIGatesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | undefined>();
  const [targetKind, setTargetKind] = useState<TargetKind>('task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [evaluation, setEvaluation] = useState<CIGateEvaluationResult | null>(null);
  const [evaluationPage, setEvaluationPage] = useState(1);
  const evaluationPageSize = 6;
  const [form] = Form.useForm<CIGateCreateValues>();
  const configName = Form.useWatch('name', form);

  const configsQuery = useQuery({ queryKey: ['ci-gates'], queryFn: api.ciGateConfigs });
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  const configs = configsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const activeConfigId = selectedConfigId ?? configs[0]?.config_id;
  const activeTaskId = selectedTaskId ?? tasks[0]?.task_id;
  const activeRunId = selectedRunId ?? runs[0]?.run_id;
  const canEvaluate = Boolean(activeConfigId && (targetKind === 'task' ? activeTaskId : activeRunId));
  const evaluationsQuery = useQuery({
    queryKey: ['ci-gate-evaluations', activeConfigId, evaluationPage, evaluationPageSize],
    queryFn: () => api.ciGateEvaluationsPage({ config_id: activeConfigId, page: evaluationPage, pageSize: evaluationPageSize }),
  });
  const evaluationHistory = evaluationsQuery.data?.items ?? [];
  const evaluationPagination = evaluationsQuery.data?.pagination;
  const historySummary = buildHistorySummary(evaluationsQuery.data?.summary, evaluationHistory);

  const createMutation = useMutation({
    mutationFn: (values: CIGateCreateValues) =>
      api.createCIGateConfig({
        name: values.name,
        description: values.description,
        status: 'active',
        gates: [
          {
            gate_id: 'pass-rate',
            metric: 'pass_rate',
            operator: '>=',
            threshold: values.pass_rate_threshold ?? 0.8,
            blocking: true,
          },
          {
            gate_id: 'badcase-budget',
            metric: 'badcase_count',
            operator: '<=',
            threshold: values.badcase_threshold ?? 0,
            blocking: false,
          },
          {
            gate_id: 'latency-budget',
            metric: 'p95_latency_ms',
            operator: '<=',
            threshold: values.latency_threshold ?? 3000,
            blocking: false,
          },
        ],
      }),
    onSuccess: async (config) => {
      setCreateOpen(false);
      form.resetFields();
      setSelectedConfigId(config.config_id);
      setEvaluationPage(1);
      setNotice(`质量门禁配置已创建：${config.name}`);
      await queryClient.invalidateQueries({ queryKey: ['ci-gates'] });
    },
    onError: (error) => setNotice(`质量门禁配置创建失败：${formatApiError(error)}`),
  });

  const evaluateMutation = useMutation({
    mutationFn: () => {
      if (!activeConfigId) throw new Error('请先选择质量门禁配置。');
      if (targetKind === 'task') {
        if (!activeTaskId) throw new Error('请先选择任务。');
        return api.evaluateCIGates({ config_id: activeConfigId, task_id: activeTaskId });
      }
      if (!activeRunId) throw new Error('请先选择 Run。');
      return api.evaluateCIGates({ config_id: activeConfigId, run_id: activeRunId });
    },
    onSuccess: async (result) => {
      setEvaluation(result);
      setEvaluationPage(1);
      setNotice(result.status === 'blocked' ? `质量门禁阻断：${result.blocking_failures} 条阻断规则未通过。` : '质量门禁通过，可以进入后续发布流程。');
      await queryClient.invalidateQueries({ queryKey: ['ci-gate-evaluations'] });
    },
    onError: (error) => setNotice(`质量门禁评估失败：${formatApiError(error)}`),
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="发布质量控制"
        title="CI Gate 质量门禁"
        description="把通过率、Badcase、耗时等指标固化为发布门槛，支持直接对任务或 Run 执行阻断评估。"
        primaryAction={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建质量门禁</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') || notice.includes('阻断') ? 'warning' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="Gate 评估控制台" extra={<Button icon={<ReloadOutlined />} onClick={() => void configsQuery.refetch()}>刷新配置</Button>}>
        <Row gutter={[16, 16]} align="bottom">
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">质量门禁配置</Typography.Text>
            <Select
              className="full-width-control"
              placeholder="选择质量门禁"
              value={activeConfigId}
              onChange={(value) => {
                setSelectedConfigId(value);
                setEvaluationPage(1);
              }}
              options={configs.map((config) => ({ value: config.config_id, label: config.name }))}
            />
          </Col>
          <Col xs={24} lg={5}>
            <Typography.Text type="secondary">评估目标</Typography.Text>
            <Radio.Group className="full-width-control" value={targetKind} onChange={(event) => setTargetKind(event.target.value)}>
              <Radio.Button value="task">任务</Radio.Button>
              <Radio.Button value="run">Run</Radio.Button>
            </Radio.Group>
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">{targetKind === 'task' ? '选择任务' : '选择 Run'}</Typography.Text>
            {targetKind === 'task' ? (
              <Select
                showSearch
                optionFilterProp="label"
                className="full-width-control"
                placeholder="选择任务"
                value={activeTaskId}
                onChange={setSelectedTaskId}
                options={tasks.map((task) => ({ value: task.task_id, label: `${task.name} / ${task.status}` }))}
              />
            ) : (
              <Select
                showSearch
                optionFilterProp="label"
                className="full-width-control"
                placeholder="选择 Run"
                value={activeRunId}
                onChange={setSelectedRunId}
                options={runs.map((run) => ({ value: run.run_id, label: `${run.run_id} / ${run.status}` }))}
              />
            )}
          </Col>
          <Col xs={24} lg={3}>
            <Button type="primary" block loading={evaluateMutation.isPending} disabled={!canEvaluate} onClick={() => evaluateMutation.mutate()}>
              执行 Gate 评估
            </Button>
          </Col>
        </Row>
      </Card>

      {evaluation ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card className="flat-card" title="评估结果">
              <Space direction="vertical" size={10}>
                <Tag icon={evaluation.status === 'passed' ? <CheckCircleOutlined /> : <StopOutlined />} color={evaluation.status === 'passed' ? 'green' : 'red'}>
                  {evaluation.status === 'passed' ? '通过' : '阻断'}
                </Tag>
                <Typography.Text>阻断规则：{evaluation.blocking_failures}</Typography.Text>
                <Typography.Text type="secondary">
                  目标：{evaluation.target ? `${evaluation.target.kind} / ${evaluation.target.id}` : '手动指标'}
                </Typography.Text>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card className="flat-card" title="阻断原因">
              <Space direction="vertical" className="drawer-stack">
                {evaluation.results.map((item) => (
                  <Alert
                    key={item.gate_id}
                    type={item.status === 'passed' ? 'success' : item.blocking ? 'error' : 'warning'}
                    showIcon
                    message={item.message}
                    description={`指标 ${item.metric} 实际值 ${formatMetric(item.actual)}，规则 ${item.operator} ${formatMetric(item.threshold)}，${item.blocking ? '阻断' : '仅预警'}`}
                  />
                ))}
              </Space>
            </Card>
          </Col>
        </Row>
      ) : null}

      <Card className="flat-card" title="历史趋势">
        <Row gutter={[12, 12]} className="metric-row">
          <Col xs={24} md={8}>
            <HistoryTile title="历史评估" value={historySummary.total} note={`最近：${historySummary.latestStatus}`} />
          </Col>
          <Col xs={24} md={8}>
            <HistoryTile title="阻断次数" value={historySummary.blocked} note="blocking gate 未通过" />
          </Col>
          <Col xs={24} md={8}>
            <HistoryTile title="通过次数" value={historySummary.passed} note="可进入发布流程" />
          </Col>
        </Row>
      </Card>

      <Card className="flat-card" title="评估历史">
        <Table
          rowKey="evaluation_id"
          loading={evaluationsQuery.isLoading}
          dataSource={evaluationHistory}
          pagination={{
            current: evaluationPagination?.page ?? evaluationPage,
            pageSize: evaluationPagination?.page_size ?? evaluationPageSize,
            total: evaluationPagination?.total_items ?? evaluationHistory.length,
            showSizeChanger: false,
            onChange: setEvaluationPage,
          }}
          columns={[
            { title: '评估 ID', dataIndex: 'evaluation_id', render: (value) => <code>{value}</code> },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'passed' ? 'green' : 'red'}>{value === 'passed' ? '通过' : '阻断'}</Tag> },
            { title: '目标', render: (_, record: CIGateEvaluationRecord) => formatTarget(record.target) },
            { title: '阻断规则', dataIndex: 'blocking_failures' },
            { title: '主要原因', render: (_, record: CIGateEvaluationRecord) => record.results.find((item) => item.status === 'failed')?.message ?? '全部规则通过' },
            { title: '时间', dataIndex: 'created_at' },
          ]}
        />
      </Card>

      <Card className="flat-card" title="质量门禁配置列表">
        <Table
          rowKey="config_id"
          loading={configsQuery.isLoading}
          dataSource={configs}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '配置名称', dataIndex: 'name', render: (value, record) => <Button type="link" onClick={() => setSelectedConfigId(record.config_id)}>{value}</Button> },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value}</Tag> },
            { title: '规则数', render: (_, record: CIGateConfigRecord) => record.gates.length },
            {
              title: '规则摘要',
              render: (_, record: CIGateConfigRecord) => (
                <Space wrap>
                  {record.gates.map((gate) => (
                    <Tag key={gate.gate_id} color={gate.blocking ? 'red' : 'gold'}>
                      {gate.metric} {gate.operator} {formatMetric(gate.threshold)}
                    </Tag>
                  ))}
                </Space>
              ),
            },
            { title: '说明', dataIndex: 'description' },
          ]}
        />
      </Card>

      <Modal
        title="新建质量门禁配置"
        open={createOpen}
        forceRender
        onCancel={() => setCreateOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setCreateOpen(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={createMutation.isPending} disabled={!configName} onClick={() => form.submit()}>保存配置</Button>,
        ]}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ pass_rate_threshold: 0.8, badcase_threshold: 0, latency_threshold: 3000 }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '请输入配置名称' }]}>
            <Input placeholder="例如：发布质量门禁" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="说明这个门禁适用于发布、回归还是线上评分。" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="pass_rate_threshold" label="通过率下限">
                <InputNumber min={0} max={1} step={0.01} className="full-width-control" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="badcase_threshold" label="Badcase 上限">
                <InputNumber min={0} step={1} className="full-width-control" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="latency_threshold" label="P95 耗时上限(ms)">
                <InputNumber min={1} step={100} className="full-width-control" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </section>
  );
}

function formatMetric(value: unknown): string {
  if (typeof value !== 'number') return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function HistoryTile({ title, value, note }: { title: string; value: number; note: string }) {
  return (
    <Card size="small">
      <h3>{title}</h3>
      <Typography.Title level={3}>{value}</Typography.Title>
      <Typography.Text type="secondary">{note}</Typography.Text>
    </Card>
  );
}

function buildHistorySummary(summary: CIGateEvaluationPageResult['summary'] | undefined, history: CIGateEvaluationRecord[]) {
  if (summary) {
    return {
      total: summary.total_evaluations,
      blocked: summary.blocked,
      passed: summary.passed,
      latestStatus: formatHistoryStatus(summary.latest_status),
    };
  }
  const blocked = history.filter((item) => item.status === 'blocked').length;
  const passed = history.filter((item) => item.status === 'passed').length;
  const latest = history[history.length - 1];
  return {
    total: history.length,
    blocked,
    passed,
    latestStatus: latest ? (latest.status === 'passed' ? '通过' : '阻断') : '暂无',
  };
}

function formatHistoryStatus(status: string): string {
  if (status === 'passed') return '通过';
  if (status === 'blocked') return '阻断';
  return status || '暂无';
}

function formatTarget(target: CIGateEvaluationRecord['target']): string {
  if (!target) return '手动指标';
  return `${target.kind} / ${target.id}`;
}
