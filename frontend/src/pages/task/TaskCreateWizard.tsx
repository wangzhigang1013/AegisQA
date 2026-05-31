import { Alert, Button, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo } from 'react';

import type { DatasetSummary, TaskExecutionTemplate, TaskPreflightResult, WorkflowVersion } from '../../types';

export type TaskCreateFormValues = {
  name: string;
  execution_template_id?: string;
  workflow_version_id: string;
  dataset_version_id: string;
  evaluation_goal?: string;
  pass_rate_threshold?: number;
  max_badcase_count?: number;
  chunk_size?: number;
  concurrency?: number;
  sample_repeat_times?: number;
  max_retries?: number;
  retry_backoff_seconds?: number;
  cost_budget?: number;
  allow_blocked_preflight?: boolean;
};

type TaskCreateWizardProps = {
  open: boolean;
  loading: boolean;
  preflightLoading: boolean;
  preflightResult?: TaskPreflightResult | null;
  datasets: DatasetSummary[];
  workflows: WorkflowVersion[];
  executionTemplates?: TaskExecutionTemplate[];
  onCancel: () => void;
  onPreflight: (values: TaskCreateFormValues) => void;
  onSubmit: (values: TaskCreateFormValues) => void;
};

export function TaskCreateWizard({ open, loading, preflightLoading, preflightResult, datasets, workflows, executionTemplates = [], onCancel, onPreflight, onSubmit }: TaskCreateWizardProps) {
  const [form] = Form.useForm<TaskCreateFormValues>();
  const watchedWorkflow = Form.useWatch('workflow_version_id', form);
  const watchedDataset = Form.useWatch('dataset_version_id', form);
  const watchedTemplate = Form.useWatch('execution_template_id', form);
  const watchedEvaluationGoal = Form.useWatch('evaluation_goal', form);
  const watchedPassRate = Form.useWatch('pass_rate_threshold', form);
  const watchedMaxBadcase = Form.useWatch('max_badcase_count', form);
  const watchedRepeat = Form.useWatch('sample_repeat_times', form);
  const watchedCostBudget = Form.useWatch('cost_budget', form);
  const allowBlockedPreflight = Form.useWatch('allow_blocked_preflight', form);
  const datasetVersions = useMemo(
    () => datasets.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))),
    [datasets],
  );
  const selectedDatasetVersion = datasetVersions.find((item) => item.version.version_id === watchedDataset)?.version;
  const currentExecutionTemplate = watchedTemplate ?? form.getFieldValue('execution_template_id');
  const currentEvaluationGoal = watchedEvaluationGoal ?? form.getFieldValue('evaluation_goal');
  const currentPassRate = watchedPassRate ?? form.getFieldValue('pass_rate_threshold');
  const currentMaxBadcase = watchedMaxBadcase ?? form.getFieldValue('max_badcase_count');
  const currentRepeat = watchedRepeat ?? form.getFieldValue('sample_repeat_times');
  const currentCostBudget = watchedCostBudget ?? form.getFieldValue('cost_budget');
  const preflightMatchesSelection = Boolean(
    preflightResult
      && selectedDatasetVersion
      && preflightResult.workflow_version_id === watchedWorkflow
      && preflightResult.dataset_id === selectedDatasetVersion.dataset_id
      && preflightResult.dataset_version === selectedDatasetVersion.version
      && preflightSignatureMatches(preflightResult, {
        executionTemplateId: currentExecutionTemplate,
        evaluationGoal: currentEvaluationGoal,
        passRate: currentPassRate,
        maxBadcaseCount: currentMaxBadcase,
        sampleRepeatTimes: currentRepeat,
        costBudget: currentCostBudget,
      }),
  );
  const preflightCanContinue = Boolean(
    preflightMatchesSelection
      && preflightResult
      && (preflightResult.status !== 'blocked' || allowBlockedPreflight),
  );
  const createDisabled = !watchedWorkflow || !watchedDataset || !preflightCanContinue;

  function applyExecutionTemplate(templateId: string) {
    const template = executionTemplates.find((item) => item.template_id === templateId);
    if (!template) return;
    const config = template.execution_config ?? {};
    const retry = config.retry ?? {};
    const qualityGate = template.quality_gate ?? {};
    form.setFieldsValue({
      execution_template_id: template.template_id,
      evaluation_goal: template.evaluation_goal ?? undefined,
      pass_rate_threshold: numberOrUndefined(qualityGate.pass_rate),
      max_badcase_count: numberOrUndefined(qualityGate.max_badcase_count),
      chunk_size: numberOrUndefined(config.chunk_size),
      concurrency: numberOrUndefined(config.concurrency),
      sample_repeat_times: numberOrUndefined(config.sample_repeat_times),
      max_retries: numberOrUndefined(retry.max_retries),
      retry_backoff_seconds: numberOrUndefined(retry.backoff_seconds),
      cost_budget: numberOrUndefined(config.cost_budget),
    });
  }

  useEffect(() => {
    if (!open) {
      form.resetFields();
    }
  }, [form, open]);

  return (
    <Modal
      title="创建任务向导"
      open={open}
      forceRender
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="preflight"
          loading={preflightLoading}
          disabled={!watchedWorkflow || !watchedDataset}
          onClick={() => onPreflight(form.getFieldsValue(true) as TaskCreateFormValues)}
        >
          运行 Preflight
        </Button>,
        <Button
          key="create"
          type="primary"
          loading={loading}
          disabled={createDisabled}
          onClick={() => form.submit()}
        >
          确认创建任务
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" className="drawer-stack">
        <Typography.Text type="secondary">
          任务会固定当前 Dataset Version、Workflow Version 和执行参数，后续报告与 Badcase 都以这次任务为入口。
        </Typography.Text>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            evaluation_goal: 'release_gate',
            pass_rate_threshold: 0.9,
            max_badcase_count: 0,
            chunk_size: 100,
            concurrency: 1,
            sample_repeat_times: 1,
            max_retries: 1,
            retry_backoff_seconds: 0,
            allow_blocked_preflight: false,
          }}
          onFinish={(values) =>
            onSubmit({
              ...values,
              // 强制创建只对 blocked Preflight 生效，避免用户重跑通过后仍带着旧风险标记提交。
              allow_blocked_preflight: Boolean(preflightResult?.status === 'blocked' && values.allow_blocked_preflight),
            })
          }
        >
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请填写任务名称' }]}>
            <Input placeholder="例如：RAG 回归评测 2026-05-31" />
          </Form.Item>
          <Form.Item name="execution_template_id" label="执行参数模板" tooltip="模板会一次性填充评测目的、质量门槛、并发、repeat、重试和成本预算，方便同类任务保持一致。">
            <Select
              aria-label="执行参数模板"
              allowClear
              placeholder="选择执行策略模板"
              optionFilterProp="label"
              onChange={(value) => {
                if (value) applyExecutionTemplate(String(value));
              }}
              options={executionTemplates.map((template) => ({
                value: template.template_id,
                label: `${template.name}${template.source === 'builtin' ? ' / 内置' : ''}`,
              }))}
            />
          </Form.Item>
          <Typography.Title level={5}>评测目的</Typography.Title>
          <Form.Item name="evaluation_goal" label="目标类型" tooltip="任务目标会写入任务快照，并影响预检对 Golden、门槛和报告结论的判断。">
            <Select
              options={[
                { value: 'release_gate', label: '上线门禁' },
                { value: 'regression', label: '回归评测' },
                { value: 'prompt_experiment', label: 'Prompt 实验' },
                { value: 'judge_audit', label: 'Judge 审计' },
                { value: 'red_team', label: '红队扫描' },
              ]}
            />
          </Form.Item>
          <Form.Item name="dataset_version_id" label="Dataset Version" rules={[{ required: true, message: '请选择 Dataset' }]}>
            <Select
              aria-label="Dataset Version"
              showSearch
              optionFilterProp="label"
              placeholder="选择数据版本"
              options={datasetVersions.map(({ version }) => ({ value: version.version_id, label: `${version.name} v${version.version} / ${version.row_count} 条` }))}
            />
          </Form.Item>
          <Form.Item name="workflow_version_id" label="Workflow Version" rules={[{ required: true, message: '请选择 Workflow' }]}>
            <Select
              aria-label="Workflow Version"
              showSearch
              optionFilterProp="label"
              placeholder="选择已发布 Workflow"
              options={workflows.map((workflow) => ({ value: workflow.version_id, label: `${workflow.name} v${workflow.version}` }))}
            />
          </Form.Item>
          <Typography.Title level={5}>质量门槛</Typography.Title>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="pass_rate_threshold" label="最低通过率">
                <InputNumber min={0} max={1} step={0.01} precision={2} className="full-width-control" placeholder="例如：0.90" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_badcase_count" label="最大 Badcase 数">
                <InputNumber min={0} className="full-width-control" placeholder="例如：0" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="chunk_size" label="分片大小">
                <InputNumber min={1} className="full-width-control" placeholder="100" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="concurrency" label="并发">
                <InputNumber min={1} className="full-width-control" placeholder="1" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sample_repeat_times" label="重复次数">
                <InputNumber min={1} className="full-width-control" placeholder="repeat=1" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="max_retries" label="最大重试">
                <InputNumber min={0} className="full-width-control" placeholder="max=1" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="retry_backoff_seconds" label="退避秒数">
                <InputNumber min={0} className="full-width-control" placeholder="seconds=0" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cost_budget" label="成本预算">
                <InputNumber min={0} precision={2} className="full-width-control" placeholder="例如：20.00" />
              </Form.Item>
            </Col>
          </Row>
          {watchedWorkflow && watchedDataset && !preflightResult ? (
            <Alert
              showIcon
              type="info"
              message="请先运行 Preflight"
              description="创建任务前必须完成预检，避免缺字段、未审批 Skill 或预算配置缺失直接进入执行。"
            />
          ) : null}
          {preflightResult && !preflightMatchesSelection ? (
            <Alert
              showIcon
              type="warning"
              message="Preflight 结果已过期"
              description="Dataset、Workflow、执行模板、质量门槛、重复次数或成本预算已变化，请重新运行 Preflight。"
            />
          ) : null}
          {preflightResult && preflightMatchesSelection ? (
            <Space direction="vertical" className="full-width-control">
              <Alert
                showIcon
                type={preflightResult.status === 'blocked' ? 'error' : preflightResult.status === 'warning' ? 'warning' : 'success'}
                message={preflightTitle(preflightResult.status)}
                description={preflightResult.summary}
              />
              {preflightResult.status === 'blocked' ? (
                <Form.Item name="allow_blocked_preflight" valuePropName="checked">
                  <Checkbox>我已确认 Preflight 阻断风险，仍要创建任务</Checkbox>
                </Form.Item>
              ) : null}
              <Table
                size="small"
                pagination={false}
                rowKey="check_id"
                dataSource={preflightResult.checks}
                columns={[
                  { title: '检查项', dataIndex: 'title' },
                  { title: '状态', dataIndex: 'status', render: (value) => <Tag color={preflightColor(String(value))}>{value}</Tag> },
                  { title: '结果', dataIndex: 'message' },
                  { title: '修复建议', dataIndex: 'recommendation', render: (value) => value || '-' },
                ]}
              />
            </Space>
          ) : null}
        </Form>
      </Space>
    </Modal>
  );
}

