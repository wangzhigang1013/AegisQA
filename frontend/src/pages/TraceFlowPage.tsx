import { Building2, ArrowLeft, GitBranch, Database, AlertCircle, Play, Bug, RefreshCw, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { workbenchActionId, workbenchActionTargetUrl } from '../actions/actionRouter';
import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/Dialog';
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
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const traceFlow = traceQuery.data;
  const returnTaskId = searchParams.get('return_task_id') || taskId;
  const selectedItem = useMemo(() => {
    if (!traceFlow?.items.length) return null;
    return traceFlow.items[selectedItemIndex] ?? traceFlow.items[0];
  }, [selectedItemIndex, traceFlow?.items]);
  const [stepDebug, setStepDebug] = useState<StepDebugState | null>(null);

  const [activeTab, setActiveTab] = useState<string>('row');
  const [stepActiveTabs, setStepActiveTabs] = useState<Record<string, string>>({});

  const setStepTab = (stepId: string, tab: string) => {
    setStepActiveTabs(prev => ({ ...prev, [stepId]: tab }));
  };

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
    <section className="flex flex-col gap-6 w-full max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="样本级数据流"
        title="Trace Flow"
        description="查看一条样本如何从 Dataset Row 进入 Skill 输入、解析参数、产生输出与指标，并最终形成 Badcase。"
        primaryAction={
          <Button variant="outline" onClick={() => navigate(returnTaskId ? `/runs?task_id=${encodeURIComponent(returnTaskId)}` : '/runs')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回任务详情
          </Button>
        }
      />

      {traceQuery.isError ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Trace Flow 加载失败</span>
            <span className="text-sm mt-1">{formatApiError(traceQuery.error)}</span>
          </div>
        </div>
      ) : null}

      {traceFlow ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">数据集</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">名称</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.dataset.name}</dd>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">版本</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.dataset.version_id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-slate-500">队列消息</dt>
                    <dd className="text-sm font-medium text-slate-900 truncate max-w-[150px]" title={traceFlow.queue_message_shape.join(', ')}>
                      {traceFlow.queue_message_shape.join(', ')}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Workflow</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">名称</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.workflow.name}</dd>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">版本</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.workflow.version_id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-slate-500">Hash</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.workflow.snapshot_hash.slice(0, 12)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">执行批次</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">Run</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.attempt.run_id}</dd>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">状态</dt>
                    <dd className="text-sm font-medium text-slate-900">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                        {traceFlow.attempt.status}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-slate-500">Attempt</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceFlow.attempt.current_attempt}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 flex flex-col gap-4">
              <Card className="h-full">
                <CardHeader className="p-4 pb-2 border-b border-slate-100">
                  <CardTitle className="text-lg">样本列表</CardTitle>
                </CardHeader>
                <div className="flex flex-col relative">
                  {traceQuery.isLoading && (
                    <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                      <span className="text-slate-500 font-medium text-sm">加载中...</span>
                    </div>
                  )}
                  <div className="divide-y divide-slate-100">
                    {traceFlow.items.map((item, index) => (
                      <div 
                        key={item.item_id || index}
                        className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${index === selectedItemIndex ? 'bg-blue-50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                        onClick={() => setSelectedItemIndex(index)}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-slate-800 text-sm truncate">{item.item_id}</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0 ml-2 ${item.badcase?.is_badcase ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">row={item.row_id} / repeat={item.repeat_index}</div>
                      </div>
                    ))}
                  </div>
                  {traceFlow.pagination && traceFlow.pagination.total_items > traceFlow.pagination.page_size && (
                    <div className="p-4 border-t border-slate-100 flex justify-between items-center">
                      <button
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={tracePage <= 1}
                        onClick={() => {
                          setSelectedItemIndex(0);
                          setTracePage(tracePage - 1);
                        }}
                      >
                        上一页
                      </button>
                      <span className="text-xs text-slate-500">
                        {tracePage} / {Math.ceil(traceFlow.pagination.total_items / traceFlow.pagination.page_size)}
                      </span>
                      <button
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-xs hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={tracePage >= Math.ceil(traceFlow.pagination.total_items / traceFlow.pagination.page_size)}
                        onClick={() => {
                          setSelectedItemIndex(0);
                          setTracePage(tracePage + 1);
                        }}
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            </div>
            <div className="lg:col-span-8 flex flex-col gap-4">
              {selectedItem ? (
                <Card className="h-full">
                  <CardHeader className="p-4 pb-2 border-b border-slate-100">
                    <CardTitle className="text-lg">样本数据流：{selectedItem.item_id}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 flex flex-col gap-6">
                    <div className="flex flex-col relative pl-6 border-l-2 border-slate-200 ml-3 space-y-6">
                      <div className="relative">
                        <div className="absolute -left-[31px] bg-blue-100 text-blue-600 rounded-full p-1 border-2 border-white">
                          <Database className="w-4 h-4" />
                        </div>
                        <div className="text-sm font-medium text-slate-700">Dataset Row -{'>'} {Object.keys(selectedItem.row).join(', ') || '空 row'}</div>
                      </div>
                      
                      {selectedItem.steps.map((step, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-[31px] rounded-full p-1 border-2 border-white ${step.status === 'succeeded' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                            <GitBranch className="w-4 h-4" />
                          </div>
                          <div className="text-sm font-medium text-slate-700">{step.step_id} / {step.skill_ref} / {Math.round(step.latency_ms)}ms</div>
                        </div>
                      ))}

                      <div className="relative">
                        <div className={`absolute -left-[31px] rounded-full p-1 border-2 border-white ${selectedItem.badcase.is_badcase ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                          {selectedItem.badcase.is_badcase ? <XCircle className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                        </div>
                        <div className="text-sm font-medium text-slate-700">{selectedItem.badcase.is_badcase ? `Badcase：${selectedItem.badcase.reason}` : '未形成 Badcase'}</div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex border-b border-slate-200 overflow-x-auto">
                        {[
                          { key: 'row', label: 'Row' },
                          { key: 'context', label: 'Context' },
                          { key: 'metrics', label: 'Metrics' },
                          { key: 'steps', label: 'Steps' },
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                            onClick={() => setActiveTab(tab.key)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      
                      <div className="pt-2">
                        {activeTab === 'row' && <JsonBlock value={selectedItem.row} />}
                        {activeTab === 'context' && <JsonBlock value={selectedItem.context} />}
                        {activeTab === 'metrics' && <JsonBlock value={selectedItem.metrics} />}
                        {activeTab === 'steps' && (
                          <div className="flex flex-col gap-4">
                            {selectedItem.steps.map((step) => (
                              <Card key={step.step_id} className="shadow-none border-slate-200">
                                <CardHeader className="p-3 pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
                                  <span className="font-semibold text-sm text-slate-800">{step.step_id} / {step.skill_ref}</span>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stepStatusColorClass(step.status)}`}>
                                    {step.status}
                                  </span>
                                </CardHeader>
                                <CardContent className="p-3 flex flex-col gap-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-slate-500">诊断标签</span>
                                    {step.diagnostic_tags?.length ? (
                                      step.diagnostic_tags.map((tag) => <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 border border-slate-200">{tag}</span>)
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500 border border-slate-200">none</span>
                                    )}
                                  </div>
                                  
                                  {step.error_explanation ? (
                                    <div className={`p-3 rounded-xl border flex gap-3 ${step.status === 'succeeded' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                      <div className="flex flex-col">
                                        <span className="font-semibold text-sm">{step.error_explanation.code}</span>
                                        <span className="text-sm mt-1">{step.error_explanation.message}</span>
                                      </div>
                                    </div>
                                  ) : null}

                                  {step.available_actions?.length ? (
                                    <div className="flex flex-wrap gap-2">
                                      {step.available_actions.map((action) => (
                                        <StepActionButton
                                          key={workbenchActionId(action)}
                                          action={action}
                                          item={selectedItem}
                                          step={step}
                                          onOpenDebug={openStepDebug}
                                        />
                                      ))}
                                    </div>
                                  ) : null}

                                  <div className="flex flex-col border border-slate-200 rounded-lg overflow-hidden">
                                    <div className="flex overflow-x-auto bg-slate-50 border-b border-slate-200">
                                      {[
                                        { key: 'resolved_input', label: 'Resolved Input' },
                                        { key: 'raw_output', label: 'Raw Output' },
                                        { key: 'validated_output', label: 'Validated Output' },
                                        { key: 'schema_errors', label: 'Schema Errors' },
                                        { key: 'prompt_calls', label: 'Prompt Calls' },
                                        { key: 'input', label: 'Input' },
                                        { key: 'params', label: '参数' },
                                        { key: 'output', label: 'Output' },
                                        { key: 'error', label: 'Error' },
                                      ].map((tab) => {
                                        const currentActive = stepActiveTabs[step.step_id] || 'resolved_input';
                                        return (
                                          <button
                                            key={tab.key}
                                            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${currentActive === tab.key ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'text-slate-500 hover:bg-slate-100'}`}
                                            onClick={() => setStepTab(step.step_id, tab.key)}
                                          >
                                            {tab.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="p-3 bg-white">
                                      {(() => {
                                        const currentActive = stepActiveTabs[step.step_id] || 'resolved_input';
                                        if (currentActive === 'resolved_input') return <JsonBlock value={step.resolved_input ?? step.input} />;
                                        if (currentActive === 'raw_output') return <JsonBlock value={step.raw_output ?? step.output} />;
                                        if (currentActive === 'validated_output') return <JsonBlock value={step.validated_output ?? step.output} />;
                                        if (currentActive === 'schema_errors') return <JsonBlock value={step.schema_errors ?? []} />;
                                        if (currentActive === 'prompt_calls') return <JsonBlock value={step.prompt_calls ?? []} />;
                                        if (currentActive === 'input') return <JsonBlock value={step.input} />;
                                        if (currentActive === 'params') return <JsonBlock value={{ resolved_config: step.resolved_config, parameter_trace: step.parameter_trace }} />;
                                        if (currentActive === 'output') return <JsonBlock value={step.output} />;
                                        if (currentActive === 'error') return <JsonBlock value={step.error ?? {}} />;
                                        return null;
                                      })()}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-dashed border-slate-300 h-full">
                  <span className="text-slate-500 text-sm">暂无样本 Trace。请先执行任务。</span>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-dashed border-slate-300">
          <span className="text-slate-500 text-sm">正在等待 Trace Flow 数据。</span>
        </div>
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
      <Button variant="outline" size="sm" disabled={action.enabled === false || action.disabled} onClick={() => onOpenDebug(item, step, mode)} className="text-xs h-8">
        {action.label}
      </Button>
    );
  }
  const targetUrl = workbenchActionTargetUrl(action);
  return (
    <Button variant="outline" size="sm" asChild disabled={action.enabled === false || action.disabled} className="text-xs h-8">
      <a href={targetUrl ?? undefined}>{action.label}</a>
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
  const [activeTab, setActiveTab] = useState<string>('resolved_input');

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step ? `Step 调试：${step.step_id}` : 'Step 调试'}</DialogTitle>
          <DialogDescription className="sr-only">Step 调试详情窗口</DialogDescription>
        </DialogHeader>
        {state && step ? (
          <div className="flex flex-col gap-6 mt-4">
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex flex-col border-b md:border-b-0 border-slate-200 pb-2 md:pb-0">
                <dt className="text-xs text-slate-500 mb-1">Item</dt>
                <dd className="text-sm font-medium text-slate-900">{state.item.item_id}</dd>
              </div>
              <div className="flex flex-col border-b md:border-b-0 border-slate-200 pb-2 md:pb-0">
                <dt className="text-xs text-slate-500 mb-1">Skill</dt>
                <dd className="text-sm font-medium text-slate-900">{step.skill_ref}</dd>
              </div>
              <div className="flex flex-col border-b md:border-b-0 border-slate-200 pb-2 md:pb-0">
                <dt className="text-xs text-slate-500 mb-1">状态</dt>
                <dd>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stepStatusColorClass(step.status)}`}>
                    {step.status}
                  </span>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-slate-500 mb-1">耗时</dt>
                <dd className="text-sm font-medium text-slate-900">{Math.round(step.latency_ms)}ms</dd>
              </div>
            </dl>
            
            <div className="flex flex-wrap gap-2">
              <Button disabled={state.loading && state.mode === 'replay'} onClick={() => onRun('replay')}>
                <Play className="w-4 h-4 mr-2" />
                重新 Replay Step
              </Button>
              <Button disabled={state.loading && state.mode === 'prompt_debug'} onClick={() => onRun('prompt_debug')}>
                <Bug className="w-4 h-4 mr-2" />
                运行 Prompt Debug
              </Button>
              <Button disabled={state.loading && state.mode === 'repro_bundle'} onClick={() => onRun('repro_bundle')}>
                <RefreshCw className="w-4 h-4 mr-2" />
                刷新 Repro Bundle
              </Button>
            </div>

            {state.loading ? (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span className="text-sm mt-0.5">正在加载 Step 调试结果。</span>
              </div>
            ) : null}
            {state.error ? (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">Step 调试失败</span>
                  <span className="text-sm mt-1">{state.error}</span>
                </div>
              </div>
            ) : null}
            {state.result?.message ? (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span className="text-sm mt-0.5">{String(state.result.message)}</span>
              </div>
            ) : null}
            
            {state.result ? (
              <Card>
                <CardHeader className="p-3 pb-2 border-b border-slate-100">
                  <CardTitle className="text-sm">调试结果预览</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <JsonBlock value={state.result} />
                </CardContent>
              </Card>
            ) : null}
            
            <div className="flex flex-col border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex overflow-x-auto bg-slate-50 border-b border-slate-200">
                {[
                  { key: 'resolved_input', label: 'Resolved Input' },
                  { key: 'raw_output', label: 'Raw Output' },
                  { key: 'validated_output', label: 'Validated Output' },
                  { key: 'schema_errors', label: 'Schema Errors' },
                  { key: 'llm_calls', label: 'LLM Calls' },
                  { key: 'debug_result', label: stepDebugResultLabel(state.mode) },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${activeTab === tab.key ? 'bg-white text-blue-600 border-b-2 border-blue-500' : 'text-slate-500 hover:bg-slate-100'}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="p-0 bg-white">
                {(() => {
                  if (activeTab === 'resolved_input') return <JsonBlock value={step.resolved_input ?? step.input} />;
                  if (activeTab === 'raw_output') return <JsonBlock value={step.raw_output ?? step.output} />;
                  if (activeTab === 'validated_output') return <JsonBlock value={step.validated_output ?? step.output} />;
                  if (activeTab === 'schema_errors') return <JsonBlock value={step.schema_errors ?? []} />;
                  if (activeTab === 'llm_calls') return <JsonBlock value={step.prompt_calls ?? []} />;
                  if (activeTab === 'debug_result') return <JsonBlock value={state.result ?? { status: 'not_loaded' }} />;
                  return null;
                })()}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="font-mono text-xs bg-slate-50 text-slate-800 p-4 rounded-b-lg overflow-auto max-h-[400px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function stepStatusColorClass(status: string): string {
  if (['succeeded', 'passed'].includes(status)) return 'bg-green-100 text-green-700 border-green-200';
  if (['failed', 'schema_invalid', 'timeout'].includes(status)) return 'bg-red-100 text-red-700 border-red-200';
  if (['running', 'queued', 'pending'].includes(status)) return 'bg-blue-100 text-blue-700 border-blue-200';
  if (status === 'skipped') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-orange-100 text-orange-700 border-orange-200';
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
