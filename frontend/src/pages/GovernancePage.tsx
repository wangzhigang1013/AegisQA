import { ShieldCheck, XCircle, CheckCircle, Info } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, FormEvent } from 'react';

import { api } from '../api/client';
import { PageSection } from '../components/LayoutPrimitives';
import { PageHeader } from '../components/PageHeader';
import { SkillApprovalDrawer } from './skills/SkillApprovalDrawer';
import type { ModelGatewayConfig, ModelGatewayConnection, ModelGatewayTestResult, RuntimeStatus, RuntimeStatusComponent, SkillManifest, SkillPackageRecord } from '../types';
import { isMoreCanonicalPackage } from '../lib/skillPackageUtils';
import { Button } from '../components/ui/Button';
import { Card, Modal, Table } from '../components/AntdShims';
import { Input } from '../components/ui/Input';

const permissionRows = [
  { key: 'admin', role: 'admin', permissions: 'workflow:publish, run:control, skill:governance, audit:read' },
  { key: 'evaluator', role: 'evaluator', permissions: 'dataset:write, workflow:write, run:create, report:read, report:export' },
  { key: 'reviewer', role: 'reviewer', permissions: 'badcase:correct, judge:audit, report:read, report:export' },
];

const modelProviderOptions = [
  { value: 'mock', label: '离线 Mock（不调用真实模型）' },
  { value: 'openai_compatible', label: '真实模型服务（OpenAI-compatible）' },
  { value: 'anthropic', label: 'Anthropic Claude' },
];
const modelProviderValues = new Set(modelProviderOptions.map((option) => option.value));

type ModelServiceTemplate = {
  value: string;
  label: string;
  provider: string;
  base_url: string;
  secret_ref: string;
  default_model: string;
  default_models: string[];
};

const modelServiceTemplates: ModelServiceTemplate[] = [
  {
    value: 'mock',
    label: '离线 Mock',
    provider: 'mock',
    base_url: '',
    secret_ref: '',
    default_model: 'mock-eval-model',
    default_models: ['mock-eval-model'],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek（OpenAI-compatible）',
    provider: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    secret_ref: 'env:DEEPSEEK_API_KEY',
    default_model: 'deepseek-chat',
    default_models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'],
  },
  {
    value: 'qwen',
    label: '阿里云百炼 / Qwen（OpenAI-compatible）',
    provider: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    secret_ref: 'env:QWEN_API_KEY',
    default_model: 'qwen-plus',
    default_models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
  },
  {
    value: 'openai',
    label: 'OpenAI 官方',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    secret_ref: 'env:OPENAI_API_KEY',
    default_model: 'gpt-4o-mini',
    default_models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    secret_ref: 'env:ANTHROPIC_API_KEY',
    default_model: 'claude-sonnet-4-20250514',
    default_models: [
      'claude-sonnet-4-20250514',
      'claude-haiku-4-20250414',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ],
  },
  {
    value: 'local-compatible',
    label: '本地兼容服务（vLLM / Ollama 等）',
    provider: 'openai_compatible',
    base_url: 'http://localhost:11434/v1',
    secret_ref: '',
    default_model: 'local-model',
    default_models: ['local-model', 'qwen2.5', 'llama3.1', 'deepseek-r1'],
  },
];

const modelServiceTemplateOptions = modelServiceTemplates.map((template) => ({
  value: template.value,
  label: template.label,
}));

type ModelGatewayConfigFormValues = {
  model_template?: string;
  provider: string;
  base_url?: string | null;
  secret_ref?: string | null;
  api_key?: string;
  default_model: string;
  timeout_seconds: number;
  clear_api_key?: boolean;
};

type ModelGatewayConnectionFormValues = {
  model_template?: string;
  connection_id: string;
  name?: string | null;
  provider: string;
  base_url?: string | null;
  secret_ref?: string | null;
  api_key?: string;
  default_model: string;
  timeout_seconds: number;
  enabled?: boolean;
  clear_api_key?: boolean;
};

