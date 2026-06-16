import { ArrowLeft, GitBranch, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';

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

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (itemId: string) => {
    const newExpandedRows = new Set(expandedRows);
    if (newExpandedRows.has(itemId)) {
      newExpandedRows.delete(itemId);
    } else {
      newExpandedRows.add(itemId);
    }
    setExpandedRows(newExpandedRows);
  };

  return (
    <section className="flex flex-col gap-6 w-full max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="调用树"
        title="Trace Tree"
        description="按 Item 展开 Skill Step 调用树，查看每一步的输入、输出、耗时、错误和缓存命中。"
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
            <span className="font-semibold text-sm">Trace Tree 加载失败，请确认任务已经执行并生成 Run。</span>
            <span className="text-sm mt-1">{formatApiError(traceQuery.error)}</span>
          </div>
        </div>
      ) : null}

      {traceTree ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Run</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">Run ID</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceTree.run_id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-slate-500">状态</dt>
                    <dd className="text-sm font-medium text-slate-900">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                        {traceTree.status}
                      </span>
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
                  <div className="flex justify-between">
                    <dt className="text-sm text-slate-500">版本</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceTree.workflow_version}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Dataset</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between">
                    <dt className="text-sm text-slate-500">版本</dt>
                    <dd className="text-sm font-medium text-slate-900">{traceTree.dataset_version ?? '-'}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Item 调用树</CardTitle>
            </CardHeader>
            <div className="p-0 overflow-x-auto relative">
              {traceQuery.isLoading && (
                <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                  <span className="text-slate-500 font-medium text-sm">加载中...</span>
                </div>
              )}
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 w-10"></th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">Metrics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {traceTree.items.map((item) => {
                    const isExpanded = expandedRows.has(item.item_id);
                    return (
                      <React.Fragment key={item.item_id}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-4 py-3 cursor-pointer text-slate-400 hover:text-slate-600" onClick={() => toggleRow(item.item_id)}>
                            <svg className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">{item.item_id}</td>
                          <td className="px-4 py-3 text-slate-600">{item.row_id}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                              {item.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <JsonPreview value={item.metrics} />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="bg-slate-50 p-4 border-b border-slate-200">
                              <StepTable steps={(item.children as Record<string, unknown>[]) ?? []} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {(!traceTree.items || traceTree.items.length === 0) && !traceQuery.isLoading && (
                <div className="p-8 text-center text-slate-500 text-sm">
                  暂无 Trace Tree。请先在执行中心执行任务。
                </div>
              )}
            </div>
            {traceTree.pagination && traceTree.pagination.total_items > traceTree.pagination.page_size && (
              <div className="p-4 border-t border-slate-200 flex justify-end gap-2 items-center">
                <button
                  className="px-3 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={tracePage <= 1}
                  onClick={() => setTracePage(tracePage - 1)}
                >
                  上一页
                </button>
                <span className="text-sm text-slate-500">
                  {tracePage} / {Math.ceil(traceTree.pagination.total_items / traceTree.pagination.page_size)}
                </span>
                <button
                  className="px-3 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={tracePage >= Math.ceil(traceTree.pagination.total_items / traceTree.pagination.page_size)}
                  onClick={() => setTracePage(tracePage + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-dashed border-slate-300">
          <span className="text-slate-500 text-sm">暂无 Trace Tree。请先在执行中心执行任务。</span>
        </div>
      )}
    </section>
  );
}

function StepTable({ steps }: { steps: Record<string, unknown>[] }) {
  if (!steps || steps.length === 0) {
    return (
      <div className="p-4 text-center text-slate-500 text-sm bg-white rounded-xl border border-slate-200">
        该 Item 暂无 Step 调用。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {steps.map((step) => (
        <Card key={String(step.step_id)} className="shadow-none border-slate-200">
          <CardHeader className="p-3 pb-2 border-b border-slate-100 flex flex-row items-center gap-2">
            <span className="font-semibold text-sm text-slate-800">{String(step.step_id)}</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
              {String(step.status)}
            </span>
          </CardHeader>
          <CardContent className="p-3 text-sm">
            <dl className="grid grid-cols-1 md:grid-cols-12 gap-y-2 gap-x-4">
              <div className="md:col-span-12 flex">
                <dt className="w-16 shrink-0 text-slate-500">Skill</dt>
                <dd className="font-medium">{String(step.skill_ref)}</dd>
              </div>
              <div className="md:col-span-12 flex">
                <dt className="w-16 shrink-0 text-slate-500">耗时</dt>
                <dd>{Math.round(Number(step.latency_ms ?? 0))} ms</dd>
              </div>
              <div className="md:col-span-12 flex">
                <dt className="w-16 shrink-0 text-slate-500">缓存</dt>
                <dd>
                  {step.cache_hit ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">hit</span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">miss</span>
                  )}
                </dd>
              </div>
              <div className="md:col-span-12 flex">
                <dt className="w-16 shrink-0 text-slate-500">输入</dt>
                <dd className="overflow-x-auto"><JsonPreview value={step.input} /></dd>
              </div>
              <div className="md:col-span-12 flex">
                <dt className="w-16 shrink-0 text-slate-500">输出</dt>
                <dd className="overflow-x-auto"><JsonPreview value={step.output} /></dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 whitespace-nowrap max-w-sm overflow-hidden text-ellipsis">
      <GitBranch className="w-3 h-3 shrink-0" />
      <span className="truncate">{JSON.stringify(value ?? {})}</span>
    </span>
  );
}
