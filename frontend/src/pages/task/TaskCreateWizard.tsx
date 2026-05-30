import { Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Typography } from 'antd';
import { useEffect, useMemo } from 'react';

import type { DatasetSummary, WorkflowVersion } from '../../types';

export type TaskCreateFormValues = {
  name: string;
  workflow_version_id: string;
  dataset_version_id: string;
  chunk_size?: number;
  concurrency?: number;
  sample_repeat_times?: number;
  max_retries?: number;
  retry_backoff_seconds?: number;
  cost_budget?: number;
};

type TaskCreateWizardProps = {
  open: boolean;
  loading: boolean;
  datasets: DatasetSummary[];
  workflows: WorkflowVersion[];
  onCancel: () => void;
  onSubmit: (values: TaskCreateFormValues) => void;
};

export function TaskCreateWizard({ open, loading, datasets, workflows, onCancel, onSubmit }: TaskCreateWizardProps) {
  const [form] = Form.useForm<TaskCreateFormValues>();
  const watchedWorkflow = Form.useWatch('workflow_version_id', form);
  const watchedDataset = Form.useWatch('dataset_version_id', form);
  const datasetVersions = useMemo(
    () => datasets.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))),
    [datasets],
  );

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
          key="create"
          type="primary"
          loading={loading}
          disabled={!watchedWorkflow || !watchedDataset}
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
          initialValues={{ chunk_size: 100, concurrency: 1, sample_repeat_times: 1, max_retries: 1, retry_backoff_seconds: 0 }}
          onFinish={onSubmit}
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
        </Form>
      </Space>
    </Modal>
  );
}
