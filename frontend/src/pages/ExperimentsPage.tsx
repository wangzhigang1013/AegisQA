import { ExperimentOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { ExperimentRecord } from '../types';

type ExperimentCreateValues = {
  name: string;
  run_id: string;
  baseline_run_id?: string | null;
};

export function ExperimentsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [baselineExperimentId, setBaselineExperimentId] = useState<string | null>(null);
  const [form] = Form.useForm<ExperimentCreateValues>();
  const selectedRunId = Form.useWatch('run_id', form);
  const experimentName = Form.useWatch('name', form);

  const experimentsQuery = useQuery({ queryKey: ['experiments'], queryFn: api.experiments });
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const experiments = experimentsQuery.data ?? [];
  const activeExperiment = experiments.find((item) => item.experiment_id === selectedExperimentId) ?? experiments[0];
  const selectedBaseline = experiments.find((item) => item.experiment_id === baselineExperimentId);
  const comparison = useMemo(() => buildComparison(activeExperiment, selectedBaseline), [activeExperiment, selectedBaseline]);

  const createMutation = useMutation({
    mutationFn: (values: ExperimentCreateValues) =>
      api.createExperimentFromRun({
        name: values.name,
        run_id: values.run_id,
        baseline_run_id: values.baseline_run_id || null,
        tags: ['ui-created'],
      }),
    onSuccess: async (experiment) => {
      setNotice(`实验快照已生成：${experiment.name}`);
      setModalOpen(false);
      form.resetFields();
      setSelectedExperimentId(experiment.experiment_id);
      await queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
    onError: (error) => setNotice(`实验快照生成失败：${formatApiError(error)}`),
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="实验与对比"
        title="Experiment 实验中心"
        description="把正式 Run 固化为不可变实验快照，并和 baseline 对比通过率、失败样本与成本变化。"
        primaryAction={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>生成实验快照</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="Baseline 对比" extra={<Button icon={<ReloadOutlined />} onClick={() => void experimentsQuery.refetch()}>刷新</Button>}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">当前实验</Typography.Text>
            <Select
              className="full-width-control"
              placeholder="选择实验快照"
              value={activeExperiment?.experiment_id}
              onChange={setSelectedExperimentId}
              options={experiments.map((item) => ({ value: item.experiment_id, label: item.name }))}
            />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">Baseline</Typography.Text>
            <Select
              allowClear
              className="full-width-control"
              placeholder="选择 baseline 实验"
              value={baselineExperimentId}
              onChange={(value) => setBaselineExperimentId(value ?? null)}
              options={experiments.filter((item) => item.experiment_id !== activeExperiment?.experiment_id).map((item) => ({ value: item.experiment_id, label: item.name }))}
            />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary">快照状态</Typography.Text>
            <div>
              <Tag color={activeExperiment?.status === 'snapshotted' ? 'green' : 'blue'}>{activeExperiment?.status ?? '暂无实验'}</Tag>
            </div>
          </Col>
        </Row>

        <Row gutter={[12, 12]} className="metric-row">
          <Col xs={24} md={8}>
            <ComparisonCard title="通过率变化" value={formatPercentDelta(comparison.passRateDelta)} />
          </Col>
          <Col xs={24} md={8}>
            <ComparisonCard title="失败样本变化" value={formatNumberDelta(comparison.badcaseDelta)} />
          </Col>
          <Col xs={24} md={8}>
            <ComparisonCard title="成本变化" value={formatCurrencyDelta(comparison.costDelta)} />
          </Col>
        </Row>
      </Card>

      <Card className="flat-card" title="实验快照列表">
        <Table
          rowKey="experiment_id"
          loading={experimentsQuery.isLoading}
          dataSource={experiments}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '实验名称', dataIndex: 'name', render: (value, record) => <Button type="link" onClick={() => setSelectedExperimentId(record.experiment_id)}>{value}</Button> },
            { title: 'Run', dataIndex: 'run_id', render: (value) => <code>{value}</code> },
            { title: 'Baseline Run', dataIndex: 'baseline_run_id', render: (value) => (value ? <code>{value}</code> : '-') },
            { title: '通过率', render: (_, record) => formatPercent(record.metrics.pass_rate) },
            { title: 'Badcase', render: (_, record) => record.metrics.badcase_count ?? 0 },
            { title: '成本', render: (_, record) => formatCurrency(record.metrics.cost) },
            { title: '标签', dataIndex: 'tags', render: (tags: string[]) => <Space wrap>{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space> },
          ]}
        />
      </Card>

      <Modal
        title="从 Run 生成实验快照"
        open={modalOpen}
        forceRender
        onCancel={() => setModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={createMutation.isPending} disabled={!selectedRunId || !experimentName} onClick={() => form.submit()}>确认生成</Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="name" label="实验名称" rules={[{ required: true, message: '请输入实验名称' }]}>
            <Input placeholder="例如：RAG v2 回归实验" />
          </Form.Item>
          <Form.Item name="run_id" label="选择 Run" rules={[{ required: true, message: '请选择 Run' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择已完成 Run"
              options={(runsQuery.data ?? []).map((run) => ({ value: run.run_id, label: `${run.run_id} / ${run.status}` }))}
            />
          </Form.Item>
          <Form.Item name="baseline_run_id" label="Baseline Run">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="可选，用于生成 diff"
              options={(runsQuery.data ?? []).map((run) => ({ value: run.run_id, label: `${run.run_id} / ${run.status}` }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function ComparisonCard({ title, value }: { title: string; value: string }) {
  return (
    <Card size="small">
      <div className="metric-topline">
        <span className="metric-icon"><ExperimentOutlined /></span>
      </div>
      <h3>{title}</h3>
      <Typography.Title level={3}>{value}</Typography.Title>
    </Card>
  );
}

function buildComparison(active?: ExperimentRecord, selectedBaseline?: ExperimentRecord) {
  const diff = active?.diff ?? diffMetrics(active?.metrics, selectedBaseline?.metrics);
  return {
    passRateDelta: numberMetric(diff?.pass_rate),
    badcaseDelta: numberMetric(diff?.badcase_count),
    costDelta: numberMetric(diff?.cost),
  };
}

function diffMetrics(metrics?: Record<string, number>, baseline?: Record<string, number> | null): Record<string, number> {
  if (!metrics || !baseline) return {};
  const keys = new Set([...Object.keys(metrics), ...Object.keys(baseline)]);
  return Array.from(keys).reduce<Record<string, number>>((result, key) => {
    result[key] = (metrics[key] ?? 0) - (baseline[key] ?? 0);
    return result;
  }, {});
}

function numberMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-';
}

function formatPercentDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
}

function formatNumberDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function formatCurrency(value: unknown): string {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : '-';
}

function formatCurrencyDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`;
}
