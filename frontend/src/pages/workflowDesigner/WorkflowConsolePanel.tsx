import { CheckCircle, PlayCircle, Code } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';

import type { DatasetVersion, GraphValidationResult, WorkflowGraph } from '../../types';
import { IssueList } from './WorkflowIssuePanels';

type WorkflowConsolePanelProps = {
  graph: WorkflowGraph;
  selectedDataset: DatasetVersion | null;
  consoleTab: string;
  consoleText: string;
  consoleResult: GraphValidationResult | Record<string, unknown> | null;
  validateLoading: boolean;
  dryRunLoading: boolean;
  onConsoleTabChange: (tab: string) => void;
  onValidate: () => void;
  onDryRun: () => void;
};

export function WorkflowConsolePanel({
  graph,
  selectedDataset,
  consoleTab,
  consoleText,
  consoleResult,
  validateLoading,
  dryRunLoading,
  onConsoleTabChange,
  onValidate,
  onDryRun,
}: WorkflowConsolePanelProps) {
  return (
    <Card className="shadow-none border-0 h-full flex flex-col rounded-none">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">校验、试运行与输出结果</CardTitle>
        <div className="flex gap-2 flex-wrap">
          <Button disabled={validateLoading} onClick={onValidate} className="flex items-center gap-2" variant="outline" size="sm">
            <CheckCircle className="w-4 h-4" /> 校验当前画布
          </Button>
          <Button 
            disabled={!selectedDataset || dryRunLoading} 
            onClick={onDryRun} 
            className="flex items-center gap-2"
            title={!selectedDataset ? '请选择映射预览数据集' : '试运行完成后会直接切到 JSON 结果'}
            size="sm"
          >
            <PlayCircle className="w-4 h-4" /> 试运行并查看结果
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden px-6 pb-6 pt-0">
        <div className="flex border-b mb-4">
          {[
            { key: 'summary', label: '结果' },
            { key: 'issues', label: '错误与建议' },
            { key: 'json', label: 'JSON' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => onConsoleTabChange(tab.key)}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                consoleTab === tab.key 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto">
          {consoleTab === 'summary' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-slate-700">{consoleText}</p>
              <div className="flex gap-2 flex-wrap">
                <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">点对多</span>
                <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">多对一</span>
                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">队列消息：仅 item_id</span>
              </div>
            </div>
          )}
          {consoleTab === 'issues' && (
            <IssueList result={consoleResult} />
          )}
          {consoleTab === 'json' && (
            <pre className="bg-slate-50 p-4 rounded text-sm overflow-auto text-slate-800 flex items-start gap-2 h-full">
              <Code className="w-4 h-4 mt-1 flex-shrink-0" />
              <code>{JSON.stringify(consoleResult ?? graph, null, 2)}</code>
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
