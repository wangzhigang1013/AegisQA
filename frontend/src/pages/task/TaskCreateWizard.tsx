import { useState, useMemo } from 'react';
import { Info, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { DatasetSummary, TaskPreflightResult, WorkflowVersion } from '../../types';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/AntdShims';

export type TaskCreateFormValues = {
  name: string;
  workflow_version_id: string;
  dataset_version_id: string;
  allow_blocked_preflight?: boolean;
};

type TaskCreateWizardProps = {
  open: boolean;
  loading: boolean;
  preflightLoading: boolean;
  preflightResult?: TaskPreflightResult | null;
  datasets: DatasetSummary[];
  workflows: WorkflowVersion[];
  onCancel: () => void;
  onPreflight: (values: TaskCreateFormValues) => void;
  onSubmit: (values: TaskCreateFormValues) => void;
};

type DatasetVersionOption = {
  dataset: DatasetSummary;
  version: DatasetSummary['versions'][number];
};

export function TaskCreateWizard(props: TaskCreateWizardProps) {
  if (!props.open) {
    return null;
  }
  return <TaskCreateWizardContent {...props} />;
}

function TaskCreateWizardContent({ open, loading, preflightLoading, preflightResult, datasets, workflows, onCancel, onPreflight, onSubmit }: TaskCreateWizardProps) {
  const [formValues, setFormValues] = useState<TaskCreateFormValues>({
    name: '',
    workflow_version_id: '',
    dataset_version_id: '',
    allow_blocked_preflight: false,
  });

  const updateForm = (updates: Partial<TaskCreateFormValues>) => {
    setFormValues(prev => ({ ...prev, ...updates }));
  };

  const datasetVersions = useMemo(
    () => datasets.flatMap((dataset) => dataset.versions.map((version) => ({ dataset, version }))),
    [datasets],
  );
  
  const workflowOptions = useMemo(() => sortWorkflowsForSelection(workflows), [workflows]);
  
  const selectedWorkflow = workflowOptions.find((workflow) => workflow.version_id === formValues.workflow_version_id);
  const selectedDatasetVersion = datasetVersions.find((item) => item.version.version_id === formValues.dataset_version_id)?.version;
  
  const requiredRowFields = useMemo(() => collectRequiredRowFields(selectedWorkflow), [selectedWorkflow]);
  const datasetFields = useMemo(() => collectDatasetFields(selectedDatasetVersion), [selectedDatasetVersion]);
  const missingFields = useMemo(
    () => requiredRowFields.filter((field) => !datasetFields.includes(field)),
    [datasetFields, requiredRowFields],
  );

  const preflightMatchesSelection = Boolean(
    preflightResult
      && selectedDatasetVersion
      && preflightResult.workflow_version_id === formValues.workflow_version_id
      && preflightResult.dataset_id === selectedDatasetVersion.dataset_id
      && preflightResult.dataset_version === selectedDatasetVersion.version,
  );
  const preflightCanContinue = Boolean(
    preflightMatchesSelection
      && preflightResult
      && (preflightResult.status !== 'blocked' || formValues.allow_blocked_preflight),
  );
  
  const createDisabled = !formValues.workflow_version_id || !formValues.dataset_version_id || !preflightCanContinue;

  const handlePreflight = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!formValues.dataset_version_id || !formValues.workflow_version_id) return;
    onPreflight(formValues);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (createDisabled) return;
    onSubmit({
      ...formValues,
      allow_blocked_preflight: Boolean(preflightResult?.status === 'blocked' && formValues.allow_blocked_preflight),
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="创建任务"
    >
      <div className="space-y-6 mt-4">
        <p className="text-sm text-gray-500">
          创建任务只固定一批数据和一个已发布 Workflow。Skill 的输入绑定、输出传递和运行参数都应在 Workflow 画布里配置并发布，任务创建阶段不再重复配置这些内容。
        </p>

        <form id="createTaskForm" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">任务名称 <span className="text-red-500">*</span></label>
            <input 
              type="text"
              required
              className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="例如：RAG 回归评测 2026-05-31" 
              value={formValues.name}
              onChange={(e) => updateForm({ name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dataset Version <span className="text-red-500">*</span></label>
            <select 
              required
              className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={formValues.dataset_version_id}
              onChange={(e) => updateForm({ dataset_version_id: e.target.value })}
            >
              <option value="">选择数据版本</option>
              {datasetVersions.map(({ version }) => (
                <option key={version.version_id} value={version.version_id}>{datasetOptionLabel(version)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Workflow Version <span className="text-red-500">*</span></label>
            <select 
              required
              className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={formValues.workflow_version_id}
              onChange={(e) => updateForm({ workflow_version_id: e.target.value })}
            >
              <option value="">选择已发布 Workflow</option>
              {workflowOptions.map((workflow) => (
                <option key={workflow.version_id} value={workflow.version_id}>{workflowOptionLabel(workflow)}</option>
              ))}
            </select>
          </div>

          {selectedDatasetVersion && (
            <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
              <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
              <div>
                <h4 className="font-medium">当前数据集字段</h4>
                <p className="text-sm mt-1">{datasetFields.length ? `可用于 Workflow 输入绑定：${datasetFields.map((field) => `row.${field}`).join('、')}` : '当前数据集没有可识别字段。'}</p>
              </div>
            </div>
          )}

          {selectedWorkflow && (
            <div className={`p-4 border rounded-md flex gap-3 ${missingFields.length ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
              {missingFields.length ? <AlertTriangle className="w-5 h-5 flex-shrink-0 text-yellow-500" /> : <CheckCircle className="w-5 h-5 flex-shrink-0 text-green-500" />}
              <div>
                <h4 className="font-medium">{missingFields.length ? 'Dataset 与 Workflow 字段不匹配' : 'Workflow 字段需求已匹配'}</h4>
                <p className="text-sm mt-1">
                  {missingFields.length
                    ? `当前 Workflow 版本读取 ${requiredFieldsLabel(requiredRowFields)}，但当前数据集缺少 ${requiredFieldsLabel(missingFields)}。如果你没有使用这些字段，请回 Workflow 画布确认输入绑定并重新发布，或在这里选择正确的新版本。`
                    : `当前 Workflow 版本读取 ${requiredFieldsLabel(requiredRowFields)}。创建任务不会新增 question/reference 等默认字段，只按这个已发布版本的实际输入绑定预检。`
                  }
                </p>
              </div>
            </div>
          )}

          {formValues.workflow_version_id && formValues.dataset_version_id && !preflightResult && (
            <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
              <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
              <div>
                <h4 className="font-medium">请先运行 Preflight</h4>
                <p className="text-sm mt-1">Preflight 会用当前 Dataset Version 和 Workflow Version 检查字段、Skill 审批状态和基础运行条件。</p>
              </div>
            </div>
          )}

          {preflightResult && !preflightMatchesSelection && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-md flex gap-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-yellow-500" />
              <div>
                <h4 className="font-medium">Preflight 结果已过期</h4>
                <p className="text-sm mt-1">Dataset 或 Workflow 已变化，请重新运行 Preflight。</p>
              </div>
            </div>
          )}

          {preflightResult && preflightMatchesSelection && (
            <div className="space-y-4">
              <div className={`p-4 border rounded-md flex gap-3 ${preflightResult.status === 'blocked' ? 'bg-red-50 border-red-200 text-red-800' : preflightResult.status === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                {preflightResult.status === 'blocked' ? <XCircle className="w-5 h-5 flex-shrink-0 text-red-500" /> : preflightResult.status === 'warning' ? <AlertTriangle className="w-5 h-5 flex-shrink-0 text-yellow-500" /> : <CheckCircle className="w-5 h-5 flex-shrink-0 text-green-500" />}
                <div>
                  <h4 className="font-medium">{preflightTitle(preflightResult.status)}</h4>
                  <p className="text-sm mt-1">{preflightResult.summary}</p>
                </div>
              </div>

              {preflightResult.status === 'blocked' && (
                <div className="flex items-center">
                  <input 
                    id="allow_blocked" 
                    type="checkbox" 
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    checked={formValues.allow_blocked_preflight}
                    onChange={(e) => updateForm({ allow_blocked_preflight: e.target.checked })}
                  />
                  <label htmlFor="allow_blocked" className="ml-2 block text-sm text-gray-900 font-medium">
                    我已确认 Preflight 阻断风险，仍要创建任务
                  </label>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 border">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">检查项</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">结果</th>
                      <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">修复建议</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {preflightResult.checks.map(check => (
                      <tr key={check.check_id}>
                        <td className="px-4 py-2 text-sm text-gray-900">{check.title}</td>
                        <td className="px-4 py-2 text-sm whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                            check.status === 'passed' ? 'bg-green-100 text-green-800' : 
                            check.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {check.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">{check.message}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{check.recommendation || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </form>

        <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button 
            variant="outline" 
            disabled={!formValues.workflow_version_id || !formValues.dataset_version_id} 
            loading={preflightLoading} 
            onClick={handlePreflight}
          >
            运行 Preflight
          </Button>
          <Button 
            variant="default" 
            type="submit" 
            form="createTaskForm" 
            disabled={createDisabled} 
            loading={loading}
          >
            确认创建任务
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function preflightTitle(status: string) {
  if (status === 'passed') return 'Preflight 通过';
  if (status === 'warning') return 'Preflight 有警告';
  return 'Preflight 阻断';
}

function sortWorkflowsForSelection(workflows: WorkflowVersion[]): WorkflowVersion[] {
  return [...workflows].sort((left, right) => {
    if (right.version !== left.version) return right.version - left.version;
    return right.name.localeCompare(left.name, 'zh-CN');
  });
}

function datasetOptionLabel(version: DatasetVersionOption['version']): string {
  return `${version.name} v${version.version} / ${version.row_count} 条`;
}

function workflowOptionLabel(workflow: WorkflowVersion): string {
  const fields = collectRequiredRowFields(workflow);
  return `${workflow.name} v${workflow.version} / ${fields.length ? `需要 ${fields.map((field) => `row.${field}`).join(', ')}` : '不读取 row 字段'}`;
}

function collectRequiredRowFields(workflow?: WorkflowVersion): string[] {
  if (!workflow) return [];
  const fields = new Set<string>();
  workflow.steps?.forEach((step) => {
    Object.values(step.input_mapping ?? {}).forEach((source) => addRowField(fields, source));
  });
  workflow.graph?.nodes?.forEach((node) => {
    Object.values(node.input_mapping ?? {}).forEach((source) => addRowField(fields, source));
  });
  return [...fields].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function collectDatasetFields(version?: DatasetVersionOption['version']): string[] {
  if (!version) return [];
  const fields = new Set<string>();
  Object.keys(version.field_schema ?? {}).forEach((field) => {
    if (field) fields.add(field);
  });
  (version.field_paths ?? []).forEach((path) => addRowField(fields, path));
  return [...fields].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function addRowField(fields: Set<string>, source: unknown) {
  if (typeof source !== 'string') return;
  const trimmed = source.trim();
  if (!trimmed.startsWith('row.')) return;
  const field = trimmed.replace(/^row\./, '').split('.')[0];
  if (field) fields.add(field);
}

function requiredFieldsLabel(fields: string[]): string {
  if (!fields.length) return '无 row 字段';
  return fields.map((field) => `row.${field}`).join('、');
}
