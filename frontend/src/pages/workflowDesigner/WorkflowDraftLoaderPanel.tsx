import { Info } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';

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
    <Card className="shadow-none border-0 rounded-none border-b border-slate-200">
      <CardHeader className="py-4">
        <CardTitle className="text-lg">流程加载与数据集映射</CardTitle>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 text-sm">加载已有流程</span>
              <div title="用于把草稿、已发布版本或模板加载到当前画布。加载会替换当前未保存画布。" className="text-slate-400 cursor-help">
                <Info className="w-3.5 h-3.5" />
              </div>
            </div>
            <select
              aria-label="加载已有流程"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value=""
              onChange={(e) => {
                if (e.target.value) onLoadWorkflow(e.target.value);
              }}
            >
              <option value="" disabled>选择草稿、已发布版本或模板</option>
              <optgroup label="草稿">
                {workflowDrafts.map((draft) => (
                  <option key={`draft:${draft.draft_id}`} value={`draft:${draft.draft_id}`}>草稿：{draft.name}</option>
                ))}
              </optgroup>
              <optgroup label="已发布">
                {workflowVersions.map((workflow) => (
                  <option key={`workflow:${workflow.version_id}`} value={`workflow:${workflow.version_id}`}>已发布：{workflow.name} v{workflow.version}</option>
                ))}
              </optgroup>
              <optgroup label="模板">
                {workflowTemplates.map((template) => (
                  <option key={`template:${String(template.template_id)}`} value={`template:${String(template.template_id)}`}>模板：{String(template.name)}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-1.5">
            <div className="flex flex-col">
              <span className="text-slate-500 text-sm">映射预览数据集 / 试运行数据集</span>
            </div>
            <select
              aria-label="映射预览数据集 / 试运行数据集"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={selectedDatasetVersion ?? ''}
              onChange={(e) => onDatasetVersionChange(e.target.value)}
            >
              <option value="" disabled>选择 Dataset Version</option>
              {datasetVersions.map(({ version }) => (
                <option key={version.version_id} value={version.version_id}>{version.name} v{version.version}</option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-1.5">
            <span className="text-slate-500 text-sm">样本数</span>
            <input 
              type="number"
              min={1} 
              max={10} 
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={sampleSize} 
              onChange={(e) => onSampleSizeChange(parseInt(e.target.value) || 1)} 
            />
          </div>

          <div className="lg:col-span-2 flex flex-col gap-1.5">
            <span className="text-slate-500 text-sm">流程名称</span>
            <input 
              type="text"
              aria-label="流程名称" 
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={workflowName} 
              onChange={(e) => onWorkflowNameChange(e.target.value)} 
            />
          </div>
        </div>

        {selectedDataset && (
          <div className="mt-6 border border-slate-200 rounded-lg shadow-sm overflow-hidden bg-white">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h3 className="font-semibold text-sm">数据集字段预览</h3>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <p className="text-xs text-slate-500 hidden md:block">
                  共 {datasetFieldRows.length} 个字段，已开启搜索和分页；输入绑定里也会按关键词筛选候选路径。
                </p>
                <input
                  type="text"
                  placeholder="搜索字段路径、类型或示例值"
                  className="w-full sm:w-64 border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={datasetFieldSearch}
                  onChange={(e) => onDatasetFieldSearchChange(e.target.value)}
                />
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 font-medium">可用路径</th>
                    <th className="px-4 py-2 font-medium">字段类型</th>
                    <th className="px-4 py-2 font-medium">示例值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDatasetFieldRows.slice(0, 8).map(row => (
                    <tr key={row.path} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2 font-mono text-xs">{row.path}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{row.type}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-600 truncate max-w-xs">{String(row.example ?? '')}</td>
                    </tr>
                  ))}
                  {filteredDatasetFieldRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        没有找到匹配的字段
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredDatasetFieldRows.length > 8 && (
              <div className="p-2 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-500">
                显示前 8 条，共 {filteredDatasetFieldRows.length} 条
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
