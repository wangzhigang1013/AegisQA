import { Alert, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';

import type { DatasetSummary, TaskPreflightResult, WorkflowVersion } from '../../types';

export type TaskCreateFormValues = {
  name: string;
  workflow_version_id: string;
  dataset_version_id: string;
  allow_blocked_preflight?: boolean;
};

type TaskCreateWizardProps = {
  open: boolean;
  loading: boolean;
  preflightLoading: boolean;
  preflightResult?: TaskPreflightResult | null;
  datasets: DatasetSummary[];
  workflows: WorkflowVersion[];
  onCancel: () => void;
  onPreflight: (values: TaskCreateFormValues) => void;
  onSubmit: (values: TaskCreateFormValues) => void;
};

type DatasetVersionOption = {
  dataset: DatasetSummary;
  version: DatasetSummary['versions'][number];
};

export function TaskCreateWizard(props: TaskCreateWizardProps) {
  if (!props.open) {
    return null;
  }
  return <TaskCreateWizardContent {...props} />;
}

function TaskCreateWizardContent({ open, loading, preflightLoading, preflightResult, datasets, workflows, onCancel, onPreflight, onSubmit }: TaskCreateWizardProps) {
  const [form] = Form.useForm<TaskCreateFormValues>();
  const watchedWorkflow = Form.useWatch('workflow_version_id', form);
  const watchedDataset = Form.useWatch('dataset_version_id', form);
  const allowBlockedPreflight = Form.useWatch('allow_blocked_preflight', form);
  const datasetVersions = useMemo(
    () => datasets.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))),
    [datasets],
  );
  const workflowOptions = useMemo(() => sortWorkflowsForSelection(workflows), [workflows]);
  const selectedWorkflow = workflowOptions.find((workflow) => workflow.version_id === watchedWorkflow);
  const selectedDatasetVersion = datasetVersions.find((item) => item.version.version_id === watchedDataset)?.version;
  const requiredRowFields = useMemo(() => collectRequiredRowFields(selectedWorkflow), [selectedWorkflow]);
  const datasetFields = useMemo(() => collectDatasetFields(selectedDatasetVersion), [selectedDatasetVersion]);
  const missingFields = useMemo(
    () => requiredRowFields.filter((field) => !datasetFields.includes(field)),
    [datasetFields, requiredRowFields],
  );
  const preflightMatchesSelection = Boolean(
    preflightResult
      && selectedDatasetVersion
      && preflightResult.workflow_version_id === watchedWorkflow
      && preflightResult.dataset_id === selectedDatasetVersion.dataset_id
      && preflightResult.dataset_version === selectedDatasetVersion.version,
  );
  const preflightCanContinue = Boolean(
    preflightMatchesSelection
      && preflightResult
      && (preflightResult.status !== 'blocked' || allowBlockedPreflight),
  );
  const createDisabled = !watchedWorkflow || !watchedDataset || !preflightCanContinue;

  async function runPreflight() {
    try {
      await form.validateFields([['dataset_version_id'], ['workflow_version_id']], { recursive: true });
      onPreflight(form.getFieldsValue(true) as TaskCreateFormValues);
    } catch {
      // 表单会把缺失字段直接标在对应控件下，这里只阻止无效请求进入后端。
    }
  }

  return (
    <Modal
      title="创建任务"
      open={open}
      onCancel={onCancel}
      width={720}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="preflight"
          loading={preflightLoading}
          disabled={!watchedWorkflow || !watchedDataset}
          onClick={() => void runPreflight()}
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
          创建任务只固定一批数据和一个已发布 Workflow。Skill 的输入绑定、输出传递和运行参数都应在 Workflow 画布里配置并发布，任务创建阶段不再重复配置这些内容。
        </Typography.Text>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ allow_blocked_preflight: false }}
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
          <Form.Item name="dataset_version_id" label="Dataset Version" rules={[{ required: true, message: '请选择 Dataset' }]}>
            <Select
              aria-label="Dataset Version"
              showSearch
              optionFilterProp="label"
              placeholder="选择数据版本"
              options={datasetVersions.map(({ version }) => ({ value: version.version_id, label: datasetOptionLabel(version) }))}
            />
          </Form.Item>
          <Form.Item name="workflow_version_id" label="Workflow Version" rules={[{ required: true, message: '请选择 Workflow' }]}>
            <Select
              aria-label="Workflow Version"
              showSearch
              optionFilterProp="label"
              placeholder="选择已发布 Workflow"
              options={workflowOptions.map((workflow) => ({ value: workflow.version_id, label: workflowOptionLabel(workflow) }))}
            />
          </Form.Item>

          {selectedDatasetVersion ? (
            <Alert
              showIcon
              type="info"
              message="当前数据集字段"
              description={datasetFields.length ? `可用于 Workflow 输入绑定：${datasetFields.map((field) => `row.${field}`).join('、')}` : '当前数据集没有可识别字段。'}
            />
          ) : null}

          {selectedWorkflow ? (
            <Alert
              showIcon
              type={missingFields.length ? 'warning' : 'success'}
              message={missingFields.length ? 'Dataset 与 Workflow 字段不匹配' : 'Workflow 字段需求已匹配'}
              description={
                missingFields.length
                  ? `当前 Workflow 版本读取 ${requiredFieldsLabel(requiredRowFields)}，但当前数据集缺少 ${requiredFieldsLabel(missingFields)}。如果你没有使用这些字段，请回 Workflow 画布确认输入绑定并重新发布，或在这里选择正确的新版本。`
                  : `当前 Workflow 版本读取 ${requiredFieldsLabel(requiredRowFields)}。创建任务不会新增 question/reference 等默认字段，只按这个已发布版本的实际输入绑定预检。`
              }
            />
          ) : null}

          {watchedWorkflow && watchedDataset && !preflightResult ? (
            <Alert
              showIcon
              type="info"
              message="请先运行 Preflight"
              description="Preflight 会用当前 Dataset Version 和 Workflow Version 检查字段、Skill 审批状态和基础运行条件。"
            />
          ) : null}
          {preflightResult && !preflightMatchesSelection ? (
            <Alert
              showIcon
              type="warning"
              message="Preflight 结果已过期"
              description="Dataset 或 Workflow 已变化，请重新运行 Preflight。"
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

function sortWorkflowsForSelection(workflows: WorkflowVersion[]): WorkflowVersion[] {
  return [...workflows].sort((left, right) => {
    if (right.version !== left.version) return right.version - left.version;
    return right.name.localeCompare(left.name, 'zh-CN');
  });
}

function datasetOptionLabel(version: DatasetVersionOption['version']): string {
  return `${version.name} v${version.version} / ${version.row_count} 条`;
}

function workflowOptionLabel(workflow: WorkflowVersion): string {
  const fields = collectRequiredRowFields(workflow);
  return `${workflow.name} v${workflow.version} / ${fields.length ? `需要 ${fields.map((field) => `row.${field}`).join(', ')}` : '不读取 row 字段'}`;
}

function collectRequiredRowFields(workflow?: WorkflowVersion): string[] {
  if (!workflow) return [];
  const fields = new Set<string>();
  workflow.steps?.forEach((step) => {
    Object.values(step.input_mapping ?? {}).forEach((source) => addRowField(fields, source));
  });
  workflow.graph?.nodes?.forEach((node) => {
    Object.values(node.input_mapping ?? {}).forEach((source) => addRowField(fields, source));
  });
  return [...fields].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function collectDatasetFields(version?: DatasetVersionOption['version']): string[] {
  if (!version) return [];
  const fields = new Set<string>();
  Object.keys(version.field_schema ?? {}).forEach((field) => {
    if (field) fields.add(field);
  });
  (version.field_paths ?? []).forEach((path) => addRowField(fields, path));
  return [...fields].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function addRowField(fields: Set<string>, source: unknown) {
  if (typeof source !== 'string') return;
  const trimmed = source.trim();
  if (!trimmed.startsWith('row.')) return;
  const field = trimmed.replace(/^row\./, '').split('.')[0];
  if (field) fields.add(field);
}

function requiredFieldsLabel(fields: string[]): string {
  if (!fields.length) return '无 row 字段';
  return fields.map((field) => `row.${field}`).join('、');
}
