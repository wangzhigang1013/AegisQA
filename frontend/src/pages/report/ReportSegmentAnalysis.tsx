import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import type { TaskReport } from '../../types';

type ReportSegmentAnalysisProps = {
  segments?: TaskReport['segments'];
  recommendations?: TaskReport['recommendations'];
  pagination?: TaskReport['segments_pagination'];
  loading?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onPageChange?: (page: number) => void;
};

export function ReportSegmentAnalysis({
  segments = [],
  recommendations = [],
  pagination,
  loading,
  searchValue = '',
  onSearchChange,
  onPageChange,
}: ReportSegmentAnalysisProps) {
  return (
    <Card className="mb-4">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-lg">分层分析</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="col-span-1 xl:col-span-2 flex flex-col gap-4">
            {segments.length ? (
              <>
                <Input
                  type="text"
                  placeholder="搜索分层字段或取值"
                  className="max-w-md"
                  value={searchValue}
                  onChange={(event) => onSearchChange?.(event.target.value)}
                />
                <div className="overflow-x-auto border border-slate-200 rounded-xl relative">
                  {loading && (
                    <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                      <span className="text-slate-500 font-medium text-sm">加载中...</span>
                    </div>
                  )}
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3">分组</th>
                        <th className="px-4 py-3">样本数</th>
                        <th className="px-4 py-3">通过</th>
                        <th className="px-4 py-3">失败</th>
                        <th className="px-4 py-3">Badcase</th>
                        <th className="px-4 py-3">通过率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {segments.map((row) => (
                        <tr key={`${row.segment_key}:${row.segment_value}`} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {row.segment_key}={row.segment_value}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{row.sample_count}</td>
                          <td className="px-4 py-3 text-slate-600">{row.pass_count}</td>
                          <td className="px-4 py-3 text-slate-600">{row.fail_count}</td>
                          <td className="px-4 py-3 text-slate-600">{row.badcase_count}</td>
                          <td className="px-4 py-3">
                            {(() => {
                              const percent = Math.round(Number(row.pass_rate ?? 0) * 100);
                              let colorClass = 'bg-red-100 text-red-700';
                              if (percent >= 80) colorClass = 'bg-green-100 text-green-700';
                              else if (percent >= 60) colorClass = 'bg-yellow-100 text-yellow-700';
                              return (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}>
                                  {percent}%
                                </span>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pagination && pagination.total_items > pagination.page_size && (
                  <div className="flex justify-end gap-2 items-center mt-2">
                    <button
                      className="px-3 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={pagination.page <= 1}
                      onClick={() => onPageChange?.(pagination.page - 1)}
                    >
                      上一页
                    </button>
                    <span className="text-sm text-slate-500">
                      {pagination.page} / {Math.ceil(pagination.total_items / pagination.page_size)}
                    </span>
                    <button
                      className="px-3 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={pagination.page >= Math.ceil(pagination.total_items / pagination.page_size)}
                      onClick={() => onPageChange?.(pagination.page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                <span className="text-slate-500 text-sm mt-2">当前报告没有可分层字段。建议在数据集中补充 scene、expected_label、model_version 或 prompt_version。</span>
              </div>
            )}
          </div>
          <div className="col-span-1 flex flex-col gap-4">
            <h4 className="font-semibold text-slate-800">下一步建议</h4>
            <div className="flex flex-col gap-3">
              {recommendations.length ? (
                recommendations.map((item) => {
                  let alertClass = 'bg-blue-50 border-blue-200 text-blue-800';
                  let Icon = Info;
                  if (item.severity === 'critical') {
                    alertClass = 'bg-red-50 border-red-200 text-red-800';
                    Icon = AlertCircle;
                  } else if (item.severity === 'warning') {
                    alertClass = 'bg-yellow-50 border-yellow-200 text-yellow-800';
                    Icon = AlertTriangle;
                  }

                  return (
                    <div
                      key={`${item.action}:${item.segment_key ?? 'global'}:${item.segment_value ?? 'all'}`}
                      className={`flex gap-3 p-4 rounded-xl border ${alertClass}`}
                    >
                      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm mb-1">{item.title}</span>
                        <span className="text-sm opacity-90">{item.message}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex gap-3 p-4 rounded-xl border bg-green-50 border-green-200 text-green-800">
                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm mb-1">暂无阻断建议</span>
                    <span className="text-sm opacity-90">当前分层通过率没有低于阈值的明显短板，可以继续观察跨任务趋势。</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
