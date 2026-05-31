import { Alert, Button, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';

import type { DatasetSummary, SkillManifest, TaskExecutionTemplate, TaskPreflightResult, WorkflowVersion } from '../../types';

type SkillOverrideValueType = 'string' | 'number' | 'boolean' | 'json' | 'expression' | 'secret';
type SkillOverrideConfigValue = string | number | boolean | Record<string, unknown> | unknown[];
type SkillOverrideConfig = Record<string, Record<string, SkillOverrideConfigValue>>;
type SkillStepOption = {
  value: string;
  label: string;
  skill_ref?: string;
};
type SkillParameterOption = {
  value: string;
  label: string;
  value_type: SkillOverrideValueType;
  default_value?: SkillOverrideConfigValue;
  description?: string;
};
type SkillConfigSchemaField = {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
};

export type SkillOverrideRow = {
  step_id?: string;
  parameter?: string;
  value_type?: SkillOverrideValueType;
  value?: SkillOverrideConfigValue;
};

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
  skill_override_rows?: SkillOverrideRow[];
  skill_overrides?: SkillOverrideConfig;
};

type TaskCreateWizardProps = {
  open: boolean;
  loading: boolean;
  preflightLoading: boolean;
  preflightResult?: TaskPreflightResult | null;
  datasets: DatasetSummary[];
  workflows: WorkflowVersion[];
  skills?: SkillManifest[];
  executionTemplates?: TaskExecutionTemplate[];
  onCancel: () => void;
  onPreflight: (values: TaskCreateFormValues) => void;
  onSubmit: (values: TaskCreateFormValues) => void;
};

export function TaskCreateWizard(props: TaskCreateWizardProps) {
  if (!props.open) {
    return null;
  }
  return <TaskCreateWizardContent {...props} />;
}

