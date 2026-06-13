import { ApartmentOutlined, ArrowLeftOutlined, BranchesOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Drawer, Empty, List, Row, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { workbenchActionId, workbenchActionTargetUrl } from '../actions/actionRouter';
import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { TaskTraceFlow, WorkbenchAction } from '../types';

type TraceItem = TaskTraceFlow['items'][number];
type TraceStep = TraceItem['steps'][number];
type StepDebugMode = 'detail' | 'replay' | 'prompt_debug' | 'repro_bundle';

type StepDebugState = {
  item: TraceItem;
  step: TraceStep;
  mode: StepDebugMode;
  loading: boolean;
  result: Record<string, unknown> | null;
  error: string | null;
};

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
  const [stepDebug, setStepDebug] = useState<StepDebugState | null>(null);

  const openStepDebug = async (item: TraceItem, step: TraceStep, mode: StepDebugMode) => {
    const baseState: StepDebugState = { item, step, mode, loading: mode !== 'detail', result: null, error: null };
    setStepDebug(baseState);
    if (mode === 'detail') {
      return;
    }
    const runId = traceFlow?.attempt.run_id;
    if (!runId) {
      setStepDebug({ ...baseState, loading: false, error: '当前 Trace Flow 缺少 run_id，无法调用 Step 调试接口。' });
      return;
    }
    try {
      const result = await loadStepDebugResult(mode, runId, item.item_id, step.step_id);
      setStepDebug({ ...baseState, loading: false, result });
    } catch (error) {
      setStepDebug({ ...baseState, loading: false, error: formatApiError(error) });
    }
  };

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

      {traceQuery.isError ? <Alert type="error" showIcon message="Trace Flow 加载失败" description={formatApiError(traceQuery.error)} /> : null}

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
                                        <StepActionButton
                                          key={workbenchActionId(action)}
                                          action={action}
                                          item={selectedItem}
                                          step={step}
                                          onOpenDebug={openStepDebug}
                                        />
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
      <StepDebugDrawer
        state={stepDebug}
        onClose={() => setStepDebug(null)}
        onRun={(mode) => {
          if (stepDebug) {
            void openStepDebug(stepDebug.item, stepDebug.step, mode);
          }
        }}
      />
    </section>
  );
}

function StepActionButton({
  action,
  item,
  step,
  onOpenDebug,
}: {
  action: WorkbenchAction;
  item: TraceItem;
  step: TraceStep;
  onOpenDebug: (item: TraceItem, step: TraceStep, mode: StepDebugMode) => void;
}) {
  const actionId = workbenchActionId(action);
  const mode = stepDebugModeFromAction(actionId);
  if (mode) {
    return (
      <Button size="small" disabled={action.enabled === false || action.disabled} onClick={() => onOpenDebug(item, step, mode)}>
        {action.label}
      </Button>
    );
  }
  const targetUrl = workbenchActionTargetUrl(action);
  return (
    <Button size="small" href={targetUrl ?? undefined} disabled={action.enabled === false || action.disabled}>
      {action.label}
    </Button>
  );
}

function StepDebugDrawer({
  state,
  onClose,
  onRun,
}: {
  state: StepDebugState | null;
  onClose: () => void;
  onRun: (mode: StepDebugMode) => void;
}) {
  const step = state?.step;
  return (
    <Drawer title={step ? `Step 调试：${step.step_id}` : 'Step 调试'} width={860} open={Boolean(state)} onClose={onClose}>
      {state && step ? (
        <Space direction="vertical" className="drawer-stack" size="large">
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="Item">{state.item.item_id}</Descriptions.Item>
            <Descriptions.Item label="Skill">{step.skill_ref}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={stepStatusColor(step.status)}>{step.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="耗时">{Math.round(step.latency_ms)}ms</Descriptions.Item>
          </Descriptions>
          <Space wrap>
            <Button loading={state.loading && state.mode === 'replay'} onClick={() => onRun('replay')}>重新 Replay Step</Button>
            <Button loading={state.loading && state.mode === 'prompt_debug'} onClick={() => onRun('prompt_debug')}>运行 Prompt Debug</Button>
            <Button loading={state.loading && state.mode === 'repro_bundle'} onClick={() => onRun('repro_bundle')}>刷新 Repro Bundle</Button>
          </Space>
          {state.loading ? <Alert type="info" showIcon message="正在加载 Step 调试结果。" /> : null}
          {state.error ? <Alert type="error" showIcon message="Step 调试失败" description={state.error} /> : null}
          {state.result?.message ? <Alert type="info" showIcon message={String(state.result.message)} /> : null}
          {state.result ? (
            <Card size="small" title="调试结果预览">
              <JsonBlock value={state.result} />
            </Card>
          ) : null}
          <Tabs
            items={[
              { key: 'resolved_input', label: 'Resolved Input', children: <JsonBlock value={step.resolved_input ?? step.input} /> },
              { key: 'raw_output', label: 'Raw Output', children: <JsonBlock value={step.raw_output ?? step.output} /> },
              { key: 'validated_output', label: 'Validated Output', children: <JsonBlock value={step.validated_output ?? step.output} /> },
              { key: 'schema_errors', label: 'Schema Errors', children: <JsonBlock value={step.schema_errors ?? []} /> },
              { key: 'llm_calls', label: 'LLM Calls', children: <JsonBlock value={step.prompt_calls ?? []} /> },
              { key: 'debug_result', label: stepDebugResultLabel(state.mode), children: <JsonBlock value={state.result ?? { status: 'not_loaded' }} /> },
            ]}
          />
        </Space>
      ) : null}
    </Drawer>
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

function stepDebugModeFromAction(actionId: string): StepDebugMode | null {
  if (actionId === 'view_step_detail') return 'detail';
  if (actionId === 'replay_step') return 'replay';
  if (actionId === 'prompt_debug') return 'prompt_debug';
  if (actionId === 'open_repro_bundle') return 'repro_bundle';
  return null;
}

function stepDebugResultLabel(mode: StepDebugMode): string {
  if (mode === 'replay') return 'Replay Result';
  if (mode === 'prompt_debug') return 'Prompt Debug Result';
  if (mode === 'repro_bundle') return 'Repro Bundle';
  return 'Step Snapshot';
}

function loadStepDebugResult(mode: StepDebugMode, runId: string, itemId: string, stepId: string) {
  if (mode === 'replay') {
    return api.replayRunItemStep(runId, itemId, stepId, { mock_llm_calls: true });
  }
  if (mode === 'prompt_debug') {
    return api.debugRunItemStepPrompt(runId, itemId, stepId, { mock_llm_calls: true });
  }
  if (mode === 'repro_bundle') {
    return api.runItemStepReproBundle(runId, itemId, stepId);
  }
  return Promise.resolve({});
}
