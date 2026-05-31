import { CloudUploadOutlined, DatabaseOutlined, FieldStringOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Drawer, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { fieldPreview } from '../data/demo';
import type { DatasetVersion } from '../types';

type UploadFormValues = {
  name: string;
  label_field?: string;
  answer_field?: string;
  golden?: boolean;
};

type MaterializeFormValues = {
  name: string;
  rows: string;
  label_field?: string;
  golden?: boolean;
};

export function DatasetsPage() {
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [materializeOpen, setMaterializeOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [activeDataset, setActiveDataset] = useState<DatasetVersion | null>(null);
  const [lineageDataset, setLineageDataset] = useState<DatasetVersion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadForm] = Form.useForm<UploadFormValues>();
  const [materializeForm] = Form.useForm<MaterializeFormValues>();

  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  const lineageQuery = useQuery({
    queryKey: ['dataset-lineage', lineageDataset?.dataset_id, lineageDataset?.version],
    queryFn: () => api.datasetLineage(lineageDataset?.dataset_id ?? '', lineageDataset?.version ?? 0),
    enabled: Boolean(lineageDataset),
  });
  const latestVersions = useMemo(() => datasetsQuery.data?.flatMap((dataset) => dataset.versions.slice(-1)) ?? [], [datasetsQuery.data]);
  const previewDataset = activeDataset ?? latestVersions[0] ?? null;
  const previewRows = previewDataset
    ? Object.entries(previewDataset.field_schema).map(([field, type]) => ({
        key: field,
        path: `row.${field}`,
        type,
        example: String(previewDataset.preview[0]?.[field] ?? ''),
        target: field === previewDataset.label_field ? 'Golden label' : 'Workflow 输入映射',
      }))
    : fieldPreview.map((item) => ({ ...item, key: item.path }));

  const uploadMutation = useMutation({
    mutationFn: async (values: UploadFormValues) => {
      const selectedFile = getSelectedFile(uploadFile);
      if (!selectedFile) {
        throw new Error('请先选择 CSV 或 JSONL 文件');
      }
      const content = await readFileText(selectedFile);
      return api.uploadDataset({
        name: values.name,
        filename: selectedFile.name,
        content,
        golden: values.golden,
        label_field: values.label_field,
        answer_field: values.answer_field,
      });
    },
    onSuccess: async (dataset) => {
      setActiveDataset(dataset);
      setNotice(`上传成功：${dataset.name} v${dataset.version}，共 ${dataset.row_count} 行。`);
      setUploadOpen(false);
      setUploadFile(null);
      uploadForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    },
    onError: (error) => setNotice(`上传失败：${formatApiError(error)}`),
  });

  const materializeMutation = useMutation({
    mutationFn: (values: MaterializeFormValues) => {
      const rows = JSON.parse(values.rows) as Record<string, unknown>[];
      if (!Array.isArray(rows)) {
        throw new Error('Source rows 必须是数组');
      }
      return api.materializeSource({
        name: values.name,
        rows,
        golden: values.golden,
        label_field: values.label_field,
      });
    },
    onSuccess: async (dataset) => {
      setActiveDataset(dataset);
      setNotice(`物化成功：${dataset.name} v${dataset.version}，字段路径已生成。`);
      setMaterializeOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    },
    onError: (error) => setNotice(`物化失败：${formatApiError(error)}`),
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="数据准备"
        title="数据集"
        description="把 CSV/JSONL 或 Source Skill 输出固定成 Dataset Version，后续 Run 只引用 dataset_id、version 和 row_id。"
        primaryAction={<Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>上传 CSV / JSONL</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Alert
        type="info"
        showIcon
        message="字段路径是 Workflow 映射的起点"
        description="上传后先检查字段类型，再把 row.question、row.reference、row.expected_label 映射到下游 Skill 输入。Golden Dataset 需要明确 label_field。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card className="flat-card" title="上传数据">
            <Upload.Dragger
              beforeUpload={(file) => {
                setUploadFile(file);
                setUploadOpen(true);
                uploadForm.setFieldValue('name', file.name.replace(/\.(csv|jsonl)$/i, ''));
                return false;
              }}
              fileList={uploadFile ? [uploadFile] : []}
              onRemove={() => setUploadFile(null)}
              maxCount={1}
            >
              <p className="ant-upload-drag-icon"><DatabaseOutlined /></p>
              <p className="ant-upload-text">选择 CSV 或 JSONL 文件</p>
              <p className="ant-upload-hint">上传后会生成不可变 Dataset Version，并展示字段预览。</p>
            </Upload.Dragger>
            <Form layout="vertical" className="compact-form">
              <Form.Item label="当前数据集">
                <Select
                  placeholder="选择已上传数据集"
                  loading={datasetsQuery.isLoading}
                  value={previewDataset?.version_id}
                  onChange={(versionId) => setActiveDataset(latestVersions.find((item) => item.version_id === versionId) ?? null)}
                  options={latestVersions.map((dataset) => ({ value: dataset.version_id, label: `${dataset.name} v${dataset.version}` }))}
                />
              </Form.Item>
              <Space wrap>
                <Button type="primary" onClick={() => setUploadOpen(true)}>创建版本</Button>
                <Button onClick={() => setMaterializeOpen(true)}>Source Skill 物化</Button>
                <Button disabled={!previewDataset} onClick={() => setLineageDataset(previewDataset)}>查看 Lineage</Button>
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            className="flat-card"
            title="字段预览与类型修正"
            extra={
              <Tooltip title="字段类型错误会在 Workflow 发布或执行前触发 TYPE_MISMATCH。">
                <FieldStringOutlined />
              </Tooltip>
            }
          >
            <Table
              pagination={false}
              dataSource={previewRows}
              columns={[
                { title: '字段路径', dataIndex: 'path', render: (path) => <code>{path}</code> },
                { title: '类型', dataIndex: 'type', render: (type) => <Tag color="blue">{type}</Tag> },
                { title: '样例', dataIndex: 'example' },
                { title: '推荐映射', dataIndex: 'target' },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="上传数据集文件"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setUploadOpen(false)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            loading={uploadMutation.isPending}
            disabled={!uploadFile}
            onClick={() => uploadForm.submit()}
          >
            提交上传
          </Button>,
        ]}
      >
        <Form form={uploadForm} layout="vertical" onFinish={(values) => uploadMutation.mutate(values)}>
          <Upload.Dragger
            beforeUpload={(file) => {
              setUploadFile(file);
              uploadForm.setFieldValue('name', file.name.replace(/\.(csv|jsonl)$/i, ''));
              return false;
            }}
            fileList={uploadFile ? [uploadFile] : []}
            onRemove={() => setUploadFile(null)}
            maxCount={1}
          >
            <p className="ant-upload-text">拖入 CSV/JSONL，或点击选择文件</p>
          </Upload.Dragger>
          <Form.Item name="name" label="数据集名称" rules={[{ required: true, message: '请输入数据集名称' }]}>
            <Input placeholder="例如：rag_regression_2026_05" />
          </Form.Item>
          <Form.Item name="golden" valuePropName="checked">
            <Checkbox>标记为 Golden Dataset</Checkbox>
          </Form.Item>
          <Form.Item name="label_field" label="Golden 标签字段">
            <Input placeholder="expected_label" />
          </Form.Item>
          <Form.Item name="answer_field" label="答案字段">
            <Input placeholder="answer" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Source Skill 物化"
        open={materializeOpen}
        onCancel={() => setMaterializeOpen(false)}
        onOk={() => materializeForm.submit()}
        okText="提交物化"
        confirmLoading={materializeMutation.isPending}
      >
        <Form
          form={materializeForm}
          layout="vertical"
          initialValues={{
            name: 'source_materialized_dataset',
            rows: JSON.stringify([{ question: '示例问题', reference: '示例答案', expected_label: 'pass' }], null, 2),
            label_field: 'expected_label',
            golden: true,
          }}
          onFinish={(values) => materializeMutation.mutate(values)}
        >
          <Form.Item name="name" label="数据集名称" rules={[{ required: true, message: '请输入数据集名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="rows" label="Source rows JSON" rules={[{ required: true, message: '请输入 rows 数组' }]}>
            <Input.TextArea rows={8} />
          </Form.Item>
          <Form.Item name="golden" valuePropName="checked">
            <Checkbox>标记为 Golden Dataset</Checkbox>
          </Form.Item>
          <Form.Item name="label_field" label="Golden 标签字段">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title="数据血缘" width={720} open={Boolean(lineageDataset)} onClose={() => setLineageDataset(null)}>
        {lineageQuery.data ? (
          <Space direction="vertical" className="drawer-stack" size="large">
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Dataset">{lineageQuery.data.name}</Descriptions.Item>
              <Descriptions.Item label="版本">{lineageQuery.data.dataset_version_id}</Descriptions.Item>
              <Descriptions.Item label="来源类型"><Tag color="blue">{lineageQuery.data.source.type}</Tag></Descriptions.Item>
              {'filename' in lineageQuery.data.source.ref ? <Descriptions.Item label="文件名">{String(lineageQuery.data.source.ref.filename)}</Descriptions.Item> : null}
              <Descriptions.Item label="来源参数"><Typography.Text code>{JSON.stringify(lineageQuery.data.source.ref)}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label="样本数">{lineageQuery.data.row_count}</Descriptions.Item>
              <Descriptions.Item label="字段数">{lineageQuery.data.field_count}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title="字段路径">
              <Table
                size="small"
                rowKey="path"
                pagination={false}
                dataSource={Object.entries(lineageQuery.data.fields).map(([field, type]) => ({ field, path: `row.${field}`, type }))}
                columns={[
                  { title: '字段', dataIndex: 'field' },
                  { title: '路径', dataIndex: 'path', render: (value) => <code>{value}</code> },
                  { title: '类型', dataIndex: 'type', render: (value) => <Tag>{value}</Tag> },
                ]}
              />
            </Card>
            <Card size="small" title="下游任务">
              <Table
                size="small"
                rowKey="task_id"
                pagination={false}
                dataSource={lineageQuery.data.downstream_tasks}
                columns={[
                  { title: '任务', dataIndex: 'name' },
                  { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
                  { title: 'Workflow Version', dataIndex: 'workflow_version_id' },
                  { title: 'Run', dataIndex: 'run_id' },
                ]}
              />
            </Card>
          </Space>
        ) : (
          <Alert type="info" showIcon message={lineageQuery.isLoading ? '正在加载数据血缘。' : '请选择 Dataset Version 后查看血缘。'} />
        )}
      </Drawer>
    </section>
  );
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

function getSelectedFile(uploadFile: UploadFile | null): File | null {
  // Ant Design 在真实浏览器和测试环境中可能分别把文件放在 originFileObj 或对象本身；
  // 提交前统一归一化，避免“界面已选文件但提交认为未选择”的状态错位。
  return (uploadFile?.originFileObj ?? uploadFile ?? null) as File | null;
}