function TaskCreateWizardContent({ open, loading, preflightLoading, preflightResult, datasets, workflows, skills = [], executionTemplates = [], onCancel, onPreflight, onSubmit }: TaskCreateWizardProps) {
  const [form] = Form.useForm<TaskCreateFormValues>();
  const watchedWorkflow = Form.useWatch('workflow_version_id', form);
  const watchedDataset = Form.useWatch('dataset_version_id', form);
  const watchedTemplate = Form.useWatch('execution_template_id', form);
  const watchedEvaluationGoal = Form.useWatch('evaluation_goal', form);
  const watchedPassRate = Form.useWatch('pass_rate_threshold', form);
  const watchedMaxBadcase = Form.useWatch('max_badcase_count', form);
  const watchedRepeat = Form.useWatch('sample_repeat_times', form);
  const watchedCostBudget = Form.useWatch('cost_budget', form);
  const watchedOverrideRows = Form.useWatch('skill_override_rows', form);
  const allowBlockedPreflight = Form.useWatch('allow_blocked_preflight', form);
  const datasetVersions = useMemo(
    () => datasets.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))),
    [datasets],
  );
  const selectedWorkflow = workflows.find((workflow) => workflow.version_id === watchedWorkflow);
  const skillById = useMemo(() => indexSkillsById(skills), [skills]);
  const overrideTargets = useMemo(() => skillStepOptions(selectedWorkflow, skillById), [selectedWorkflow, skillById]);
  const selectedDatasetVersion = datasetVersions.find((item) => item.version.version_id === watchedDataset)?.version;
  const currentExecutionTemplate = watchedTemplate ?? form.getFieldValue('execution_template_id');
  const currentEvaluationGoal = watchedEvaluationGoal ?? form.getFieldValue('evaluation_goal');
  const currentPassRate = watchedPassRate ?? form.getFieldValue('pass_rate_threshold');
  const currentMaxBadcase = watchedMaxBadcase ?? form.getFieldValue('max_badcase_count');
  const currentRepeat = watchedRepeat ?? form.getFieldValue('sample_repeat_times');
  const currentCostBudget = watchedCostBudget ?? form.getFieldValue('cost_budget');
  const currentSkillOverrides = skillOverridesFromRows(watchedOverrideRows ?? form.getFieldValue('skill_override_rows'));
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
        skillOverrides: currentSkillOverrides,
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
    const templateValues: Partial<TaskCreateFormValues> = {
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
      skill_override_rows: skillOverridesToRows(config.skill_overrides),
    };
    form.setFieldsValue(templateValues);
  }

  return (
    <Modal
      title="创建任务向导"
      open={open}
      onCancel={onCancel}
      width={760}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="preflight"
          loading={preflightLoading}
          disabled={!watchedWorkflow || !watchedDataset}
          onClick={() => onPreflight(normalizeTaskCreateValues(form.getFieldsValue(true) as TaskCreateFormValues))}
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
              ...normalizeTaskCreateValues(values),
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
          <Typography.Title level={5}>任务级 Skill 参数覆盖</Typography.Title>
          <Alert
            showIcon
            type="info"
            message="覆盖只影响本次任务"
            description="适合临时替换模型、温度、阈值或 Secret 引用。覆盖值会进入 Preflight、任务快照和参数治理记录，修改后必须重新运行 Preflight。"
          />
          <Form.List name="skill_override_rows">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size="small" className="full-width-control">
                <Button
                  disabled={!watchedWorkflow || overrideTargets.length === 0}
                  onClick={() => add({ value_type: 'string' })}
                >
                  添加任务级参数覆盖
                </Button>
                {fields.map((field) => (
                  <Row key={field.key} gutter={12} align="bottom">
                    <Col span={6}>
                      <Form.Item name={[field.name, 'step_id']} label="覆盖 Step" rules={[{ required: true, message: '请选择 Step' }]}>
                        <Select
                          aria-label="覆盖 Step"
                          showSearch
                          optionFilterProp="label"
                          placeholder="选择 Skill Step"
                          options={overrideTargets}
                          onChange={() => {
                            form.setFieldValue(['skill_override_rows', field.name, 'parameter'], undefined);
                            form.setFieldValue(['skill_override_rows', field.name, 'value'], undefined);
                            form.setFieldValue(['skill_override_rows', field.name, 'value_type'], 'string');
                          }}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item shouldUpdate noStyle>
                        {({ getFieldValue }) => {
                          const stepId = stringOrEmpty(getFieldValue(['skill_override_rows', field.name, 'step_id']));
                          const parameterOptions = skillParameterOptions(selectedWorkflow, skillById, stepId);
                          return (
                            <Form.Item name={[field.name, 'parameter']} label="参数名" rules={[{ required: true, message: '请填写参数名' }]}>
                              {parameterOptions.length ? (
                                <Select
                                  aria-label="参数名"
                                  showSearch
                                  optionFilterProp="label"
                                  placeholder="选择参数"
                                  options={parameterOptions}
                                  onChange={(_, option) => {
                                    const selectedOption = Array.isArray(option) ? option[0] : option;
                                    const valueType = (selectedOption as SkillParameterOption | undefined)?.value_type ?? 'string';
                                    const defaultValue = (selectedOption as SkillParameterOption | undefined)?.default_value;
                                    form.setFieldValue(['skill_override_rows', field.name, 'value_type'], valueType);
                                    form.setFieldValue(['skill_override_rows', field.name, 'value'], defaultValue);
                                  }}
                                />
                              ) : (
                                <Input placeholder="例如：model" />
                              )}
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name={[field.name, 'value_type']} label="值类型" initialValue="string">
                        <Select
                          aria-label="覆盖值类型"
                          options={[
                            { value: 'string', label: '字符串' },
                            { value: 'number', label: '数字' },
                            { value: 'boolean', label: '布尔' },
                            { value: 'json', label: 'JSON' },
                            { value: 'expression', label: '表达式路径' },
                            { value: 'secret', label: 'Secret 引用' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item shouldUpdate noStyle>
                        {({ getFieldValue }) => {
                          const valueType = (getFieldValue(['skill_override_rows', field.name, 'value_type']) || 'string') as SkillOverrideValueType;
                          return (
                            <Form.Item name={[field.name, 'value']} label={overrideValueLabel(valueType)} rules={[{ required: true, message: '请填写覆盖值' }]}>
                              {overrideValueControl(valueType)}
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Button danger onClick={() => remove(field.name)}>删除</Button>
                    </Col>
                  </Row>
                ))}
                {watchedWorkflow && overrideTargets.length === 0 ? (
                  <Typography.Text type="secondary">当前 Workflow 没有可覆盖的 Skill Step。</Typography.Text>
                ) : null}
              </Space>
            )}
          </Form.List>
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

function normalizeTaskCreateValues(values: TaskCreateFormValues): TaskCreateFormValues {
  return {
    ...values,
    skill_overrides: skillOverridesFromRows(values.skill_override_rows),
  };
}

function indexSkillsById(skills: SkillManifest[]): Record<string, SkillManifest> {
  return skills.reduce<Record<string, SkillManifest>>((index, skill) => {
    index[skill.skill_id] = skill;
    return index;
  }, {});
}

function skillStepOptions(workflow?: WorkflowVersion, skillById: Record<string, SkillManifest> = {}): SkillStepOption[] {
  const graphSkillNodes = workflow?.graph?.nodes
    ?.filter((node) => node.node_type === 'skill')
    .map((node): SkillStepOption => ({
      value: node.node_id,
      label: `${node.label || node.node_id} / ${node.node_id}`,
      skill_ref: node.skill_ref,
    })) ?? [];
  const stepOptions = workflow?.steps?.map((step): SkillStepOption => ({
    value: step.step_id,
    label: `${skillById[step.skill_ref]?.name || step.step_id} / ${step.step_id}`,
    skill_ref: step.skill_ref,
  })) ?? [];
  const seen = new Set<string>();
  return [...graphSkillNodes, ...stepOptions].filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function skillParameterOptions(workflow: WorkflowVersion | undefined, skillById: Record<string, SkillManifest>, stepId: string): SkillParameterOption[] {
  const skillRef = skillRefForStep(workflow, stepId);
  const skill = skillRef ? skillById[skillRef] : undefined;
  if (!skill) return [];
  return Object.entries(configSchemaProperties(skill)).map(([field, schema]) => ({
    value: field,
    label: `${field} / ${schemaTypeLabel(schema)}`,
    value_type: inferOverrideValueType(schema),
    default_value: defaultOverrideValue(skill, field, schema),
    description: schema.description,
  }));
}

function skillRefForStep(workflow: WorkflowVersion | undefined, stepId: string): string | undefined {
  if (!workflow || !stepId) return undefined;
  const graphNode = workflow.graph?.nodes?.find((node) => node.node_id === stepId && node.node_type === 'skill');
  if (graphNode?.skill_ref) return graphNode.skill_ref;
  return workflow.steps?.find((step) => step.step_id === stepId)?.skill_ref;
}

function configSchemaProperties(skill: SkillManifest): Record<string, SkillConfigSchemaField> {
  const properties = skill.config_schema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  return properties as Record<string, SkillConfigSchemaField>;
}

function inferOverrideValueType(schema: SkillConfigSchemaField): SkillOverrideValueType {
  const type = firstSchemaType(schema.type);
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'object' || type === 'array') return 'json';
  return 'string';
}

function defaultOverrideValue(skill: SkillManifest, field: string, schema: SkillConfigSchemaField): SkillOverrideConfigValue | undefined {
  if (schema.default !== undefined) return ensureOverrideConfigValue(schema.default);
  const exampleValue = skill.example_config?.[field];
  return exampleValue === undefined ? undefined : ensureOverrideConfigValue(exampleValue);
}

function firstSchemaType(type: SkillConfigSchemaField['type']): string | undefined {
  return Array.isArray(type) ? type[0] : type;
}

function schemaTypeLabel(schema: SkillConfigSchemaField): string {
  return firstSchemaType(schema.type) || 'any';
}

function skillOverridesFromRows(rows: unknown): SkillOverrideConfig {
  if (!Array.isArray(rows)) return {};
  return rows.reduce<SkillOverrideConfig>((acc, row) => {
    if (!isRecord(row)) return acc;
    const stepId = stringOrEmpty(row.step_id);
    const parameter = stringOrEmpty(row.parameter);
    if (!stepId || !parameter) return acc;
    acc[stepId] = {
      ...(acc[stepId] ?? {}),
      [parameter]: normalizeOverrideValue(row.value_type, row.value),
    };
    return acc;
  }, {});
}

function skillOverridesToRows(overrides: unknown): SkillOverrideRow[] {
  if (!isRecord(overrides)) return [];
  return Object.entries(overrides).flatMap(([stepId, params]) => {
    if (!isRecord(params)) return [];
    return Object.entries(params).map(([parameter, value]) => {
      const { valueType, formValue } = overrideValueToForm(value);
      return {
        step_id: stepId,
        parameter,
        value_type: valueType,
        value: formValue,
      };
    });
  });
}

function normalizeOverrideValue(valueType: unknown, value: unknown): SkillOverrideConfigValue {
  if (valueType === 'number') {
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : stringOrEmpty(value);
  }
  if (valueType === 'boolean') {
    return value === true || value === 'true';
  }
  if (valueType === 'json') {
    try {
      return ensureOverrideConfigValue(JSON.parse(String(value ?? '')));
    } catch {
      return stringOrEmpty(value);
    }
  }
  if (valueType === 'expression') {
    return { type: 'expression', path: stringOrEmpty(value) };
  }
  if (valueType === 'secret') {
    return { type: 'secret', name: stringOrEmpty(value) };
  }
  return stringOrEmpty(value);
}

function overrideValueToForm(value: unknown): { valueType: SkillOverrideValueType; formValue: SkillOverrideRow['value'] } {
  if (isRecord(value) && value.type === 'expression') {
    return { valueType: 'expression', formValue: stringOrEmpty(value.path) };
  }
  if (isRecord(value) && value.type === 'secret') {
    return { valueType: 'secret', formValue: stringOrEmpty(value.name) };
  }
  if (typeof value === 'number') return { valueType: 'number', formValue: value };
  if (typeof value === 'boolean') return { valueType: 'boolean', formValue: value };
  if (isRecord(value) || Array.isArray(value)) return { valueType: 'json', formValue: JSON.stringify(value) };
  return { valueType: 'string', formValue: stringOrEmpty(value) };
}

function ensureOverrideConfigValue(value: unknown): SkillOverrideConfigValue {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return value;
  return String(value);
}

function overrideValueLabel(valueType: SkillOverrideValueType): string {
  if (valueType === 'expression') return '表达式路径';
  if (valueType === 'secret') return 'Secret 名称';
  return '覆盖值';
}

function overrideValueControl(valueType: SkillOverrideValueType) {
  if (valueType === 'number') {
    return <InputNumber className="full-width-control" placeholder="覆盖值" />;
  }
  if (valueType === 'boolean') {
    return (
      <Select
        aria-label="覆盖值"
        options={[
          { value: true, label: 'true' },
          { value: false, label: 'false' },
        ]}
      />
    );
  }
  if (valueType === 'json') {
    return <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} placeholder='{"temperature": 0.2}' />;
  }
  if (valueType === 'expression') {
    return <Input placeholder="row.temperature" />;
  }
  if (valueType === 'secret') {
    return <Input placeholder="LLM_API_KEY" />;
  }
  return <Input placeholder="覆盖值" />;
}

function stringOrEmpty(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    skillOverrides?: SkillOverrideConfig;
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
    && stableSignature(result.skill_overrides ?? {}) === stableSignature(current.skillOverrides ?? {})
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

function stableSignature(value: unknown): string {
  return JSON.stringify(sortForSignature(value));
}

function sortForSignature(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForSignature);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = sortForSignature(value[key]);
    return acc;
  }, {});
}
