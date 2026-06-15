import { CloudUploadOutlined, DatabaseOutlined, FieldStringOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Drawer, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, formatApiError } from '../api/client';
import { PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import type { DatasetQualityDiagnosis, DatasetVersion } from '../types';

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
  const [searchParams] = useSearchParams();

  const datasetsQuery = useQuery({ queryKey: ['datasets'], queryFn: api.datasets });
  const lineageQuery = useQuery({
    queryKey: ['dataset-lineage', lineageDataset?.dataset_id, lineageDataset?.version],
    queryFn: () => api.datasetLineage(lineageDataset?.dataset_id ?? '', lineageDataset?.version ?? 0),
    enabled: Boolean(lineageDataset),
  });
  const datasetVersions = useMemo(() => datasetsQuery.data?.flatMap((dataset) => dataset.versions) ?? [], [datasetsQuery.data]);

  useEffect(() => {
    const targetDatasetId = searchParams.get('dataset_id');
    const targetVersion = Number(searchParams.get('version') ?? 0);
    if (!targetDatasetId || !targetVersion) return;
    const matched = datasetVersions.find((dataset) => dataset.dataset_id === targetDatasetId && dataset.version === targetVersion);
    if (matched && activeDataset?.version_id !== matched.version_id) {
      setActiveDataset(matched);
    }
  }, [activeDataset?.version_id, datasetVersions, searchParams]);

  const previewDataset = activeDataset ?? datasetVersions[0] ?? null;
  const qualityQuery = useQuery({
    queryKey: ['dataset-quality', previewDataset?.dataset_id, previewDataset?.version],
    queryFn: () => api.datasetQuality(previewDataset?.dataset_id ?? '', previewDataset?.version ?? 0),
    enabled: Boolean(previewDataset),
  });
  const previewRows = previewDataset
    ? Object.entries(previewDataset.field_schema).map(([field, type]) => ({
        key: field,
        path: `row.${field}`,
        type,
        example: String(previewDataset.preview[0]?.[field] ?? ''),
        target: field === previewDataset.label_field ? 'Golden label' : 'Workflow 输入映射',
      }))
    : [];
  const fieldMappingDescription = previewRows.length
    ? `当前 Dataset Version 可映射字段：${previewRows.map((row) => row.path).join('、')}。Golden Dataset 需要明确 label_field。`
    : '上传或物化后会生成字段路径，格式为 row.<字段名>；创建任务前请确认字段类型和 Golden 标签字段。';

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

  const repairVersionMutation = useMutation({
    mutationFn: () => {
      if (!previewDataset) {
        throw new Error('请选择需要修复的数据集版本。');
      }
      return api.repairDatasetVersion(previewDataset.dataset_id, previewDataset.version, {
        drop_duplicate_rows: true,
        fill_missing: buildDefaultMissingValues(qualityQuery.data),
        reason: '根据字段治理诊断生成修复版 Dataset Version。',
      });
    },
    onSuccess: async (dataset) => {
      setActiveDataset(dataset);
      setNotice(`已生成修复版 Dataset Version：${dataset.version_id}，共 ${dataset.row_count} 行。`);
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
      await queryClient.invalidateQueries({ queryKey: ['dataset-quality'] });
    },
    onError: (error) => setNotice(`生成修复版失败：${formatApiError(error)}`),
  });

  return (
    <section className="page-stack">


      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Alert
        type="info"
        showIcon
        message="字段路径是 Workflow 映射的起点"
        description={fieldMappingDescription}
        className="mb-4"
      />

      <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-slate-900 rounded-3xl shadow-2xl p-6 mb-8 mt-2 relative overflow-hidden">
        {/* 背景光晕 (与全局 PageHeader 一致) */}
        <div className="absolute -top-32 -right-32 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-slate-500/20 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row gap-8">
          <div className="w-full lg:w-1/3 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-4 mb-4">
                <div className="p-4 bg-slate-700/50 rounded-2xl text-slate-400 shadow-inner border border-slate-600/50">
                  <DatabaseOutlined className="text-3xl" />
                </div>
                <div>
                  <Typography.Title level={4} className="m-0 text-white font-bold tracking-wide">数据中心</Typography.Title>
                  <Typography.Text className="text-slate-400 text-sm">构建与管理评测集</Typography.Text>
                </div>
              </div>
              <p className="text-slate-300 text-sm leading-relaxed mb-6 font-medium">
                上传 CSV / JSONL 数据文件，生成具有严格类型校验的不可变 Dataset Version，为 Workflow 执行提供基准测试数据。
              </p>
            </div>
            
            <Form layout="vertical" className="compact-form w-full">
              <Form.Item label={<span className="font-semibold text-white">活跃数据版本</span>} className="mb-2">
                <Select
                  placeholder="选择已上传数据集"
                  size="large"
                  loading={datasetsQuery.isLoading}
                  value={previewDataset?.version_id}
                  onChange={(versionId) => setActiveDataset(datasetVersions.find((item) => item.version_id === versionId) ?? null)}
                  options={datasetVersions.map((dataset) => ({ value: dataset.version_id, label: `${dataset.name} v${dataset.version}` }))}
                  className="w-full"
                />
              </Form.Item>
              <div className="flex flex-wrap gap-3 mt-5">
                <Button type="primary" shape="round" className="bg-blue-600 shadow-lg shadow-blue-500/30 border-none hover:bg-blue-500" onClick={() => setUploadOpen(true)}>创建新版本</Button>
                <Button shape="round" className="bg-slate-700/50 border-slate-600/50 text-slate-300 hover:bg-slate-600/50 hover:border-slate-500/50 hover:text-white" onClick={() => setMaterializeOpen(true)}>虚拟物化</Button>
                <Button shape="round" className="bg-transparent border-slate-600/50 text-slate-300 hover:text-white" disabled={!previewDataset} onClick={() => setLineageDataset(previewDataset)}>查看血缘</Button>
              </div>
            </Form>
          </div>

          <div className="w-full lg:w-2/3">
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
              className="bg-slate-900/30 backdrop-blur-sm border-2 border-dashed border-slate-600/50 hover:border-blue-500/50 transition-all rounded-3xl h-full py-10"
            >
              <p className="ant-upload-drag-icon text-blue-400/80 mb-4">
                <CloudUploadOutlined className="text-5xl" />
              </p>
              <p className="text-white font-semibold text-lg mb-2">拖拽 CSV 或 JSONL 文件至此</p>
              <p className="text-slate-400 text-sm">上传后自动生成字段预览并检测数据质量</p>
            </Upload.Dragger>
          </div>
        </div>
      </div>

      <Row gutter={[24, 24]} className="mb-8">
        <Col xs={24} xl={10}>
          <div className="bg-white rounded-3xl shadow-[0_4px_24px_-6px_rgba(0,0,0,0.04)] p-8 h-full flex flex-col border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <div>
                <Typography.Title level={5} className="text-slate-800 m-0 font-bold">字段预览</Typography.Title>
                <Typography.Text type="secondary" className="text-xs">检查字段映射与类型推断</Typography.Text>
              </div>
              <Tooltip title="字段类型错误会在 Workflow 发布或执行前触发 TYPE_MISMATCH。">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 transition-colors cursor-pointer shadow-sm">
                  <FieldStringOutlined className="text-lg" />
                </div>
              </Tooltip>
            </div>
            
            <div className="flex-1 bg-slate-50/50 rounded-2xl border border-slate-100 overflow-hidden">
              <Table
                size="middle"
                pagination={false}
                dataSource={previewRows}
                locale={{ emptyText: '暂无数据集。请先在上方数据中心上传文件或选择版本。' }}
                columns={[
                  { title: '字段路径', dataIndex: 'path', render: (path) => <code className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-xs font-mono border border-slate-200">{path}</code> },
                  { title: '推断类型', dataIndex: 'type', render: (type) => <Tag color="blue" className="rounded-full px-2 py-0.5 font-medium border-transparent">{type}</Tag> },
                  { title: '示例数据', dataIndex: 'example', render: (text) => <span className="text-slate-600 text-sm truncate max-w-[120px] block" title={text}>{text}</span> },
                ]}
              />
            </div>
          </div>
        </Col>
        
        <Col xs={24} xl={14}>
          <div className="bg-white rounded-3xl shadow-[0_4px_24px_-6px_rgba(0,0,0,0.04)] p-8 h-full flex flex-col border border-slate-100">
            <div className="flex justify-between items-start mb-6">
              <div>
                <Typography.Title level={5} className="text-slate-800 m-0 font-bold">数据质量诊断</Typography.Title>
                <Typography.Text type="secondary" className="text-xs">缺失值与重复样本分析</Typography.Text>
              </div>
              <Button
                type="primary"
                shape="round"
                className="bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20 border-none"
                disabled={!previewDataset || !qualityQuery.data}
                loading={repairVersionMutation.isPending}
                onClick={() => repairVersionMutation.mutate()}
              >
                生成修复版
              </Button>
            </div>
            
            <div className="flex-1">
              {previewDataset ? (
                <Space direction="vertical" className="w-full" size="middle">
                  {qualityQuery.isError ? <Alert type="error" showIcon message="诊断加载失败" /> : null}
                  {qualityQuery.data ? (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-2">
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
                          <div className="text-xs text-slate-500 mb-1 font-medium">总样本数</div>
                          <div className="text-2xl font-bold text-slate-800">{qualityQuery.data.summary.row_count}</div>
                        </div>
                        <div className="bg-orange-50/50 p-4 rounded-2xl border border-orange-100 text-center">
                          <div className="text-xs text-orange-600/70 mb-1 font-medium">缺失字段</div>
                          <div className="text-2xl font-bold text-orange-600">{qualityQuery.data.summary.fields_with_missing}</div>
                        </div>
                        <div className="bg-red-50/50 p-4 rounded-2xl border border-red-100 text-center">
                          <div className="text-xs text-red-600/70 mb-1 font-medium">重复样本</div>
                          <div className="text-2xl font-bold text-red-600">{qualityQuery.data.summary.duplicate_row_count}</div>
                        </div>
                      </div>
                      
                      <div className="bg-slate-50/50 rounded-2xl border border-slate-100 overflow-hidden">
                        <Table
                          size="small"
                          rowKey="field"
                          loading={qualityQuery.isLoading}
                          dataSource={qualityQuery.data.fields}
                          pagination={qualityQuery.data.fields.length > 5 ? { pageSize: 5, size: 'small' } : false}
                          columns={[
                            { title: '诊断字段', dataIndex: 'path', render: (value) => <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-700">{value}</code> },
                            { title: '覆盖率', dataIndex: 'coverage_rate', width: 100, render: (value) => <span className={`font-semibold ${Number(value) < 1 ? 'text-orange-500' : 'text-emerald-500'}`}>{formatPercent(Number(value))}</span> },
                            { title: '缺失行', dataIndex: 'missing_count', width: 80, render: (value) => <span className={Number(value) > 0 ? 'text-red-500 font-medium' : 'text-slate-400'}>{value}</span> },
                            { title: '治理建议', dataIndex: 'recommendation', render: (recommendation: DatasetQualityDiagnosis['fields'][number]['recommendation']) => (
                                <span className={`text-xs ${recommendation.action === 'none' ? 'text-slate-400' : 'text-orange-600 font-medium bg-orange-50 px-2 py-1 rounded-md'}`}>{recommendation.message}</span>
                            )},
                          ]}
                        />
                      </div>
                    </>
                  ) : (
                    <Alert type="info" showIcon message={qualityQuery.isLoading ? '正在扫描数据集缺失率和重复率...' : '选择数据集版本查看质量诊断'} className="rounded-xl border-slate-200 bg-slate-50 text-slate-600" />
                  )}
                </Space>
              ) : (
                <div className="h-48 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50">
                  <Typography.Text type="secondary" className="font-medium">请在上方数据中心挂载数据集版本</Typography.Text>
                </div>
              )}
            </div>
          </div>
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

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
}

function buildDefaultMissingValues(quality?: DatasetQualityDiagnosis): Record<string, unknown> {
  if (!quality) return {};
  return Object.fromEntries(
    quality.fields
      .filter((field) => field.missing_count > 0 && field.recommendation.action === 'fill_missing')
      .map((field) => [field.field, field.recommendation.default_value ?? defaultMissingValue(field.type)]),
  );
}

function defaultMissingValue(fieldType: string): unknown {
  if (fieldType === 'number') return 0;
  if (fieldType === 'boolean') return false;
  if (fieldType === 'json') return {};
  return '待补充';
}
