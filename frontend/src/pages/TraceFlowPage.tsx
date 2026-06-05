import { ApartmentOutlined, ArrowLeftOutlined, BranchesOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Empty, List, Row, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { workbenchActionId, workbenchActionTargetUrl } from '../actions/actionRouter';
import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';

export function TraceFlowPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tracePage, setTracePage] = useState(1);
  const tracePageSize = 8;
  const traceQuery = useQuery({
    queryKey: ['task-trace-flow', taskId, tracePage, tracePageSize],
    queryFn: () => api.taskTraceFlow(taskId ?? '', { page: tracePage, pageSize: tracePageSize }),
    enabled: Boolean(taskId),
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const traceFlow = traceQuery.data;
  const returnTaskId = searchParams.get('return_task_id') || taskId;
  const selectedItem = useMemo(() => {
    if (!traceFlow?.items.length) return null;
    return traceFlow.items.find((item) => item.item_id === selectedItemId) ?? traceFlow.items[0];
  }, [selectedItemId, traceFlow?.items]);

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="样本级数据流"
        title="Trace Flow"
        description="查看一条样本如何从 Dataset Row 进入 Skill 输入、解析参数、产生输出与指标，并最终形成 Badcase。"
        primaryAction={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(returnTaskId ? `/runs?task_id=${encodeURIComponent(returnTaskId)}` : '/runs')}>
            返回任务详情
          </Button>
        }
      />

      {traceQuery.isError ? <Alert type="error" showIcon message="Trace Flow 加载失败" /> : null}

      {traceFlow ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8}>
              <Card className="flat-card" title="数据集">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="名称">{traceFlow.dataset.name}</Descriptions.Item>
                  <Descriptions.Item label="版本">{traceFlow.dataset.version_id}</Descriptions.Item>
                  <Descriptions.Item label="队列消息">{traceFlow.queue_message_shape.join(', ')}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card className="flat-card" title="Workflow">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="名称">{traceFlow.workflow.name}</Descriptions.Item>
                  <Descriptions.Item label="版本">{traceFlow.workflow.version_id}</Descriptions.Item>
                  <Descriptions.Item label="Hash">{traceFlow.workflow.snapshot_hash.slice(0, 12)}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card className="flat-card" title="执行批次">
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Run">{traceFlow.attempt.run_id}</Descriptions.Item>
                  <Descriptions.Item label="状态"><Tag>{traceFlow.attempt.status}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Attempt">{traceFlow.attempt.current_attempt}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={7}>
              <Card className="flat-card" title="样本列表">
                <List
                  loading={traceQuery.isLoading}
                  dataSource={traceFlow.items}
                  pagination={{
                    current: traceFlow.pagination?.page ?? tracePage,
                    pageSize: traceFlow.pagination?.page_size ?? tracePageSize,
                    total: traceFlow.pagination?.total_items ?? traceFlow.items.length,
                    showSizeChanger: false,
                    onChange: (page) => {
                      // 翻页后当前样本明细可能已不在新页，清空选择让页面回到新页第一条。
                      setSelectedItemId(null);
                      setTracePage(page);
                    },
                  }}
                  renderItem={(item) => (
                    <List.Item className={item.item_id === selectedItem?.item_id ? 'selected-list-row' : ''} onClick={() => setSelectedItemId(item.item_id)}>
                      <List.Item.Meta
                        title={<Space><span>{item.item_id}</span><Tag color={item.badcase.is_badcase ? 'red' : 'green'}>{item.status}</Tag></Space>}
                        description={`row=${item.row_id} / repeat=${item.repeat_index}`}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} lg={17}>
              {selectedItem ? (
                <Card className="flat-card" title={`样本数据流：${selectedItem.item_id}`}>
                  <Timeline
                    items={[
                      { dot: <DatabaseOutlined />, color: 'blue', children: `Dataset Row -> ${Object.keys(selectedItem.row).join(', ') || '空 row'}` },
                      ...selectedItem.steps.map((step) => ({
                        dot: <BranchesOutlined />,
                        color: step.status === 'succeeded' ? 'green' : 'red',
                        children: `${step.step_id} / ${step.skill_ref} / ${Math.round(step.latency_ms)}ms`,
                      })),
                      { dot: <ApartmentOutlined />, color: selectedItem.badcase.is_badcase ? 'red' : 'green', children: selectedItem.badcase.is_badcase ? `Badcase：${selectedItem.badcase.reason}` : '未形成 Badcase' },
                    ]}
                  />
                  <Tabs
                    items={[
                      { key: 'row', label: 'Row', children: <JsonBlock value={selectedItem.row} /> },
                      { key: 'context', label: 'Context', children: <JsonBlock value={selectedItem.context} /> },
                      { key: 'metrics', label: 'Metrics', children: <JsonBlock value={selectedItem.metrics} /> },
                      {
                        key: 'steps',
                        label: 'Steps',
                        children: (
                          <Space direction="vertical" className="full-width-control">
                            {selectedItem.steps.map((step) => (
                              <Card
                                size="small"
                                key={step.step_id}
                                title={`${step.step_id} / ${step.skill_ref}`}
                                extra={<Tag color={stepStatusColor(step.status)}>{step.status}</Tag>}
                              >
                                <Space direction="vertical" className="full-width-control">
                                  <Space wrap>
                                    <Typography.Text type="secondary">诊断标签</Typography.Text>
                                    {step.diagnostic_tags?.length ? (
                                      step.diagnostic_tags.map((tag) => <Tag key={tag}>{tag}</Tag>)
                                    ) : (
                                      <Tag>none</Tag>
                                    )}
                                  </Space>
                                  {step.error_explanation ? (
                                    <Alert
                                      type={step.status === 'succeeded' ? 'info' : 'error'}
                                      showIcon
                                      message={step.error_explanation.code}
                                      description={step.error_explanation.message}
                                    />
                                  ) : null}
                                  {step.available_actions?.length ? (
                                    <Space wrap>
                                      {step.available_actions.map((action) => (
                                        <Button key={workbenchActionId(action)} size="small" href={workbenchActionTargetUrl(action) ?? undefined} disabled={action.enabled === false || action.disabled}>
                                          {action.label}
                                        </Button>
                                      ))}
                                    </Space>
                                  ) : null}
                                  <Tabs
                                    size="small"
                                    items={[
                                      { key: 'resolved_input', label: 'Resolved Input', children: <JsonBlock value={step.resolved_input ?? step.input} /> },
                                      { key: 'raw_output', label: 'Raw Output', children: <JsonBlock value={step.raw_output ?? step.output} /> },
                                      { key: 'validated_output', label: 'Validated Output', children: <JsonBlock value={step.validated_output ?? step.output} /> },
                                      { key: 'schema_errors', label: 'Schema Errors', children: <JsonBlock value={step.schema_errors ?? []} /> },
                                      { key: 'prompt_calls', label: 'Prompt Calls', children: <JsonBlock value={step.prompt_calls ?? []} /> },
                                      { key: 'input', label: 'Input', children: <JsonBlock value={step.input} /> },
                                      { key: 'params', label: '参数', children: <JsonBlock value={{ resolved_config: step.resolved_config, parameter_trace: step.parameter_trace }} /> },
                                      { key: 'output', label: 'Output', children: <JsonBlock value={step.output} /> },
                                      { key: 'error', label: 'Error', children: <JsonBlock value={step.error ?? {}} /> },
                                    ]}
                                  />
                                </Space>
                              </Card>
                            ))}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Card>
              ) : (
                <Empty description="暂无样本 Trace。请先执行任务。" />
              )}
            </Col>
          </Row>
        </>
      ) : (
        <Empty description="正在等待 Trace Flow 数据。" />
      )}
    </section>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <Typography.Text>
      <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
    </Typography.Text>
  );
}

function stepStatusColor(status: string): string {
  if (['succeeded', 'passed'].includes(status)) return 'green';
  if (['failed', 'schema_invalid', 'timeout'].includes(status)) return 'red';
  if (['running', 'queued', 'pending'].includes(status)) return 'blue';
  if (status === 'skipped') return 'default';
  return 'orange';
}