export function GovernancePage() {
  const queryClient = useQueryClient();
  const [modelForm, setModelForm] = useState<ModelGatewayConfigFormValues>({
    model_template: undefined,
    provider: 'mock',
    base_url: '',
    secret_ref: '',
    api_key: '',
    default_model: 'mock-eval-model',
    timeout_seconds: 60,
    clear_api_key: false,
  });
  const [connectionForm, setConnectionForm] = useState<ModelGatewayConnectionFormValues>({
    model_template: undefined,
    connection_id: '',
    name: '',
    provider: 'mock',
    base_url: '',
    secret_ref: '',
    api_key: '',
    default_model: 'mock-eval-model',
    timeout_seconds: 60,
    enabled: true,
    clear_api_key: false,
  });
  
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [approvalSkill, setApprovalSkill] = useState<SkillManifest | null>(null);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [disableSkill, setDisableSkill] = useState<SkillManifest | null>(null);
  const [addAliasDrawerOpen, setAddAliasDrawerOpen] = useState(false);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [deleteConnectionId, setDeleteConnectionId] = useState<string | null>(null);
  const [editingConnection, setEditingConnection] = useState<ModelGatewayConnection | null>(null);
  const [testPrompt, setTestPrompt] = useState('用一句话介绍 AegisQA。');
  const [connectionTestPrompt] = useState('用一句话介绍当前模型连接。');
  const [modelSearchValue, setModelSearchValue] = useState('');
  const [connectionModelSearchValue, setConnectionModelSearchValue] = useState('');
  const [modelTestResult, setModelTestResult] = useState<ModelGatewayTestResult | null>(null);
  const [connectionTestResult, setConnectionTestResult] = useState<ModelGatewayTestResult | null>(null);
  
  const selectedModelTemplate = modelForm.model_template;
  const selectedDefaultModel = modelForm.default_model;
  const selectedConnectionTemplate = connectionForm.model_template;
  const selectedConnectionDefaultModel = connectionForm.default_model;
  
  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const packagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const auditEventsQuery = useQuery({ queryKey: ['audit-events'], queryFn: () => api.auditEvents() });
  const runtimeStatusQuery = useQuery({ queryKey: ['runtime-status'], queryFn: api.runtimeStatus });
  const modelGatewayQuery = useQuery({ queryKey: ['model-gateway-status'], queryFn: api.modelGatewayStatus });
  const modelGatewayConfigQuery = useQuery({ queryKey: ['model-gateway-config'], queryFn: api.modelGatewayConfig });
  const modelGatewayConnectionsQuery = useQuery({ queryKey: ['model-gateway-connections'], queryFn: api.modelGatewayConnections });
  const modelGatewayConnections = Array.isArray(modelGatewayConnectionsQuery.data) ? modelGatewayConnectionsQuery.data : [];
  
  const runtimeComponents = useMemo(() => buildRuntimeComponents(runtimeStatusQuery.data), [runtimeStatusQuery.data]);
  const packageBySkillId = useMemo(() => indexPackagesBySkillId(packagesQuery.data ?? []), [packagesQuery.data]);
  const defaultModelOptions = useMemo(
    () => buildDefaultModelOptions(selectedModelTemplate, selectedDefaultModel, modelSearchValue),
    [modelSearchValue, selectedDefaultModel, selectedModelTemplate],
  );
  const connectionDefaultModelOptions = useMemo(
    () => buildDefaultModelOptions(selectedConnectionTemplate, selectedConnectionDefaultModel, connectionModelSearchValue),
    [connectionModelSearchValue, selectedConnectionDefaultModel, selectedConnectionTemplate],
  );
  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return skillsQuery.data ?? [];
    return (skillsQuery.data ?? []).filter((skill) => `${skill.skill_id} ${skill.name}`.toLowerCase().includes(query));
  }, [skillQuery, skillsQuery.data]);

  const skillMutation = useMutation({
    mutationFn: ({ skill, action }: { skill: SkillManifest; action: 'approve' | 'disable' | 'deprecate' }) =>
      api.updateSkillStatus(skill.skill_id, action, action === 'approve' ? '' : '前端治理操作'),
    onSuccess: async (skill) => {
      setNotice(`Skill 状态已更新：${skill.skill_id} / ${skill.status}`);
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-events'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `治理动作失败：${error.message}` : '治理动作失败'),
  });

  const modelConfigMutation = useMutation({
    mutationFn: (values: ModelGatewayConfigFormValues) =>
      api.updateModelGatewayConfig({
        provider: normalizeModelProvider(values.provider),
        base_url: values.base_url?.trim() || null,
        secret_ref: values.clear_api_key ? null : values.secret_ref?.trim() || null,
        default_model: values.default_model,
        timeout_seconds: Number(values.timeout_seconds ?? 60),
        clear_api_key: Boolean(values.clear_api_key),
      }),
    onSuccess: async (config) => {
      const temporaryApiKey = modelForm.api_key;
      setNotice(`模型网关配置已保存：${config.provider} / ${config.default_model}`);
      hydrateModelForm(config);
      setModelForm(prev => ({ ...prev, api_key: temporaryApiKey }));
      setModelTestResult(null);
      setModelConfigOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['model-gateway-config'] });
      await queryClient.invalidateQueries({ queryKey: ['model-gateway-status'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-events'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `模型网关配置失败：${error.message}` : '模型网关配置失败'),
  });

  const modelTestMutation = useMutation({
    mutationFn: () =>
      api.testModelGateway({
        prompt: testPrompt,
        model: modelForm.default_model,
        temperature: 0.2,
        max_tokens: 200,
        api_key: modelForm.api_key?.trim() || undefined,
        secret_ref: modelForm.secret_ref?.trim() || undefined,
      }),
    onSuccess: (result) => {
      setModelTestResult(result);
      setNotice(`模型网关连接测试通过：${result.response.model}`);
    },
    onError: (error) => setNotice(error instanceof Error ? `模型网关连接测试失败：${error.message}` : '模型网关连接测试失败'),
  });

  const connectionSaveMutation = useMutation({
    mutationFn: (values: ModelGatewayConnectionFormValues) => {
      const payload = buildConnectionPayload(values);
      if (editingConnection) {
        return api.updateModelGatewayConnection(editingConnection.connection_id, payload);
      }
      return api.createModelGatewayConnection(payload);
    },
    onSuccess: async (connection) => {
      setNotice(`模型连接已保存：${connection.connection_id}`);
      setConnectionModalOpen(false);
      setEditingConnection(null);
      setConnectionTestResult(null);
      await queryClient.invalidateQueries({ queryKey: ['model-gateway-connections'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-events'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `模型连接保存失败：${error.message}` : '模型连接保存失败'),
  });

  const connectionDeleteMutation = useMutation({
    mutationFn: (connection: ModelGatewayConnection) => api.deleteModelGatewayConnection(connection.connection_id),
    onSuccess: async (result) => {
      setNotice(`模型连接已删除：${result.connection_id}`);
      await queryClient.invalidateQueries({ queryKey: ['model-gateway-connections'] });
      await queryClient.invalidateQueries({ queryKey: ['audit-events'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `模型连接删除失败：${error.message}` : '模型连接删除失败'),
  });

  const connectionTestMutation = useMutation({
    mutationFn: (connection: ModelGatewayConnection) =>
      api.testModelGateway({
        model_connection_id: connection.connection_id,
        prompt: connectionTestPrompt,
        model: connection.default_model,
      }),
    onSuccess: (result) => {
      setConnectionTestResult(result);
      setNotice(`模型连接测试通过：${result.response.model}`);
    },
    onError: (error) => setNotice(error instanceof Error ? `模型连接测试失败：${error.message}` : '模型连接测试失败'),
  });

  const hydrateModelForm = (config?: ModelGatewayConfig) => {
    const migratedModel = normalizeDefaultModelFromProvider(config?.provider, config?.default_model, 'mock-eval-model');
    setModelForm({
      model_template: undefined,
      provider: normalizeModelProvider(config?.provider),
      base_url: config?.base_url ?? '',
      secret_ref: config?.secret_ref ?? '',
      api_key: '',
      default_model: migratedModel,
      timeout_seconds: config?.timeout_seconds ?? 60,
      clear_api_key: false,
    });
  };

  const hydrateConnectionForm = (connection?: ModelGatewayConnection | null) => {
    const migratedModel = normalizeDefaultModelFromProvider(connection?.provider, connection?.default_model, 'mock-eval-model');
    setConnectionForm({
      model_template: undefined,
      connection_id: connection?.connection_id ?? '',
      name: connection?.name ?? '',
      provider: normalizeModelProvider(connection?.provider),
      base_url: connection?.base_url ?? '',
      secret_ref: connection?.secret_ref ?? '',
      api_key: '',
      default_model: migratedModel,
      timeout_seconds: connection?.timeout_seconds ?? 60,
      enabled: connection?.enabled ?? true,
      clear_api_key: false,
    });
  };

  const openModelConfig = () => {
    hydrateModelForm(modelGatewayConfigQuery.data);
    setModelConfigOpen(true);
    setModelTestResult(null);
  };

  const openConnectionModal = (connection?: ModelGatewayConnection) => {
    setEditingConnection(connection ?? null);
    hydrateConnectionForm(connection ?? null);
    setConnectionModalOpen(true);
    setConnectionTestResult(null);
  };

  const applyTemplateToModelForm = (templateValue?: string) => {
    const template = modelServiceTemplates.find((item) => item.value === templateValue);
    if (!template) return;
    setModelForm(prev => ({
      ...prev,
      model_template: templateValue,
      provider: template.provider,
      base_url: template.base_url,
      secret_ref: template.secret_ref,
      default_model: template.default_model,
    }));
    setModelSearchValue('');
  };

  const applyTemplateToConnectionForm = (templateValue?: string) => {
    const template = modelServiceTemplates.find((item) => item.value === templateValue);
    if (!template) return;
    setConnectionForm(prev => ({
      ...prev,
      model_template: templateValue,
      provider: template.provider,
      base_url: template.base_url,
      secret_ref: template.secret_ref,
      default_model: template.default_model,
    }));
    setConnectionModelSearchValue('');
  };

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="平台治理"
        title="治理与审计"
        description="管理 RBAC、Skill 生命周期和审计日志。生产适配说明保留在部署文档中，不作为当前页面的可操作状态。"
        primaryAction={<Button variant="default" icon={<ShieldCheck className="w-4 h-4" />} onClick={() => setMatrixOpen(true)}>查看权限矩阵</Button>}
      />

      {notice && (
        <div className={`flex items-center justify-between p-4 rounded-md border ${notice.includes('失败') ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          <div className="flex items-center gap-2">
            {notice.includes('失败') ? <XCircle className="w-5 h-5 text-red-500" /> : <CheckCircle className="w-5 h-5 text-green-500" />}
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-gray-700">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      <PageSection title="运行状态" testId="governance-runtime-section">
        <Card title="运行状态与生产边界">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900">运行态驾驶舱</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">组件</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">后端/模式</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">说明</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">入口</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {runtimeComponents.map(record => (
                    <tr key={record.component_id}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="font-medium text-gray-900">{record.name}</div>
                        <div className="text-gray-500 font-mono text-xs">{record.component_id}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {renderRuntimeStatusTag(record.status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded">{record.backend}</code>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {record.message}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex flex-wrap gap-2">
                          <a href={record.doc_url} className="text-blue-600 hover:underline">文档</a>
                          {record.config_url && <a href={record.config_url} className="text-blue-600 hover:underline">配置</a>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border p-4 rounded-md bg-gray-50">
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-700">存储后端</span>
                <div className="flex gap-2 items-center">
                  <code className="bg-white px-1 border rounded text-xs">{runtimeStatusQuery.data?.storage?.backend ?? '-'}</code>
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.storage?.status)}
                </div>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-700">执行器</span>
                <div className="flex gap-2 items-center">
                  <code className="bg-white px-1 border rounded text-xs">{runtimeStatusQuery.data?.executor?.backend ?? '-'}</code>
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.executor?.status)}
                </div>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-700">模型网关</span>
                <div className="flex gap-2 items-center">
                  <code className="bg-white px-1 border rounded text-xs">{runtimeStatusQuery.data?.model_gateway?.provider ?? '-'}</code>
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.model_gateway?.status)}
                </div>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-700">Skill 沙箱</span>
                <div className="flex gap-2 items-center">
                  <code className="bg-white px-1 border rounded text-xs">{runtimeStatusQuery.data?.skill_sandbox?.mode ?? '-'}</code>
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.skill_sandbox?.status)}
                </div>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-700">MySQL</span>
                <div className="flex gap-2 items-center text-xs text-right">
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.external_services?.mysql?.status)} 
                  <span className="ml-2 text-gray-500 max-w-[200px] truncate" title={runtimeStatusQuery.data?.external_services?.mysql?.message}>{runtimeStatusQuery.data?.external_services?.mysql?.message ?? '-'}</span>
                </div>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="font-medium text-gray-700">Redis</span>
                <div className="flex gap-2 items-center text-xs text-right">
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.external_services?.redis?.status)} 
                  <span className="ml-2 text-gray-500 max-w-[200px] truncate" title={runtimeStatusQuery.data?.external_services?.redis?.message}>{runtimeStatusQuery.data?.external_services?.redis?.message ?? '-'}</span>
                </div>
              </div>
              <div className="flex justify-between py-2">
                <span className="font-medium text-gray-700">Celery</span>
                <div className="flex gap-2 items-center text-xs text-right">
                  {renderRuntimeStatusTag(runtimeStatusQuery.data?.external_services?.celery?.status)} 
                  <span className="ml-2 text-gray-500 max-w-[200px] truncate" title={runtimeStatusQuery.data?.external_services?.celery?.message}>{runtimeStatusQuery.data?.external_services?.celery?.message ?? '-'}</span>
                </div>
              </div>
              <div className="flex justify-between py-2">
                <span className="font-medium text-gray-700">沙箱限制</span>
                <div className="text-xs text-gray-700 text-right">
                  {runtimeStatusQuery.data?.skill_sandbox
                    ? `${runtimeStatusQuery.data.skill_sandbox.network_default} / ${runtimeStatusQuery.data.skill_sandbox.file_scope} / ${runtimeStatusQuery.data.skill_sandbox.limits.max_files} files`
                    : '-'}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              当前状态来自后端运行时事实，不把 MySQL、Redis 或 Celery 占位资产展示为已启用。
            </p>
          </div>
        </Card>
      </PageSection>

      <PageSection title="模型网关与连接" testId="governance-model-section">
        <Card
          title="模型接入"
          extra={<Button variant="default" onClick={openModelConfig}>配置模型网关</Button>}
        >
          <div className="space-y-4">
            <div className={`p-4 rounded-md flex gap-3 ${modelGatewayQuery.data?.ready ? 'bg-green-50 text-green-800' : 'bg-yellow-50 text-yellow-800'}`}>
              <Info className={`w-5 h-5 flex-shrink-0 ${modelGatewayQuery.data?.ready ? 'text-green-500' : 'text-yellow-500'}`} />
              <div>
                <h4 className="font-medium">统一模型网关</h4>
                <p className="text-sm mt-1">业务 Skill 可以直接复用模型调用节点，不需要在每个 Skill 里重复实现模型 API、鉴权、超时和返回解析。</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 border p-4 rounded-md bg-gray-50">
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">推荐 Skill</span><span className="w-2/3">{modelGatewayQuery.data?.skill_ref ? <code className="bg-gray-100 px-1 rounded text-sm">{modelGatewayQuery.data.skill_ref}</code> : '-'}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">Provider</span><span className="w-2/3">{modelGatewayQuery.data?.provider ?? '-'}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">默认模型</span><span className="w-2/3">{modelGatewayQuery.data?.default_model ?? '-'}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">模式</span><span className="w-2/3">{formatModelGatewayMode(modelGatewayQuery.data?.mode)}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">Base URL</span><span className="w-2/3">{modelGatewayConfigQuery.data?.base_url ?? (modelGatewayQuery.data?.base_url_configured ? '已配置' : '未配置')}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">Secret 引用</span><span className="w-2/3">{modelGatewayConfigQuery.data?.secret_ref ?? '-'}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">API Key</span><span className="w-2/3">{modelGatewayConfigQuery.data?.api_key_masked ?? (modelGatewayQuery.data?.api_key_configured ? '已配置' : '未配置或本地模型无需 Key')}</span></div>
              <div className="flex py-1 border-b"><span className="w-1/3 text-gray-500">超时</span><span className="w-2/3">{modelGatewayQuery.data ? `${modelGatewayQuery.data.timeout_seconds} 秒` : '-'}</span></div>
              <div className="flex py-1"><span className="w-1/3 text-gray-500">状态</span><span className="w-2/3"><span className={`inline-block px-2 py-0.5 rounded text-xs ${modelGatewayQuery.data?.ready ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{modelGatewayQuery.data?.ready ? '可用' : '未配置真实模型'}</span></span></div>
              <div className="flex py-1"><span className="w-1/3 text-gray-500">配置来源</span><span className="w-2/3">{formatModelGatewaySource(modelGatewayConfigQuery.data?.source)}</span></div>
            </div>
            <p className="text-xs text-gray-500">
              真实模型接入只保存 Secret 引用；API Key 可作为临时测试密钥使用，不会写入本地 store。
            </p>
          </div>
        </Card>

        <Card
          title="模型连接别名"
          extra={<Button variant="default" onClick={() => openConnectionModal()}>新增模型连接</Button>}
          className="mt-4"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              连接别名用于 Workflow 参数里的 <code className="bg-gray-100 px-1 rounded">model_connection_id</code>，任务快照只记录别名、模型名和脱敏 Secret 引用。
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 border">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">连接 ID</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">显示名称</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">默认模型</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Secret</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {modelGatewayConnections.map(connection => (
                    <tr key={connection.connection_id}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm"><code className="bg-gray-100 px-1 rounded">{connection.connection_id}</code></td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{connection.name || connection.connection_id}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{connection.provider}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{connection.default_model}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{connection.secret_ref ?? connection.api_key_masked ?? '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${connection.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {connection.enabled ? '启用' : '停用'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => openConnectionModal(connection)}>编辑</Button>
                          <Button variant="outline" size="sm" onClick={() => connectionTestMutation.mutate(connection)}>测试</Button>
                          <Button variant="destructive" size="sm" onClick={() => connectionDeleteMutation.mutate(connection)}>删除</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {modelGatewayConnections.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-4 text-center text-sm text-gray-500">暂无连接别名</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {connectionTestResult && (
              <div className="p-4 rounded-md bg-green-50 border border-green-200 text-green-800 flex gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div>
                  <h4 className="font-medium">别名连接测试通过：{connectionTestResult.response.model}</h4>
                  <p className="text-sm mt-1">{connectionTestResult.response.text}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </PageSection>

      <PageSection title="资源治理" testId="governance-assets-section">
        <Card
          title="Skill 生命周期"
          extra={
            <Input 
              placeholder="搜索 Skill ID 或名称" 
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              className="w-64"
            />
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 border">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Skill</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">合约测试</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">审批信息</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">权限</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">治理动作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSkills.map(skill => {
                  const packageRecord = packageBySkillId[skill.skill_id];
                  const approveDisabled = Boolean(packageRecord && !packageRecord.last_contract_ok);
                  
                  return (
                    <tr key={skill.skill_id}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm"><code className="bg-gray-100 px-1 rounded">{skill.skill_id}</code></td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                          skill.status === 'approved' ? 'bg-green-100 text-green-800' : 
                          skill.status === 'disabled' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {formatSkillStatus(skill.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {!packageRecord ? (
                          <span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs">内置 Skill</span>
                        ) : (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${packageRecord.last_contract_ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {packageRecord.last_contract_ok ? '合约已通过' : '合约未通过'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {!packageRecord ? '-' : `${packageRecord.approved_by ?? '未审批'} / ${packageRecord.approved_at ?? '-'}`}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-1">
                          {skill.permissions.length ? skill.permissions.map(p => (
                            <span key={p} className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs">{p}</span>
                          )) : '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setApprovalSkill(skill)}>审批详情</Button>
                          <Button variant="outline" size="sm" disabled={approveDisabled} onClick={() => skillMutation.mutate({ skill, action: 'approve' })}>启用</Button>
                          <Button variant="outline" size="sm" onClick={() => skillMutation.mutate({ skill, action: 'disable' })}>禁用</Button>
                          <Button variant="destructive" size="sm" onClick={() => skillMutation.mutate({ skill, action: 'deprecate' })}>废弃</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSkills.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-4 text-center text-sm text-gray-500">未找到匹配的 Skill</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <SkillApprovalDrawer
          open={Boolean(approvalSkill)}
          skill={approvalSkill}
          packageRecord={approvalSkill ? packageBySkillId[approvalSkill.skill_id] : undefined}
          loading={skillMutation.isPending}
          onClose={() => setApprovalSkill(null)}
          onApprove={(skill) => skillMutation.mutate({ skill, action: 'approve' })}
        />

        <Card title="审计日志" className="mt-4">
          <div className="max-h-96 overflow-y-auto pr-4 space-y-4">
            {(auditEventsQuery.data ?? []).map((event, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 bg-blue-500 rounded-full mt-1.5" />
                  {i !== (auditEventsQuery.data?.length ?? 0) - 1 && <div className="w-0.5 h-full bg-gray-200 my-1" />}
                </div>
                <div className="pb-4 text-sm">
                  {String(event.action)}：{String(event.target ?? '-')}
                </div>
              </div>
            ))}
            {!(auditEventsQuery.data?.length) && <div className="text-gray-500 text-sm">暂无审计日志</div>}
          </div>
        </Card>
      </PageSection>

      <Modal 
        open={Boolean(disableSkill)} 
        onCancel={() => setDisableSkill(null)} 
        title="停用组件"
      >
        <div className="mt-4">
          <p className="text-sm text-gray-600 mb-4">确定要停用 Skill {disableSkill?.skill_id} 吗？停用后相关业务流程将无法调用该 Skill。</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDisableSkill(null)}>取消</Button>
            <Button variant="destructive" onClick={() => { if(disableSkill) skillMutation.mutate({ skill: disableSkill, action: 'disable' }); setDisableSkill(null); }}>确认停用</Button>
          </div>
        </div>
      </Modal>

      <Modal 
        open={matrixOpen} 
        onCancel={() => setMatrixOpen(false)}
        title="RBAC 权限矩阵"
      >
        <div className="mt-4">
          <table className="min-w-full divide-y divide-gray-200 border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">权限</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {permissionRows.map(row => (
                <tr key={row.key}>
                  <td className="px-4 py-3 text-sm">{row.role}</td>
                  <td className="px-4 py-3 text-sm font-mono text-xs">{row.permissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setMatrixOpen(false)}>关闭</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={modelConfigOpen}
        onCancel={() => setModelConfigOpen(false)}
        title="配置模型网关"
      >
        <div className="mt-4 space-y-6">
          <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
            <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
            <div>
              <h4 className="font-medium">配置会保存到当前 AegisQA 本地存储</h4>
              <p className="text-sm mt-1">长期配置请填写 Secret 引用，例如 env:DEEPSEEK_API_KEY；临时测试 API Key 只用于本次连接测试，不会随保存配置落盘。</p>
            </div>
          </div>
          
          <form 
            id="modelConfigForm" 
            onSubmit={(e) => {
              e.preventDefault();
              modelConfigMutation.mutate(modelForm);
            }} 
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型服务模板</label>
              <select 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={modelForm.model_template ?? ''}
                onChange={(e) => applyTemplateToModelForm(e.target.value)}
              >
                <option value="">选择 DeepSeek / Qwen / OpenAI / 本地兼容服务</option>
                {modelServiceTemplateOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">先选厂商/服务，系统会自动填好 Provider、Base URL、默认模型和 Secret 引用</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Provider <span className="text-red-500">*</span></label>
              <select 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={modelForm.provider}
                onChange={(e) => setModelForm({...modelForm, provider: normalizeModelProvider(e.target.value)})}
                required
              >
                {modelProviderOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Provider 是调用协议类型，不是模型名称；具体模型请在“默认模型”中选择。</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
              <Input 
                placeholder="https://api.openai.com/v1" 
                value={modelForm.base_url ?? ''} 
                onChange={(e) => setModelForm({...modelForm, base_url: e.target.value})} 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Secret 引用</label>
              <Input 
                placeholder="env:DEEPSEEK_API_KEY" 
                value={modelForm.secret_ref ?? ''} 
                onChange={(e) => setModelForm({...modelForm, secret_ref: e.target.value})} 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">临时测试 API Key</label>
              <Input 
                type="password"
                placeholder="可选：仅本次测试使用" 
                value={modelForm.api_key ?? ''} 
                onChange={(e) => setModelForm({...modelForm, api_key: e.target.value})} 
                autoComplete="off"
              />
            </div>

            <div className="flex items-center mt-2">
              <input 
                id="clear_api_key" 
                type="checkbox" 
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                checked={modelForm.clear_api_key}
                onChange={(e) => setModelForm({...modelForm, clear_api_key: e.target.checked})}
              />
              <label htmlFor="clear_api_key" className="ml-2 block text-sm text-gray-900">
                清空当前保存的 Secret 引用
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">默认模型 <span className="text-red-500">*</span></label>
              <select 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={modelForm.default_model}
                onChange={(e) => setModelForm({...modelForm, default_model: e.target.value})}
                required
              >
                {defaultModelOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">超时秒数 <span className="text-red-500">*</span></label>
              <Input 
                type="number"
                min={1}
                max={600}
                value={String(modelForm.timeout_seconds)} 
                onChange={(e) => setModelForm({...modelForm, timeout_seconds: parseInt(e.target.value, 10) || 60})} 
                required
              />
            </div>
          </form>

          <div className="mt-4">
            <textarea
              className="w-full border border-gray-300 rounded-md shadow-sm p-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              rows={3}
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="测试提示词"
            />
          </div>

          {modelTestResult && (
            <div className="p-4 rounded-md bg-green-50 border border-green-200 text-green-800 flex gap-3 mt-4">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <h4 className="font-medium">连接测试通过：{modelTestResult.response.model}</h4>
                <p className="text-sm mt-1">{modelTestResult.response.text}</p>
                <p className="text-xs text-gray-500 mt-1">Provider：{modelTestResult.response.provider}，耗时：{modelTestResult.response.latency_ms.toFixed(1)}ms</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setModelConfigOpen(false)}>关闭</Button>
            <Button variant="outline" onClick={() => modelTestMutation.mutate()}>测试连接</Button>
            <Button variant="default" form="modelConfigForm" type="submit">保存配置</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={connectionModalOpen}
        onCancel={() => { setConnectionModalOpen(false); setEditingConnection(null); }}
        title={editingConnection ? '编辑模型连接' : '新增模型连接'}
      >
        <div className="mt-4 space-y-6">
          <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-md flex gap-3">
            <Info className="w-5 h-5 flex-shrink-0 text-blue-500" />
            <div>
              <h4 className="font-medium">连接配置只保存 Secret 引用</h4>
              <p className="text-sm mt-1">临时测试 API Key 只保留在前端表单中，不会随“保存连接”写入后端 store。</p>
            </div>
          </div>

          <form 
            id="connectionConfigForm" 
            onSubmit={(e) => {
              e.preventDefault();
              connectionSaveMutation.mutate(connectionForm);
            }} 
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接 ID <span className="text-red-500">*</span></label>
              <Input 
                placeholder="deepseek-test" 
                value={connectionForm.connection_id} 
                onChange={(e) => setConnectionForm({...connectionForm, connection_id: e.target.value})} 
                disabled={Boolean(editingConnection)}
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
              <Input 
                placeholder="DeepSeek 测试" 
                value={connectionForm.name ?? ''} 
                onChange={(e) => setConnectionForm({...connectionForm, name: e.target.value})} 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接模型服务模板</label>
              <select 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={connectionForm.model_template ?? ''}
                onChange={(e) => applyTemplateToConnectionForm(e.target.value)}
              >
                <option value="">选择连接模板</option>
                {modelServiceTemplateOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接 Provider <span className="text-red-500">*</span></label>
              <select 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={connectionForm.provider}
                onChange={(e) => setConnectionForm({...connectionForm, provider: normalizeModelProvider(e.target.value)})}
                required
              >
                {modelProviderOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接 Base URL</label>
              <Input 
                placeholder="https://api.example.com/v1" 
                value={connectionForm.base_url ?? ''} 
                onChange={(e) => setConnectionForm({...connectionForm, base_url: e.target.value})} 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接 Secret 引用</label>
              <Input 
                placeholder="env:DEEPSEEK_API_KEY" 
                value={connectionForm.secret_ref ?? ''} 
                onChange={(e) => setConnectionForm({...connectionForm, secret_ref: e.target.value})} 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接临时测试 API Key</label>
              <Input 
                type="password"
                placeholder="可选：仅本次测试使用" 
                value={connectionForm.api_key ?? ''} 
                onChange={(e) => setConnectionForm({...connectionForm, api_key: e.target.value})} 
                autoComplete="off"
              />
            </div>

            <div className="flex items-center mt-2">
              <input 
                id="conn_clear_api_key" 
                type="checkbox" 
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                checked={connectionForm.clear_api_key}
                onChange={(e) => setConnectionForm({...connectionForm, clear_api_key: e.target.checked})}
              />
              <label htmlFor="conn_clear_api_key" className="ml-2 block text-sm text-gray-900">
                清空当前保存的 Secret 引用
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接默认模型 <span className="text-red-500">*</span></label>
              <select 
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={connectionForm.default_model}
                onChange={(e) => setConnectionForm({...connectionForm, default_model: e.target.value})}
                required
              >
                {connectionDefaultModelOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">连接超时秒数 <span className="text-red-500">*</span></label>
              <Input 
                type="number"
                min={1}
                max={600}
                value={String(connectionForm.timeout_seconds)} 
                onChange={(e) => setConnectionForm({...connectionForm, timeout_seconds: parseInt(e.target.value, 10) || 60})} 
                required
              />
            </div>

            <div className="flex items-center mt-2 pt-2">
              <input 
                id="conn_enabled" 
                type="checkbox" 
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                checked={connectionForm.enabled}
                onChange={(e) => setConnectionForm({...connectionForm, enabled: e.target.checked})}
              />
              <label htmlFor="conn_enabled" className="ml-2 block text-sm text-gray-900">
                启用连接
              </label>
            </div>
          </form>

          <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => { setConnectionModalOpen(false); setEditingConnection(null); }}>关闭</Button>
            <Button variant="default" form="connectionConfigForm" type="submit">保存连接</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function indexPackagesBySkillId(packages: SkillPackageRecord[]): Record<string, SkillPackageRecord> {
  // 见 src/lib/skillPackageUtils.ts：与后端 _find_skill_package 对齐，取「未被替换且最新」的记录。
  return packages.reduce<Record<string, SkillPackageRecord>>((index, item) => {
    const skillId = item.manifest.skill_id;
    const current = index[skillId];
    if (!current || isMoreCanonicalPackage(item, current)) {
      index[skillId] = item;
    }
    return index;
  }, {});
}

function formatSkillStatus(status: string): string {
  return {
    approved: '已启用',
    pending_review: '待审批',
    disabled: '已禁用',
    deprecated: '已废弃',
  }[status] ?? status;
}

function formatModelGatewayMode(mode?: string): string {
  return {
    offline_mock: '离线 Mock',
    openai_compatible: 'OpenAI-compatible',
  }[mode ?? ''] ?? (mode || '-');
}

function renderRuntimeStatusTag(status?: string) {
  const isGood = status === 'available' || status === 'configured';
  const isWarn = status === 'not_configured';
  const label = {
    available: '可用',
    configured: '已配置',
    demo: '演示',
    not_configured: '未配置',
    not_connected: '未接入',
  }[status ?? ''] ?? (status || '-');
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${
      isGood ? 'bg-green-100 text-green-800' : 
      isWarn ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
    }`}>
      {label}
    </span>
  );
}

function runtimeStatusLabel(status?: string): string {
  return {
    available: '可用',
    configured: '已配置',
    demo: '演示',
    not_configured: '未配置',
    not_connected: '未接入',
  }[status ?? ''] ?? (status || '-');
}

function buildRuntimeComponents(status?: RuntimeStatus): RuntimeStatusComponent[] {
  if (!status) return [];
  if (Array.isArray(status.components) && status.components.length > 0) {
    return status.components;
  }
  return [
    {
      component_id: 'storage',
      name: '存储后端',
      backend: status.storage?.backend ?? '-',
      status: status.storage?.status ?? 'not_configured',
      status_label: runtimeStatusLabel(status.storage?.status),
      message: status.storage?.message ?? '-',
      doc_url: status.storage?.doc_url ?? '/docs/runtime/storage',
      config_url: status.storage?.config_url ?? '/governance#runtime-storage',
      risk_level: 'medium',
    },
    {
      component_id: 'executor',
      name: '执行器后端',
      backend: status.executor?.backend ?? '-',
      status: status.executor?.status ?? 'not_configured',
      status_label: runtimeStatusLabel(status.executor?.status),
      message: status.executor?.message ?? '-',
      doc_url: status.executor?.doc_url ?? '/docs/runtime/executor',
      config_url: status.executor?.config_url ?? '/governance#runtime-executor',
      risk_level: status.executor?.status === 'configured' ? 'low' : 'medium',
    },
    {
      component_id: 'model_gateway',
      name: '模型网关',
      backend: status.model_gateway?.provider ?? '-',
      status: status.model_gateway?.status ?? 'not_configured',
      status_label: runtimeStatusLabel(status.model_gateway?.status),
      message: status.model_gateway?.message ?? '-',
      doc_url: status.model_gateway?.doc_url ?? '/docs/model-gateway',
      config_url: status.model_gateway?.config_url ?? '/governance#model-gateway',
      risk_level: status.model_gateway?.status === 'available' ? 'low' : 'medium',
    },
    {
      component_id: 'skill_sandbox',
      name: 'Skill 沙箱',
      backend: status.skill_sandbox?.mode ?? '-',
      status: status.skill_sandbox?.status ?? 'not_configured',
      status_label: runtimeStatusLabel(status.skill_sandbox?.status),
      message: status.skill_sandbox?.message ?? '-',
      doc_url: status.skill_sandbox?.doc_url ?? '/docs/skills/sandbox',
      config_url: status.skill_sandbox?.config_url ?? '/governance#skill-sandbox',
      risk_level: 'medium',
    },
    {
      component_id: 'mysql',
      name: 'MySQL',
      backend: 'mysql',
      status: status.external_services?.mysql?.status ?? 'not_connected',
      status_label: runtimeStatusLabel(status.external_services?.mysql?.status ?? 'not_connected'),
      message: status.external_services?.mysql?.message ?? '当前运行未使用 MySQL repository。',
      doc_url: status.external_services?.mysql?.doc_url ?? '/docs/runtime/mysql',
      config_url: status.external_services?.mysql?.config_url ?? '/governance#runtime-storage',
      risk_level: 'info',
    },
    {
      component_id: 'redis',
      name: 'Redis',
      backend: 'redis',
      status: status.external_services?.redis?.status ?? 'not_connected',
      status_label: runtimeStatusLabel(status.external_services?.redis?.status ?? 'not_connected'),
      message: status.external_services?.redis?.message ?? '当前运行未连接 Redis。',
      doc_url: status.external_services?.redis?.doc_url ?? '/docs/runtime/redis',
      config_url: status.external_services?.redis?.config_url ?? '/governance#runtime-executor',
      risk_level: 'info',
    },
    {
      component_id: 'celery',
      name: 'Celery',
      backend: 'celery',
      status: status.external_services?.celery?.status ?? 'not_connected',
      status_label: runtimeStatusLabel(status.external_services?.celery?.status ?? 'not_connected'),
      message: status.external_services?.celery?.message ?? '当前未使用 Celery worker 执行任务。',
      doc_url: status.external_services?.celery?.doc_url ?? '/docs/runtime/celery',
      config_url: status.external_services?.celery?.config_url ?? '/governance#runtime-executor',
      risk_level: status.external_services?.celery?.status === 'configured' ? 'low' : 'info',
    },
  ];
}

function buildDefaultModelOptions(templateValue?: string, currentValue?: string, searchValue = '') {
  const template = modelServiceTemplates.find((item) => item.value === templateValue);
  const candidates = [
    ...(template?.default_models ?? modelServiceTemplates.flatMap((item) => item.default_models)),
    currentValue,
  ];
  const uniqueCandidates = Array.from(new Set(candidates.filter((item): item is string => Boolean(item?.trim()))));
  return uniqueCandidates.map((model) => ({
    value: model,
    label: model,
  }));
}

function buildConnectionPayload(values: ModelGatewayConnectionFormValues) {
  return {
    connection_id: values.connection_id.trim(),
    name: values.name?.trim() || null,
    provider: normalizeModelProvider(values.provider),
    base_url: values.base_url?.trim() || null,
    secret_ref: values.clear_api_key ? null : values.secret_ref?.trim() || null,
    default_model: values.default_model,
    timeout_seconds: Number(values.timeout_seconds ?? 60),
    enabled: Boolean(values.enabled),
    clear_api_key: Boolean(values.clear_api_key),
  };
}

function normalizeModelProvider(provider?: string | null): string {
  const normalized = provider?.trim();
  if (normalized && modelProviderValues.has(normalized)) {
    return normalized;
  }
  if (normalized) {
    return 'openai_compatible';
  }
  return 'mock';
}

function normalizeDefaultModelFromProvider(provider?: string | null, defaultModel?: string | null, fallback = 'mock-eval-model'): string {
  const normalizedProvider = provider?.trim();
  if (normalizedProvider && !modelProviderValues.has(normalizedProvider)) {
    return normalizedProvider;
  }
  return defaultModel?.trim() || fallback;
}

function formatModelGatewaySource(source?: string): string {
  return {
    store: '前端本地配置',
    env: '后端环境变量',
    runtime: '运行期配置',
  }[source ?? ''] ?? (source || '-');
}
