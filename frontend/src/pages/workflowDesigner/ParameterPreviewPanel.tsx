import { PlayCircleOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Select, Space, Table, Tag, Typography } from 'antd';

import { api } from '../../api/client';
import type { DatasetSummary, DatasetVersion, WorkflowGraph, WorkflowParameterPreview } from '../../types';

type DatasetVersionOption = {
  dataset: DatasetSummary;
  version: DatasetVersion;
};

type ParameterPreviewPanelProps = {
  graph: WorkflowGraph;
  datasetVersions: DatasetVersionOption[];
  selectedDatasetVersion: string | null;
  onDatasetVersionChange: (versionId: string) => void;
};

export function ParameterPreviewPanel({ graph, datasetVersions, selectedDatasetVersion, onDatasetVersionChange }: ParameterPreviewPanelProps) {
  const selectedDataset = datasetVersions.find((item) => item.version.version_id === selectedDatasetVersion)?.version ?? null;
  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedDataset) {
        throw new Error('请先选择一个数据集版本，再预览参数。');
      }
      return api.previewWorkflowParameters({
        graph,
        sample_row: selectedDataset.preview[0] ?? {},
        task_overrides: {},
      });
    },
  });
  const preview = previewMutation.data;

  return (
    <Space direction="vertical" className="drawer-stack">
      <Alert
        type="info"
        showIcon
        message="参数预览会冻结一次样本执行时的 Skill 配置"
        description="这里展示 default、workflow_config、task_override、expression 和 secret_ref 的最终覆盖结果，方便发布前确认参数没有被隐式改写。"
      />
      <div>
        <Typography.Text type="secondary">选择参数预览数据集</Typography.Text>
        <Select
          aria-label="选择参数预览数据集"
          showSearch
          optionFilterProp="label"
          placeholder="选择 Dataset Version"
          className="full-width-control"
          value={selectedDatasetVersion}
          onChange={onDatasetVersionChange}
          options={datasetVersions.map(({ version }) => ({ value: version.version_id, label: `${version.name} v${version.version}` }))}
        />
      </div>
      <Button type="primary" icon={<PlayCircleOutlined />} loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
        预览参数
      </Button>
      {previewMutation.error ? <Alert type="error" showIcon message={previewMutation.error instanceof Error ? previewMutation.error.message : '参数预览失败'} /> : null}
      {preview ? <ParameterPreviewResult preview={preview} /> : <Typography.Text type="secondary">选择数据集后点击预览参数，系统会调用后端解析当前画布中的 Skill 参数。</Typography.Text>}
    </Space>
  );
}

function ParameterPreviewResult({ preview }: { preview: WorkflowParameterPreview }) {
  const traceRows = preview.nodes.flatMap((node) =>
    Object.entries(node.parameter_trace ?? {}).map(([name, trace]) => ({
      key: `${node.node_id}:${name}`,
      node_id: node.node_id,
      skill_ref: node.skill_ref,
      name,
      source: trace.source,
      value_preview: formatValue(trace.value_preview),
      redacted: trace.redacted,
      expression_path: trace.expression_path,
      secret_ref: trace.secret_ref,
    })),
  );

  return (
    <Space direction="vertical" className="drawer-stack">
      <Typography.Text strong>{preview.workflow_name}</Typography.Text>
      <Table
        rowKey="node_id"
        size="small"
        pagination={false}
        dataSource={preview.nodes}
        columns={[
          { title: '节点', dataIndex: 'node_id' },
          { title: 'Skill', dataIndex: 'skill_ref' },
          {
            title: '解析后配置',
            dataIndex: 'resolved_config',
            render: (value) => <Typography.Text code>{formatValue(value)}</Typography.Text>,
          },
        ]}
      />
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={traceRows}
        columns={[
          { title: '节点', dataIndex: 'node_id' },
          { title: '参数', dataIndex: 'name' },
          { title: '来源', dataIndex: 'source', render: (source) => <Tag color={source === 'workflow_config' ? 'blue' : 'default'}>{source}</Tag> },
          { title: '值', dataIndex: 'value_preview' },
          { title: '表达式', dataIndex: 'expression_path', render: (value) => value || '-' },
          { title: 'Secret', dataIndex: 'secret_ref', render: (value, row) => (row.redacted ? value || '已脱敏' : value || '-') },
        ]}
      />
    </Space>
  );
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
