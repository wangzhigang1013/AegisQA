import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { SkillApprovalDrawer } from './skills/SkillApprovalDrawer';
import type { ModelGatewayConfig, ModelGatewayConnection, ModelGatewayTestResult, RuntimeStatus, RuntimeStatusComponent, SkillManifest, SkillPackageRecord } from '../types';

const permissionRows = [
  { key: 'admin', role: 'admin', permissions: 'workflow:publish, run:control, skill:governance, audit:read' },
  { key: 'evaluator', role: 'evaluator', permissions: 'dataset:write, workflow:write, run:create, report:read, report:export' },
  { key: 'reviewer', role: 'reviewer', permissions: 'badcase:correct, judge:audit, report:read, report:export' },
];

const modelProviderOptions = [
  { value: 'mock', label: '离线 Mock（不调用真实模型）' },
  { value: 'openai_compatible', label: '真实模型服务（OpenAI-compatible）' },
];
const modelProviderValues = new Set(modelProviderOptions.map((option) => option.value));

// 模型服务模板负责把“厂商/服务”翻译成底层协议配置，避免用户把模型名误填到 Provider。
// default_models 是常用候选；搜索只用于过滤候选，避免把任意模型名误存到 Provider 或默认模型里。
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

export function GovernancePage() {
  const queryClient = useQueryClient();
  const [modelForm] = Form.useForm<ModelGatewayConfigFormValues>();
  const [connectionForm] = Form.useForm<ModelGatewayConnectionFormValues>();
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [approvalSkill, setApprovalSkill] = useState<SkillManifest | null>(null);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ModelGatewayConnection | null>(null);
  const [testPrompt, setTestPrompt] = useState('用一句话介绍 AegisQA。');
  const [connectionTestPrompt] = useState('用一句话介绍当前模型连接。');
  const [modelSearchValue, setModelSearchValue] = useState('');
  const [connectionModelSearchValue, setConnectionModelSearchValue] = useState('');
  const [modelTestResult, setModelTestResult] = useState<ModelGatewayTestResult | null>(null);
  const [connectionTestResult, setConnectionTestResult] = useState<ModelGatewayTestResult | null>(null);
  const selectedModelTemplate = Form.useWatch('model_template', modelForm);
  const selectedDefaultModel = Form.useWatch('default_model', modelForm);
  const selectedConnectionTemplate = Form.useWatch('model_template', connectionForm);
  const selectedConnectionDefaultModel = Form.useWatch('default_model', connectionForm);
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
      const temporaryApiKey = modelForm.getFieldValue('api_key');
      setNotice(`模型网关配置已保存：${config.provider} / ${config.default_model}`);
      hydrateModelForm(modelForm, config);
      modelForm.setFieldsValue({ api_key: temporaryApiKey });
      setModelTestResult(null);
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
        model: modelForm.getFieldValue('default_model'),
        temperature: 0.2,
        max_tokens: 200,
        api_key: modelForm.getFieldValue('api_key')?.trim() || undefined,
        secret_ref: modelForm.getFieldValue('secret_ref')?.trim() || undefined,
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

  const openModelConfig = () => {
    hydrateModelForm(modelForm, modelGatewayConfigQuery.data);
    setModelConfigOpen(true);
    setModelTestResult(null);
  };

  const openConnectionModal = (connection?: ModelGatewayConnection) => {
    setEditingConnection(connection ?? null);
    hydrateConnectionForm(connectionForm, connection);
    setConnectionModalOpen(true);
    setConnectionTestResult(null);
  };

  const applyTemplateToModelForm = (templateValue?: string) => {
    const template = modelServiceTemplates.find((item) => item.value === templateValue);
    if (!template) return;
    modelForm.setFieldsValue({
      provider: template.provider,
      base_url: template.base_url,
      secret_ref: template.secret_ref,
      default_model: template.default_model,
    });
    setModelSearchValue('');
  };

  const applyTemplateToConnectionForm = (templateValue?: string) => {
    const template = modelServiceTemplates.find((item) => item.value === templateValue);
    if (!template) return;
    connectionForm.setFieldsValue({
      provider: template.provider,
      base_url: template.base_url,
      secret_ref: template.secret_ref,
      default_model: template.default_model,
    });
    setConnectionModelSearchValue('');
  };

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="平台治理"
        title="治理与审计"
        description="管理 RBAC、Skill 生命周期和审计日志。生产适配说明保留在部署文档中，不作为当前页面的可操作状态。"
        primaryAction={<Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setMatrixOpen(true)}>查看权限矩阵</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="运行状态与生产边界" loading={runtimeStatusQuery.isLoading}>
        <Space direction="vertical" className="full-width-control" size={12}>
          <Typography.Title level={5}>运行态驾驶舱</Typography.Title>
          <Table
            rowKey="component_id"
            size="small"
            pagination={false}
            dataSource={runtimeComponents}
            scroll={{ x: 960 }}
            columns={[
              {
                title: '组件',
                dataIndex: 'name',
                width: 130,
                render: (value: string, record: RuntimeStatusComponent) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary" code>{record.component_id}</Typography.Text>
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value: string) => renderRuntimeStatusTag(value),
              },
              {
                title: '后端/模式',
                dataIndex: 'backend',
                width: 140,
                render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
              },
              {
                title: '说明',
                dataIndex: 'message',
                render: (value: string) => <Typography.Text>{value}</Typography.Text>,
              },
              {
                title: '入口',
                key: 'links',
                width: 150,
                render: (_: unknown, record: RuntimeStatusComponent) => (
                  <Space size={4} wrap>
                    <Button size="small" href={record.doc_url} aria-label={`${record.name}文档`}>
                      文档
                    </Button>
                    {record.config_url ? (
                      <Button size="small" href={record.config_url} aria-label={`${record.name}配置`}>
                        配置
                      </Button>
                    ) : null}
                  </Space>
                ),
              },
            ]}
          />
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="存储后端">
              <Space>
                <Typography.Text code>{runtimeStatusQuery.data?.storage?.backend ?? '-'}</Typography.Text>
                {renderRuntimeStatusTag(runtimeStatusQuery.data?.storage?.status)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="执行器">
              <Space>
                <Typography.Text code>{runtimeStatusQuery.data?.executor?.backend ?? '-'}</Typography.Text>
                {renderRuntimeStatusTag(runtimeStatusQuery.data?.executor?.status)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="模型网关">
              <Space>
                <Typography.Text code>{runtimeStatusQuery.data?.model_gateway?.provider ?? '-'}</Typography.Text>
                {renderRuntimeStatusTag(runtimeStatusQuery.data?.model_gateway?.status)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Skill 沙箱">
              <Space>
                <Typography.Text code>{runtimeStatusQuery.data?.skill_sandbox?.mode ?? '-'}</Typography.Text>
                {renderRuntimeStatusTag(runtimeStatusQuery.data?.skill_sandbox?.status)}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="MySQL">{renderRuntimeStatusTag(runtimeStatusQuery.data?.external_services?.mysql?.status)} {runtimeStatusQuery.data?.external_services?.mysql?.message ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Redis">{renderRuntimeStatusTag(runtimeStatusQuery.data?.external_services?.redis?.status)} {runtimeStatusQuery.data?.external_services?.redis?.message ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Celery">{renderRuntimeStatusTag(runtimeStatusQuery.data?.external_services?.celery?.status)} {runtimeStatusQuery.data?.external_services?.celery?.message ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="沙箱限制">
              {runtimeStatusQuery.data?.skill_sandbox
                ? `${runtimeStatusQuery.data.skill_sandbox.network_default} / ${runtimeStatusQuery.data.skill_sandbox.file_scope} / ${runtimeStatusQuery.data.skill_sandbox.limits.max_files} files`
                : '-'}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Text type="secondary">
            当前状态来自后端运行时事实，不把 MySQL、Redis 或 Celery 占位资产展示为已启用。
          </Typography.Text>
        </Space>
      </Card>

      <Card
        className="flat-card"
        title="模型接入"
        loading={modelGatewayQuery.isLoading || modelGatewayConfigQuery.isLoading}
        extra={<Button type="primary" onClick={openModelConfig}>配置模型网关</Button>}
      >
        <Space direction="vertical" className="full-width-control" size={12}>
          <Alert
            type={modelGatewayQuery.data?.ready ? 'success' : 'warning'}
            showIcon
            message="统一模型网关"
            description="业务 Skill 可以直接复用模型调用节点，不需要在每个 Skill 里重复实现模型 API、鉴权、超时和返回解析。"
          />
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="推荐 Skill">{modelGatewayQuery.data?.skill_ref ? <Typography.Text code>{modelGatewayQuery.data.skill_ref}</Typography.Text> : '-'}</Descriptions.Item>
            <Descriptions.Item label="Provider">{modelGatewayQuery.data?.provider ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="默认模型">{modelGatewayQuery.data?.default_model ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="模式">{formatModelGatewayMode(modelGatewayQuery.data?.mode)}</Descriptions.Item>
            <Descriptions.Item label="Base URL">{modelGatewayConfigQuery.data?.base_url ?? (modelGatewayQuery.data?.base_url_configured ? '已配置' : '未配置')}</Descriptions.Item>
            <Descriptions.Item label="Secret 引用">{modelGatewayConfigQuery.data?.secret_ref ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="API Key">{modelGatewayConfigQuery.data?.api_key_masked ?? (modelGatewayQuery.data?.api_key_configured ? '已配置' : '未配置或本地模型无需 Key')}</Descriptions.Item>
            <Descriptions.Item label="超时">{modelGatewayQuery.data ? `${modelGatewayQuery.data.timeout_seconds} 秒` : '-'}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={modelGatewayQuery.data?.ready ? 'green' : 'gold'}>{modelGatewayQuery.data?.ready ? '可用' : '未配置真实模型'}</Tag></Descriptions.Item>
            <Descriptions.Item label="配置来源">{formatModelGatewaySource(modelGatewayConfigQuery.data?.source)}</Descriptions.Item>
          </Descriptions>
          <Typography.Text type="secondary">
            真实模型接入只保存 Secret 引用；API Key 可作为临时测试密钥使用，不会写入本地 store。
          </Typography.Text>
        </Space>
      </Card>

      <Card
        className="flat-card"
        title="模型连接别名"
        loading={modelGatewayConnectionsQuery.isLoading}
        extra={<Button type="primary" onClick={() => openConnectionModal()}>新增模型连接</Button>}
      >
        <Space direction="vertical" className="full-width-control" size={12}>
          <Typography.Text type="secondary">
            连接别名用于 Workflow 参数里的 <Typography.Text code>model_connection_id</Typography.Text>，任务快照只记录别名、模型名和脱敏 Secret 引用。
          </Typography.Text>
          <Table
            rowKey="connection_id"
            pagination={{ pageSize: 5 }}
            dataSource={modelGatewayConnections}
            columns={[
              { title: '连接 ID', dataIndex: 'connection_id', render: (value) => <Typography.Text code>{value}</Typography.Text> },
              { title: '显示名称', dataIndex: 'name', render: (value, record) => value || record.connection_id },
              { title: 'Provider', dataIndex: 'provider' },
              { title: '默认模型', dataIndex: 'default_model' },
              { title: 'Secret', render: (_, record) => record.secret_ref ?? record.api_key_masked ?? '-' },
              { title: '状态', dataIndex: 'enabled', render: (enabled) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag> },
              {
                title: '操作',
                render: (_, connection) => (
                  <Space wrap>
                    <Button aria-label="编辑" size="small" onClick={() => openConnectionModal(connection)}>编辑</Button>
                    <Button aria-label="测试" size="small" loading={connectionTestMutation.isPending} onClick={() => connectionTestMutation.mutate(connection)}>测试</Button>
                    <Button aria-label="删除" size="small" danger loading={connectionDeleteMutation.isPending} onClick={() => connectionDeleteMutation.mutate(connection)}>删除</Button>
                  </Space>
                ),
              },
            ]}
          />
          {connectionTestResult ? (
            <Alert
              type="success"
              showIcon
              message={`别名连接测试通过：${connectionTestResult.response.model}`}
              description={connectionTestResult.response.text}
            />
          ) : null}
        </Space>
      </Card>

      <Card
        className="flat-card"
        title="Skill 生命周期"
        extra={<Input.Search allowClear placeholder="搜索 Skill ID 或名称" className="wide-search" onSearch={setSkillQuery} onChange={(event) => setSkillQuery(event.target.value)} />}
      >
        <Table
          rowKey="skill_id"
          pagination={{ pageSize: 6 }}
          loading={skillsQuery.isLoading}
          dataSource={filteredSkills}
          columns={[
            { title: 'Skill', dataIndex: 'skill_id', render: (value) => <code>{value}</code> },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'approved' ? 'green' : value === 'disabled' ? 'orange' : 'red'}>{formatSkillStatus(value)}</Tag> },
            {
              title: '合约测试',
              render: (_, skill) => {
                const packageRecord = packageBySkillId[skill.skill_id];
                if (!packageRecord) return <Tag>内置 Skill</Tag>;
                return <Tag color={packageRecord.last_contract_ok ? 'green' : 'red'}>{packageRecord.last_contract_ok ? '合约已通过' : '合约未通过'}</Tag>;
              },
            },
            {
              title: '审批信息',
              render: (_, skill) => {
                const packageRecord = packageBySkillId[skill.skill_id];
                if (!packageRecord) return '-';
                return `${packageRecord.approved_by ?? '未审批'} / ${packageRecord.approved_at ?? '-'}`;
              },
            },
            { title: '权限', dataIndex: 'permissions', render: (value: string[]) => value.length ? value.map((item) => <Tag key={item}>{item}</Tag>) : '-' },
            {
              title: '治理动作',
              render: (_, skill) => {
                const packageRecord = packageBySkillId[skill.skill_id];
                const approveDisabled = Boolean(packageRecord && !packageRecord.last_contract_ok);
                return (
                  <Space wrap>
                    <Button size="small" onClick={() => setApprovalSkill(skill)}>审批详情</Button>
                    <Tooltip title={approveDisabled ? '未通过合约测试不能启用' : ''}>
                      <Button size="small" disabled={approveDisabled} loading={skillMutation.isPending} onClick={() => skillMutation.mutate({ skill, action: 'approve' })}>启用</Button>
                    </Tooltip>
                    <Button size="small" loading={skillMutation.isPending} onClick={() => skillMutation.mutate({ skill, action: 'disable' })}>禁用</Button>
                    <Button size="small" danger loading={skillMutation.isPending} onClick={() => skillMutation.mutate({ skill, action: 'deprecate' })}>废弃</Button>
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <SkillApprovalDrawer
        open={Boolean(approvalSkill)}
        skill={approvalSkill}
        packageRecord={approvalSkill ? packageBySkillId[approvalSkill.skill_id] : undefined}
        loading={skillMutation.isPending}
        onClose={() => setApprovalSkill(null)}
        onApprove={(skill) => skillMutation.mutate({ skill, action: 'approve' })}
      />

      <Card className="flat-card" title="审计日志">
        <Timeline
          items={(auditEventsQuery.data ?? []).map((event) => ({
            color: 'blue',
            children: `${String(event.action)}：${String(event.target ?? '-')}`,
          }))}
        />
      </Card>

      <Modal title="RBAC 权限矩阵" open={matrixOpen} onCancel={() => setMatrixOpen(false)} footer={<Button type="primary" onClick={() => setMatrixOpen(false)}>关闭</Button>}>
        <Table
          rowKey="key"
          pagination={false}
          dataSource={permissionRows}
          columns={[
            { title: '角色', dataIndex: 'role' },
            { title: '权限', dataIndex: 'permissions' },
          ]}
        />
      </Modal>

      <Modal
        title="配置模型网关"
        open={modelConfigOpen}
        onCancel={() => setModelConfigOpen(false)}
        footer={[
          <Button key="close" onClick={() => setModelConfigOpen(false)}>关闭</Button>,
          <Button key="test" loading={modelTestMutation.isPending} onClick={() => modelTestMutation.mutate()}>测试连接</Button>,
          <Button key="save" type="primary" loading={modelConfigMutation.isPending} onClick={() => modelForm.submit()}>保存配置</Button>,
        ]}
      >
        <Space direction="vertical" size={12} className="full-width-control">
          <Alert
            type="info"
            showIcon
            message="配置会保存到当前 AegisQA 本地存储"
            description="长期配置请填写 Secret 引用，例如 env:DEEPSEEK_API_KEY；临时测试 API Key 只用于本次连接测试，不会随保存配置落盘。"
          />
          <Form
            form={modelForm}
            layout="vertical"
            onFinish={(values) => modelConfigMutation.mutate(values)}
            initialValues={{
              model_template: undefined,
              provider: 'mock',
              base_url: '',
              secret_ref: '',
              api_key: '',
              default_model: 'mock-eval-model',
              timeout_seconds: 60,
              clear_api_key: false,
            }}
          >
            <Form.Item
              label="模型服务模板"
              name="model_template"
              tooltip="先选厂商/服务，系统会自动填好 Provider、Base URL、默认模型和 Secret 引用；默认模型只能从下拉候选中选择。"
            >
              <Select
                allowClear
                options={modelServiceTemplateOptions}
                optionFilterProp="label"
                showSearch
                placeholder="选择 DeepSeek / Qwen / OpenAI / 本地兼容服务"
                onChange={(value) => applyTemplateToModelForm(value)}
              />
            </Form.Item>
            <Form.Item label="Provider" name="provider" rules={[{ required: true, message: '请选择模型 Provider。' }]}>
              <Select
                options={modelProviderOptions}
                optionFilterProp="label"
                showSearch
                onChange={(value) => modelForm.setFieldsValue({ provider: normalizeModelProvider(value) })}
                placeholder="选择模型调用协议"
              />
            </Form.Item>
            <Typography.Text type="secondary">
              Provider 是调用协议类型，不是模型名称；DeepSeek、Qwen、GPT 等具体模型请在“默认模型”下拉中选择。
            </Typography.Text>
            <Form.Item label="Base URL" name="base_url" tooltip="例如 https://api.openai.com/v1，或本地 OpenAI-compatible 服务地址。">
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item label="Secret 引用" name="secret_ref" tooltip="例如 env:DEEPSEEK_API_KEY。后端会从环境变量或 .env 解析真实密钥。">
              <Input placeholder="env:DEEPSEEK_API_KEY" />
            </Form.Item>
            <Form.Item label="临时测试 API Key" name="api_key" tooltip="只用于点击“测试连接”的本次请求，保存配置时不会写入本地 store。">
              <Input.Password placeholder="可选：仅本次测试使用" autoComplete="off" />
            </Form.Item>
            <Form.Item name="clear_api_key" valuePropName="checked">
              <Checkbox>清空当前保存的 Secret 引用</Checkbox>
            </Form.Item>
            <Form.Item label="默认模型" name="default_model" rules={[{ required: true, message: '请选择默认模型名称。' }]}>
              <Select
                showSearch
                options={defaultModelOptions}
                optionFilterProp="label"
                placeholder="从候选模型中选择"
                onSearch={setModelSearchValue}
                onBlur={() => setModelSearchValue('')}
                notFoundContent={modelSearchValue ? `没有匹配的候选模型：${modelSearchValue}` : '请选择模型服务模板'}
              />
            </Form.Item>
            <Form.Item label="超时秒数" name="timeout_seconds" rules={[{ required: true, message: '请填写超时时间。' }]}>
              <InputNumber min={1} max={600} className="full-width-control" />
            </Form.Item>
          </Form>
          <Input.TextArea
            aria-label="连接测试提示词"
            rows={3}
            value={testPrompt}
            onChange={(event) => setTestPrompt(event.target.value)}
          />
          {modelTestResult ? (
            <Alert
              type="success"
              showIcon
              message={`连接测试通过：${modelTestResult.response.model}`}
              description={
                <Space direction="vertical" size={4}>
                  <Typography.Text>{modelTestResult.response.text}</Typography.Text>
                  <Typography.Text type="secondary">Provider：{modelTestResult.response.provider}，耗时：{modelTestResult.response.latency_ms.toFixed(1)}ms</Typography.Text>
                </Space>
              }
            />
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={editingConnection ? '编辑模型连接' : '新增模型连接'}
        open={connectionModalOpen}
        onCancel={() => {
          setConnectionModalOpen(false);
          setEditingConnection(null);
        }}
        footer={[
          <Button key="close" onClick={() => setConnectionModalOpen(false)}>关闭</Button>,
          <Button key="save" type="primary" loading={connectionSaveMutation.isPending} onClick={() => connectionForm.submit()}>保存连接</Button>,
        ]}
      >
        <Space direction="vertical" size={12} className="full-width-control">
          <Alert
            type="info"
            showIcon
            message="连接配置只保存 Secret 引用"
            description="临时测试 API Key 只保留在前端表单中，不会随“保存连接”写入后端 store。"
          />
          <Form
            form={connectionForm}
            layout="vertical"
            onFinish={(values) => connectionSaveMutation.mutate(values)}
            initialValues={{
              model_template: undefined,
              provider: 'mock',
              base_url: '',
              secret_ref: '',
              api_key: '',
              default_model: 'mock-eval-model',
              timeout_seconds: 60,
              enabled: true,
              clear_api_key: false,
            }}
          >
            <Form.Item label="连接 ID" name="connection_id" rules={[{ required: true, message: '请填写连接 ID。' }]}>
              <Input disabled={Boolean(editingConnection)} placeholder="deepseek-test" />
            </Form.Item>
            <Form.Item label="显示名称" name="name">
              <Input placeholder="DeepSeek 测试" />
            </Form.Item>
            <Form.Item
              label="连接模型服务模板"
              name="model_template"
              tooltip="选择后自动填充连接 Provider、Base URL、默认模型和 Secret 引用。"
            >
              <Select
                allowClear
                options={modelServiceTemplateOptions}
                optionFilterProp="label"
                showSearch
                placeholder="选择连接模板"
                onChange={(value) => applyTemplateToConnectionForm(value)}
              />
            </Form.Item>
            <Form.Item label="连接 Provider" name="provider" rules={[{ required: true, message: '请选择模型 Provider。' }]}>
              <Select
                options={modelProviderOptions}
                optionFilterProp="label"
                showSearch
                onChange={(value) => connectionForm.setFieldsValue({ provider: normalizeModelProvider(value) })}
              />
            </Form.Item>
            <Form.Item label="连接 Base URL" name="base_url">
              <Input placeholder="https://api.example.com/v1" />
            </Form.Item>
            <Form.Item label="连接 Secret 引用" name="secret_ref">
              <Input placeholder="env:DEEPSEEK_API_KEY" />
            </Form.Item>
            <Form.Item label="连接临时测试 API Key" name="api_key" tooltip="本字段只用于后续扩展测试，不会保存。">
              <Input.Password placeholder="可选：仅本次测试使用" autoComplete="off" />
            </Form.Item>
            <Form.Item name="clear_api_key" valuePropName="checked">
              <Checkbox>清空当前保存的 Secret 引用</Checkbox>
            </Form.Item>
            <Form.Item label="连接默认模型" name="default_model" rules={[{ required: true, message: '请选择默认模型名称。' }]}>
              <Select
                showSearch
                options={connectionDefaultModelOptions}
                optionFilterProp="label"
                placeholder="从候选模型中选择"
                onSearch={setConnectionModelSearchValue}
                onBlur={() => setConnectionModelSearchValue('')}
                notFoundContent={connectionModelSearchValue ? `没有匹配的候选模型：${connectionModelSearchValue}` : '请选择连接模板'}
              />
            </Form.Item>
            <Form.Item label="连接超时秒数" name="timeout_seconds" rules={[{ required: true, message: '请填写超时时间。' }]}>
              <InputNumber min={1} max={600} className="full-width-control" />
            </Form.Item>
            <Form.Item name="enabled" valuePropName="checked">
              <Checkbox>启用连接</Checkbox>
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </section>
  );
}

function indexPackagesBySkillId(packages: SkillPackageRecord[]): Record<string, SkillPackageRecord> {
  return packages.reduce<Record<string, SkillPackageRecord>>((index, item) => {
    index[item.manifest.skill_id] = item;
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
  const color = {
    available: 'green',
    configured: 'green',
    demo: 'blue',
    not_configured: 'gold',
    not_connected: 'default',
  }[status ?? ''] ?? 'default';
  const label = {
    available: '可用',
    configured: '已配置',
    demo: '演示',
    not_configured: '未配置',
    not_connected: '未接入',
  }[status ?? ''] ?? (status || '-');
  return <Tag color={color}>{label}</Tag>;
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

type ModelServiceTemplate = {
  value: string;
  label: string;
  provider: string;
  base_url: string;
  secret_ref: string;
  default_model: string;
  default_models: string[];
};

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

function hydrateModelForm(form: ReturnType<typeof Form.useForm<ModelGatewayConfigFormValues>>[0], config?: ModelGatewayConfig) {
  const migratedModel = normalizeDefaultModelFromProvider(config?.provider, config?.default_model, 'mock-eval-model');
  form.setFieldsValue({
    model_template: undefined,
    provider: normalizeModelProvider(config?.provider),
    base_url: config?.base_url ?? '',
    secret_ref: config?.secret_ref ?? '',
    api_key: '',
    default_model: migratedModel,
    timeout_seconds: config?.timeout_seconds ?? 60,
    clear_api_key: false,
  });
}

function hydrateConnectionForm(form: ReturnType<typeof Form.useForm<ModelGatewayConnectionFormValues>>[0], connection?: ModelGatewayConnection | null) {
  const migratedModel = normalizeDefaultModelFromProvider(connection?.provider, connection?.default_model, 'mock-eval-model');
  form.setFieldsValue({
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
  // 历史版本允许用户把 deepseek-v4-flash 这类模型名误填到 Provider。
  // 只要 Provider 不是平台支持的协议值，就统一迁移到 OpenAI-compatible 协议，避免再次提交坏配置。
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