function preflightTitle(status: string) {
  if (status === 'passed') return 'Preflight 通过';
  if (status === 'warning') return 'Preflight 有警告';
  return 'Preflight 阻断';
}

function preflightColor(status: string) {
  if (status === 'passed') return 'green';
  if (status === 'warning') return 'orange';
  return 'red';
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function preflightSignatureMatches(
  result: TaskPreflightResult,
  current: {
    executionTemplateId?: string | null;
    evaluationGoal?: string | null;
    passRate?: number | null;
    maxBadcaseCount?: number | null;
    sampleRepeatTimes?: number | null;
    costBudget?: number | null;
  },
) {
  const qualityGate = result.quality_gate ?? {};
  return (
    textSignature(result.execution_template_id) === textSignature(current.executionTemplateId)
    && textSignature(result.evaluation_goal) === textSignature(current.evaluationGoal)
    && numberSignature(qualityGate.pass_rate) === numberSignature(current.passRate)
    && numberSignature(qualityGate.max_badcase_count) === numberSignature(current.maxBadcaseCount)
    && numberSignature(result.sample_repeat_times) === numberSignature(current.sampleRepeatTimes)
    && numberSignature(result.cost_budget) === numberSignature(current.costBudget)
  );
}

function textSignature(value: unknown): string {
  return value === undefined || value === null || value === '' ? '' : String(value);
}

function numberSignature(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? String(numberValue) : '';
}
