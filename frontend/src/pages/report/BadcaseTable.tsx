import { PlusCircle, RotateCw, Ban, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { Key } from 'react';

import type { TaskRecord } from '../../types';

type BadcaseTableProps = {
  badcases: Record<string, unknown>[];
  pagination?: {
    page: number;
    page_size: number;
    total_items: number;
  };
  task: TaskRecord | null | undefined;
  loading: boolean;
  onAddGolden: (badcase: Record<string, unknown>) => void;
  onIgnore: (badcase: Record<string, unknown>) => void;
  onReopen: (badcase: Record<string, unknown>) => void;
  onAddAnnotation: (badcase: Record<string, unknown>) => void;
  selectedRowKeys: Key[];
  onSelectionChange: (keys: Key[]) => void;
  onPageChange?: (page: number) => void;
};

export function BadcaseTable({
  badcases,
  pagination,
  task,
  loading,
  onAddGolden,
  onIgnore,
  onReopen,
  onAddAnnotation,
  selectedRowKeys,
  onSelectionChange,
  onPageChange,
}: BadcaseTableProps) {
  if (!badcases.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-dashed border-slate-300">
        <span className="text-slate-500 text-sm mt-2">当前任务没有 Badcase。低分、失败或抽样样本会在这里进入人工纠错和 Golden 沉淀。</span>
      </div>
    );
  }

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      onSelectionChange(badcases.map(record => String(record.badcase_id ?? record.item_id)));
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectRow = (key: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedRowKeys, key]);
    } else {
      onSelectionChange(selectedRowKeys.filter(k => String(k) !== key));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto border border-slate-200 rounded-xl relative">
        {loading && (
          <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
            <span className="text-slate-500 font-medium text-sm">操作中...</span>
          </div>
        )}
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input 
                  type="checkbox" 
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={badcases.length > 0 && selectedRowKeys.length === badcases.length}
                  onChange={handleSelectAll}
                />
              </th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">原因</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">推荐动作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {badcases.map((record) => {
              const rowKey = String(record.badcase_id ?? record.item_id);
              const isSelected = selectedRowKeys.some(k => String(k) === rowKey);
              return (
                <tr key={rowKey} className={`hover:bg-slate-50/50 ${isSelected ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <input 
                      type="checkbox" 
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={isSelected}
                      onChange={(e) => handleSelectRow(rowKey, e.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{String(record.item_id ?? '-')}</td>
                  <td className="px-4 py-3 text-slate-600">{String(record.reason ?? '-')}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                      {String(record.status ?? 'open')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || !canCorrectBadcase(record, task)}
                        onClick={() => onAddGolden(record)}
                        className="gap-1 text-xs px-2 h-8"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        加入 Golden
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || !canCorrectBadcase(record, task)}
                        onClick={() => onIgnore(record)}
                        className="gap-1 text-xs px-2 h-8"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        忽略
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || !record.badcase_id}
                        onClick={() => onReopen(record)}
                        className="gap-1 text-xs px-2 h-8"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        重开
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || !task?.run_id}
                        onClick={() => onAddAnnotation(record)}
                        className="gap-1 text-xs px-2 h-8"
                      >
                        <Users className="w-3.5 h-3.5" />
                        加入审阅队列
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {pagination && pagination.total_items > pagination.page_size && (
        <div className="flex justify-end gap-2 items-center">
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
    </div>
  );
}

function canCorrectBadcase(badcase: Record<string, unknown>, task: TaskRecord | null | undefined): boolean {
  return Boolean(badcase.badcase_id || (task?.run_id && badcase.item_id));
}
