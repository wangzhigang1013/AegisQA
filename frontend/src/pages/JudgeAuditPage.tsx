import { AuditOutlined, PartitionOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { LazyECharts } from '../components/LazyECharts';
import { MetricTile } from '../components/MetricTile';
import { PageHeader } from '../components/PageHeader';

type AuditFormValues = {
  profile_id?: string;
  dataset_version_id: string;
  human_labels: string;
  judge_labels: string;
};

type ProfileFormValues = {
  name: string;
  model: string;
  prompt: string;
  threshold: number;
};

type CrossValidationFormValues = {
  dataset_version_id: string;
  human_labels: string;
  judge_outputs_json: string;
};

export function JudgeAuditPage() {
  const queryClient = useQueryClient();
  const [auditOpen, setAuditOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [crossOpen, setCrossOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [auditForm] = Form.useForm<AuditFormValues>();
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [crossForm] = Form.useForm<CrossValidationFormValues>();

  const profilesQuery = useQuery({ queryKey: ['judge-profiles'], queryFn: api.judgeProfiles });
  const auditsQuery = useQuery({ queryKey: ['judge-audits'], queryFn: api.judgeAudits });
  const trendsQuery = useQuery({ queryKey: ['judge-audit-trends'], queryFn: api.judgeAuditTrends });
  const latestAudit = auditsQuery.data?.[0] ?? null;

  const createProfileMutation = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      api.createJudgeProfile({
        name: values.name,
        model: values.model,
        prompt: values.prompt,
        threshold: values.threshold,
        rubric: { pass: '满足评测标准', fail: '不满足评测标准' },
        output_schema: { type: 'object', properties: { label: { type: 'string' }, score: { type: 'number' } } },
      }),
    onSuccess: async (profile) => {
      setNotice(`Judge Profile 已创建：${profile.name}`);
      setProfileOpen(false);
      profileForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['judge-profiles'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `创建 Profile 失败：${error.message}` : '创建 Profile 失败'),
  });

  const createAuditMutation = useMutation({
    mutationFn: (values: AuditFormValues) => {
      const profileId = values.profile_id ?? profilesQuery.data?.[0]?.profile_id;
      if (!profileId) {
        throw new Error('请先创建或选择 Judge Profile');
      }
      const humanLabels = values.human_labels.split(',').map((item) => item.trim()).filter(Boolean);
      const judgeLabels = values.judge_labels.split(',').map((item) => item.trim()).filter(Boolean);
      return api.createJudgeAudit(profileId, {
        dataset_version_id: values.dataset_version_id,
        human_labels: humanLabels,
        judge_labels: judgeLabels,
      });
    },
    onSuccess: async (audit) => {
      setNotice(`审计完成：Accuracy ${audit.accuracy.toFixed(2)}`);
      setAuditOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['judge-audits'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `创建审计失败：${error.message}` : '创建审计失败'),
  });

  const crossValidationMutation = useMutation({
    mutationFn: (values: CrossValidationFormValues) => {
      const judgeOutputs = JSON.parse(values.judge_outputs_json) as Record<string, string[]>;
      return api.crossValidateJudges({
        dataset_version_id: values.dataset_version_id,
        human_labels: values.human_labels.split(',').map((item) => item.trim()).filter(Boolean),
        judge_outputs_by_profile: judgeOutputs,
      });
    },
    onSuccess: () => setNotice('多 Judge 一致性分析完成。'),
    onError: (error) => setNotice(error instanceof Error ? `一致性分析失败：${error.message}` : '一致性分析失败'),
  });

  const matrixOption = useMemo(() => {
    const matrix = latestAudit?.confusion_matrix ?? { pass: { pass: 0, fail: 0 }, fail: { pass: 0, fail: 0 } };
    const labels = Object.keys(matrix);
    return {
      tooltip: {},
      xAxis: { type: 'category', data: labels.map((label) => `judge: ${label}`) },
      yAxis: { type: 'category', data: labels.map((label) => `human: ${label}`) },
      visualMap: { min: 0, max: 12, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
      series: [
        {
          type: 'heatmap',
          data: labels.flatMap((human, y) => labels.map((judge, x) => [x, y, matrix[human]?.[judge] ?? 0])),
        },
      ],
    };
  }, [latestAudit]);

  const trendsOption = useMemo(() => {
    const profile = trendsQuery.data?.profiles[0];
    const series = profile?.series ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Accuracy', 'Kappa'] },
      grid: { left: 36, right: 20, top: 40, bottom: 32 },
      xAxis: { type: 'category', data: series.map((item) => item.dataset_version_id) },
      yAxis: { type: 'value', min: 0, max: 1 },
      series: [
        { name: 'Accuracy', type: 'line', data: series.map((item) => item.accuracy), smooth: true },
        { name: 'Kappa', type: 'line', data: series.map((item) => item.cohen_kappa), smooth: true },
      ],
    };
  }, [trendsQuery.data]);

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="裁判可信度"
        title="Judge 审计"
        description="用 Golden Dataset 审计 Judge Profile，关注 Accuracy、Precision、Recall、F1、Kappa 和多裁判一致性。"
        primaryAction={
          <Space>
            <Button icon={<PartitionOutlined />} onClick={() => setProfileOpen(true)}>创建 Profile</Button>
            <Button onClick={() => setCrossOpen(true)}>多 Judge 一致性</Button>
            <Button type="primary" icon={<AuditOutlined />} onClick={() => setAuditOpen(true)}>创建审计</Button>
          </Space>
        }
      />

      {notice ? <Alert type={notice.includes('失败') || notice.includes('请先') ? 'warning' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}><MetricTile title="Accuracy" value={latestAudit?.accuracy ?? 0} icon={<AuditOutlined />} tone="green" note="整体" /></Col>
        <Col xs={24} sm={12} xl={6}><MetricTile title="Precision" value={latestAudit?.precision ?? 0} icon={<AuditOutlined />} tone="blue" note="正例" /></Col>
        <Col xs={24} sm={12} xl={6}><MetricTile title="Recall" value={latestAudit?.recall ?? 0} icon={<AuditOutlined />} tone="violet" note="召回" /></Col>
        <Col xs={24} sm={12} xl={6}><MetricTile title="Kappa" value={latestAudit?.cohen_kappa ?? 0} icon={<PartitionOutlined />} tone="amber" note="一致性" /></Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="flat-card" title="混淆矩阵">
            <LazyECharts option={matrixOption} style={{ height: 300 }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="flat-card" title="错判样本">
            <Table
              rowKey={(record) => JSON.stringify(record)}
              pagination={false}
              dataSource={latestAudit?.misclassified_items ?? []}
              columns={[
                { title: '样本', dataIndex: 'index' },
                { title: '人工', dataIndex: 'human_label' },
                { title: 'Judge', dataIndex: 'judge_label' },
                { title: '偏差', dataIndex: 'bias', render: (value) => <Tag color="red">{value ?? 'misclassified'}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card className="flat-card" title="Judge 偏差趋势" loading={trendsQuery.isLoading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Space wrap>
              <Tag>审计 {trendsQuery.data?.summary.audit_count ?? 0}</Tag>
              <Tag>Profile {trendsQuery.data?.summary.profile_count ?? 0}</Tag>
              <Tag color={(trendsQuery.data?.summary.low_consistency_count ?? 0) > 0 ? 'orange' : 'green'}>低一致性 {trendsQuery.data?.summary.low_consistency_count ?? 0}</Tag>
            </Space>
            <LazyECharts option={trendsOption} style={{ height: 280 }} />
          </Col>
          <Col xs={24} lg={12}>
            <Typography.Title level={5}>低一致性 Profile</Typography.Title>
            <Table
              size="small"
              rowKey="profile_id"
              pagination={false}
              dataSource={trendsQuery.data?.low_consistency_profiles ?? []}
              columns={[
                { title: 'Profile', dataIndex: 'profile_id' },
                { title: 'Accuracy', dataIndex: 'accuracy', render: (value) => Number(value ?? 0).toFixed(2) },
                { title: 'Kappa', dataIndex: 'cohen_kappa', render: (value) => Number(value ?? 0).toFixed(2) },
                { title: '建议', dataIndex: 'message' },
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Modal title="创建 Judge 审计" open={auditOpen} onCancel={() => setAuditOpen(false)} onOk={() => auditForm.submit()} confirmLoading={createAuditMutation.isPending} okText="开始审计">
        <Form
          form={auditForm}
          layout="vertical"
          initialValues={{ dataset_version_id: 'dataset:v1', human_labels: 'pass,fail', judge_labels: 'pass,pass' }}
          onFinish={(values) => createAuditMutation.mutate(values)}
        >
          <Form.Item name="profile_id" label="Judge Profile">
            <Select options={(profilesQuery.data ?? []).map((profile) => ({ value: profile.profile_id, label: profile.name }))} />
          </Form.Item>
          <Form.Item name="dataset_version_id" label="Golden Dataset Version" rules={[{ required: true, message: '请输入 Dataset Version' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="human_labels" label="人工标签，逗号分隔" rules={[{ required: true, message: '请输入人工标签' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="judge_labels" label="Judge 标签，逗号分隔" rules={[{ required: true, message: '请输入 Judge 标签' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="创建 Judge Profile" open={profileOpen} onCancel={() => setProfileOpen(false)} onOk={() => profileForm.submit()} confirmLoading={createProfileMutation.isPending} okText="保存 Profile">
        <Form
          form={profileForm}
          layout="vertical"
          initialValues={{ name: '默认裁判', model: 'demo-model', prompt: '请判断回答是否满足参考答案。', threshold: 0.6 }}
          onFinish={(values) => createProfileMutation.mutate(values)}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true, message: '请输入模型' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="prompt" label="Prompt" rules={[{ required: true, message: '请输入 Prompt' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="threshold" label="阈值">
            <InputNumber min={0} max={1} step={0.05} className="full-width-control" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="多 Judge 一致性"
        open={crossOpen}
        onCancel={() => setCrossOpen(false)}
        onOk={() => crossForm.submit()}
        okText="开始一致性分析"
        confirmLoading={crossValidationMutation.isPending}
      >
        <Form
          form={crossForm}
          layout="vertical"
          initialValues={{
            dataset_version_id: 'dataset-demo:v1',
            human_labels: 'pass,fail',
            judge_outputs_json: JSON.stringify({ 'judge-a': ['pass', 'fail'], 'judge-b': ['pass', 'pass'] }, null, 2),
          }}
          onFinish={(values) => crossValidationMutation.mutate(values)}
        >
          <Form.Item name="dataset_version_id" label="Golden Dataset Version" rules={[{ required: true, message: '请输入 Dataset Version' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="human_labels" label="人工标签，逗号分隔" rules={[{ required: true, message: '请输入人工标签' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="judge_outputs_json" label="Judge 输出 JSON" rules={[{ required: true, message: '请输入 Judge 输出' }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
        {crossValidationMutation.data ? (
          <Card size="small" title="一致性结果">
            <Table
              size="small"
              rowKey="pair"
              pagination={false}
              dataSource={Object.entries(crossValidationMutation.data.pairwise_agreement).map(([pair, agreement]) => ({ pair, agreement }))}
              columns={[
                { title: 'Judge Pair', dataIndex: 'pair' },
                { title: '一致率', dataIndex: 'agreement', render: (value) => `${Math.round(Number(value ?? 0) * 100)}%` },
              ]}
            />
          </Card>
        ) : null}
      </Modal>
    </section>
  );
}
