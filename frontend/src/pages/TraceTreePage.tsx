import { ArrowLeftOutlined, BranchesOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';

export function TraceTreePage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tracePage, setTracePage] = useState(1);
  const tracePageSize = 8;
  const traceQuery = useQuery({
    queryKey: ['task-trace-tree', taskId, tracePage, tracePageSize],
    queryFn: () => api.taskTraceTree(taskId ?? '', { page: tracePage, pageSize: tracePageSize }),
    enabled: Boolean(taskId),
  });
  const traceTree = traceQuery.data;
  const returnTaskId = searchParams.get('return_task_id') || taskId;

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="调用树"
        title="Trace Tree"
        description="按 Item 展开 Skill Step 调用树，查看每一步的输入、输出、耗时、错误和缓存命中。"
        primaryAction={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(returnTaskId ? `/runs?task_id=${encodeURIComponent(returnTaskId)}` : '/runs')}>
            返回任务详情
          </Button>
        }
      />

      {traceQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="Trace Tree 加载失败，请确认任务已经执行并生成 Run。"
          description={formatApiError(traceQuery.error)}
        />
      ) : null}

      {traceTree ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8}>
              <Card className="flat-card" title="Run">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Run ID">{traceTree.run_id}</Descriptions.Item>
                  <Descriptions.Item label="状态"><Tag>{traceTree.status}</Tag></Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card className="flat-card" title="Workflow">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="版本">{traceTree.workflow_version}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card className="flat-card" title="Dataset">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="版本">{traceTree.dataset_version ?? '-'}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>

          <Card className="flat-card" title="Item 调用树">
            <Table
              rowKey="item_id"
              loading={traceQuery.isLoading}
              dataSource={traceTree.items.map(({ children, ...item }) => ({ ...item, step_nodes: children }))}
              pagination={{
                current: traceTree.pagination?.page ?? tracePage,
                pageSize: traceTree.pagination?.page_size ?? tracePageSize,
                total: traceTree.pagination?.total_items ?? traceTree.items.length,
                showSizeChanger: false,
                onChange: setTracePage,
              }}
              expandable={{
                defaultExpandAllRows: false,
                expandedRowRender: (item) => <StepTable steps={(item.step_nodes as Record<string, unknown>[]) ?? []} />,
              }}
              columns={[
                { title: 'Item', dataIndex: 'item_id' },
                { title: 'Row', dataIndex: 'row_id' },
                { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
                { title: 'Metrics', dataIndex: 'metrics', render: (value) => <JsonPreview value={value} /> },
              ]}
            />
          </Card>
        </>
      ) : (
        <Empty description="暂无 Trace Tree。请先在执行中心执行任务。" />
      )}
    </section>
  );
}

function StepTable({ steps }: { steps: Record<string, unknown>[] }) {
  return (
    <Space direction="vertical" className="full-width-control">
      {steps.length ? steps.map((step) => (
        <Card size="small" key={String(step.step_id)} title={<Space><Typography.Text strong>{String(step.step_id)}</Typography.Text><Tag>{String(step.status)}</Tag></Space>}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="Skill">{String(step.skill_ref)}</Descriptions.Item>
            <Descriptions.Item label="耗时">{Math.round(Number(step.latency_ms ?? 0))} ms</Descriptions.Item>
            <Descriptions.Item label="缓存">{step.cache_hit ? <Tag color="green">hit</Tag> : <Tag>miss</Tag>}</Descriptions.Item>
            <Descriptions.Item label="输入"><JsonPreview value={step.input} /></Descriptions.Item>
            <Descriptions.Item label="输出"><JsonPreview value={step.output} /></Descriptions.Item>
          </Descriptions>
        </Card>
      )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该 Item 暂无 Step 调用。" />}
    </Space>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <Typography.Text className="json-inline-preview">
      <BranchesOutlined /> {JSON.stringify(value ?? {})}
    </Typography.Text>
  );
}
