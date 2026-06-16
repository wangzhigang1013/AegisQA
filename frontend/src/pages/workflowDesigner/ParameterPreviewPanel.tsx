import { PlayCircle, AlertCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';

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
    <div className="flex flex-col gap-4 h-full">
      <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded flex items-start gap-2 text-sm">
        <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
        <div>
          <h4 className="font-semibold mb-1">参数预览会冻结一次样本执行时的 Skill 配置</h4>
          <p className="text-blue-700/80">这里展示 default、workflow_config、task_override、expression 和 secret_ref 的最终覆盖结果，方便发布前确认参数没有被隐式改写。</p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-slate-500 text-sm">选择参数预览数据集</label>
        <select
          aria-label="选择参数预览数据集"
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          value={selectedDatasetVersion ?? ''}
          onChange={(e) => onDatasetVersionChange(e.target.value)}
        >
          <option value="" disabled>选择 Dataset Version</option>
          {datasetVersions.map(({ version }) => (
            <option key={version.version_id} value={version.version_id}>
              {version.name} v{version.version}
            </option>
          ))}
        </select>
      </div>

      <Button 
        disabled={previewMutation.isPending} 
        onClick={() => previewMutation.mutate()}
        className="w-max flex items-center gap-2"
      >
        <PlayCircle className="w-4 h-4" /> 预览参数
      </Button>

      {previewMutation.error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded flex items-start gap-2 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{previewMutation.error instanceof Error ? previewMutation.error.message : '参数预览失败'}</span>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto min-h-0 pt-2 border-t mt-2">
        {preview ? (
          <ParameterPreviewResult preview={preview} />
        ) : (
          <p className="text-slate-500 text-sm">选择数据集后点击预览参数，系统会调用后端解析当前画布中的 Skill 参数。</p>
        )}
      </div>
    </div>
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

  const thClass = "text-left py-2 px-3 bg-slate-50 font-medium text-slate-700 border-b";
  const tdClass = "py-2 px-3 border-b border-slate-100 text-slate-800";

  return (
    <div className="flex flex-col gap-6">
      <h3 className="font-semibold text-sm">{preview.workflow_name}</h3>
      
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={thClass}>节点</th>
              <th className={thClass}>Skill</th>
              <th className={thClass}>解析后配置</th>
            </tr>
          </thead>
          <tbody>
            {preview.nodes.map(node => (
              <tr key={node.node_id}>
                <td className={tdClass}>{node.node_id}</td>
                <td className={tdClass}>{node.skill_ref}</td>
                <td className={tdClass}>
                  <code className="bg-slate-100 px-1 py-0.5 rounded text-xs font-mono">{formatValue(node.resolved_config)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr>
              <th className={thClass}>节点</th>
              <th className={thClass}>参数</th>
              <th className={thClass}>来源</th>
              <th className={thClass}>值</th>
              <th className={thClass}>表达式</th>
              <th className={thClass}>Secret</th>
            </tr>
          </thead>
          <tbody>
            {traceRows.map(row => (
              <tr key={row.key}>
                <td className={tdClass}>{row.node_id}</td>
                <td className={tdClass}>{row.name}</td>
                <td className={tdClass}>
                  <span className={`px-2 py-0.5 rounded text-xs ${row.source === 'workflow_config' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                    {row.source}
                  </span>
                </td>
                <td className={tdClass}>
                  <span className="font-mono text-xs max-w-[200px] truncate block" title={row.value_preview}>{row.value_preview}</span>
                </td>
                <td className={tdClass}>{row.expression_path || '-'}</td>
                <td className={tdClass}>{row.redacted ? row.secret_ref || '已脱敏' : row.secret_ref || '-'}</td>
              </tr>
            ))}
            {traceRows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-500">无参数追踪信息</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
