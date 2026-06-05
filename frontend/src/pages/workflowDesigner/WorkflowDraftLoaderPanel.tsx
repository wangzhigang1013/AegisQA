import { InfoCircleOutlined } from '@ant-design/icons';
import { Card, Col, Input, InputNumber, Row, Select, Space, Table, Tooltip, Typography } from 'antd';

import type { DatasetVersion } from '../../types';

type WorkflowDraftOption = {
  draft_id: string;
  name: string;
};

type WorkflowVersionOption = {
  version_id: string;
  name: string;
  version: number;
};

type WorkflowTemplateOption = Record<string, unknown>;

type DatasetVersionOption = {
  dataset: unknown;
  version: DatasetVersion;
};

type DatasetFieldRow = {
  path: string;
  type: string;
  example: unknown;
};

type WorkflowDraftLoaderPanelProps = {
  workflowDrafts: WorkflowDraftOption[];
  workflowVersions: WorkflowVersionOption[];
  workflowTemplates: WorkflowTemplateOption[];
  datasetVersions: DatasetVersionOption[];
  selectedDatasetVersion: string | null;
  selectedDataset: DatasetVersion | null;
  sampleSize: number;
  workflowName: string;
  datasetFieldSearch: string;
  datasetFieldRows: DatasetFieldRow[];
  filteredDatasetFieldRows: DatasetFieldRow[];
  onLoadWorkflow: (value: string) => void;
  onDatasetVersionChange: (value: string) => void;
  onSampleSizeChange: (value: number) => void;
  onWorkflowNameChange: (value: string) => void;
  onDatasetFieldSearchChange: (value: string) => void;
};

export function WorkflowDraftLoaderPanel({
  workflowDrafts,
  workflowVersions,
  workflowTemplates,
  datasetVersions,
  selectedDatasetVersion,
  selectedDataset,
  sampleSize,
  workflowName,
  datasetFieldSearch,
  datasetFieldRows,
  filteredDatasetFieldRows,
  onLoadWorkflow,
  onDatasetVersionChange,
  onSampleSizeChange,
  onWorkflowNameChange,
  onDatasetFieldSearchChange,
}: WorkflowDraftLoaderPanelProps) {
  return (
    <Card className="flat-card" title="流程加载与数据集映射">
      <Row gutter={[12, 12]} align="middle">
        <Col xs={24} lg={8}>
          <Space size={4}>
            <Typography.Text type="secondary">加载已有流程</Typography.Text>
            <Tooltip title="用于把草稿、已发布版本或模板加载到当前画布。加载会替换当前未保存画布。">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
          <Select
            aria-label="加载已有流程"
            placeholder="选择草稿、已发布版本或模板"
            className="full-width-control"
            onChange={onLoadWorkflow}
            options={[
              ...workflowDrafts.map((draft) => ({ value: `draft:${draft.draft_id}`, label: `草稿：${draft.name}` })),
              ...workflowVersions.map((workflow) => ({ value: `workflow:${workflow.version_id}`, label: `已发布：${workflow.name} v${workflow.version}` })),
              ...workflowTemplates.map((template) => ({ value: `template:${String(template.template_id)}`, label: `模板：${String(template.name)}` })),
            ]}
          />
        </Col>
        <Col xs={24} lg={8}>
          <Space direction="vertical" size={0} className="full-width-control">
            <Typography.Text type="secondary">映射预览数据集 / 试运行数据集</Typography.Text>
            <Typography.Text type="secondary">选择后会驱动输入绑定候选、参数预览和试运行抽样。</Typography.Text>
          </Space>
          <Select
            aria-label="映射预览数据集 / 试运行数据集"
            showSearch
            optionFilterProp="label"
            placeholder="选择 Dataset Version"
            className="full-width-control"
            value={selectedDatasetVersion}
            onChange={onDatasetVersionChange}
            options={datasetVersions.map(({ version }) => ({ value: version.version_id, label: `${version.name} v${version.version}` }))}
          />
        </Col>
        <Col xs={12} lg={4}>
          <Typography.Text type="secondary">样本数</Typography.Text>
          <InputNumber className="full-width-control" min={1} max={10} value={sampleSize} onChange={(value) => onSampleSizeChange(value ?? 1)} />
        </Col>
        <Col xs={12} lg={4}>
          <Typography.Text type="secondary">流程名称</Typography.Text>
          <Input aria-label="流程名称" value={workflowName} onChange={(event) => onWorkflowNameChange(event.target.value)} />
        </Col>
      </Row>
      {selectedDataset ? (
        <Card size="small" className="flat-card" title="数据集字段预览">
          <Space direction="vertical" className="drawer-stack">
            <Space wrap>
              <Typography.Text type="secondary">
                共 {datasetFieldRows.length} 个字段，已开启搜索和分页；输入绑定里也会按关键词筛选候选路径。
              </Typography.Text>
              <Input
                allowClear
                placeholder="搜索字段路径、类型或示例值"
                value={datasetFieldSearch}
                onChange={(event) => onDatasetFieldSearchChange(event.target.value)}
                className="wide-search"
              />
            </Space>
            <Table
              size="small"
              pagination={filteredDatasetFieldRows.length > 8 ? { pageSize: 8, size: 'small', showSizeChanger: false } : false}
              rowKey="path"
              dataSource={filteredDatasetFieldRows}
              columns={[
                { title: '可用路径', dataIndex: 'path' },
                { title: '字段类型', dataIndex: 'type' },
                { title: '示例值', dataIndex: 'example', render: (value) => <Typography.Text>{String(value ?? '')}</Typography.Text> },
              ]}
            />
          </Space>
        </Card>
      ) : null}
    </Card>
  );
}
