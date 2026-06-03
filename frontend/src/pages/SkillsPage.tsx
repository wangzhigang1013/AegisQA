import { CheckCircleOutlined, InboxOutlined, InfoCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { demoSkills } from '../data/demo';
import type { PromptDebugResult, SkillContractResult, SkillManifest, SkillPackageRecord } from '../types';

type UploadFormValues = {
  filename: string;
};

export function SkillsPage() {
  const queryClient = useQueryClient();
  const [activeSkill, setActiveSkill] = useState<SkillManifest | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [skillQuery, setSkillQuery] = useState('');
  const [contractResultText, setContractResultText] = useState<string | null>(null);
  const [contractResult, setContractResult] = useState<SkillContractResult | null>(null);
  const [promptDebugResult, setPromptDebugResult] = useState<PromptDebugResult | null>(null);
  const [form] = Form.useForm<UploadFormValues>();

  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const packagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const skills = skillsQuery.data?.length ? skillsQuery.data : demoSkills;
  const packageBySkillId = useMemo(() => indexPackagesBySkillId(packagesQuery.data ?? []), [packagesQuery.data]);
  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    return skills.filter((skill) => {
      const matchesStatus = statusFilter === 'all' || skill.status === statusFilter;
      const matchesQuery = !query || `${skill.skill_id} ${skill.name} ${skill.tags.join(' ')}`.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [skillQuery, skills, statusFilter]);

  const uploadMutation = useMutation({
    mutationFn: async (values: UploadFormValues) => {
      const selectedFile = getSelectedFile(uploadFile);
      if (!selectedFile) {
        throw new Error('请选择 zip 插件包。');
      }
      const content_base64 = await readFileBase64(selectedFile);
      return api.uploadSkillPackage({ filename: values.filename || selectedFile.name, content_base64 });
    },
    onSuccess: async (record) => {
      setNotice(`插件包已上传：${record.manifest.skill_id}，当前状态 ${record.status}`);
      setUploadOpen(false);
      setUploadFile(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
    },
    onError: (error) => setNotice(`上传失败：${formatApiError(error)}`),
  });

  const contractMutation = useMutation({
    mutationFn: (skillId: string) => api.contractTest(skillId),
    onSuccess: (result) => {
      const text = result.ok ? `合约测试通过：${result.skill_id}` : `合约测试失败：${result.message ?? result.error ?? '未知错误'}`;
      setContractResult(result);
      setContractResultText(text);
      setNotice(text);
      void queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
    },
    onError: (error) => {
      setContractResult(null);
      setContractResultText(`合约测试失败：${formatApiError(error)}`);
    },
  });

  const promptDebugMutation = useMutation({
    mutationFn: ({ skill, promptName }: { skill: SkillManifest; promptName: string }) =>
      api.promptDebug(skill.skill_id, skill.version, promptName, {
        variables: skill.example_input,
        trigger_reason: 'skill_detail_debug',
      }) as Promise<PromptDebugResult>,
    onSuccess: (result) => {
      setPromptDebugResult(result);
      setNotice(`Prompt Debug 完成：${result.prompt_name}`);
    },
    onError: (error) => {
      setPromptDebugResult(null);
      setNotice(`Prompt Debug 失败：${formatApiError(error)}`);
    },
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="能力市场"
        title="Skill 市场"
        description="上传、审批和管理可被 Workflow 引用的 Skill。插件包默认待审批，合约测试通过后才能进入流程。"
        primaryAction={<Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传 Skill 插件包</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="筛选">
        <Space wrap>
          <Input.Search
            placeholder="搜索 Skill 名称或 ID"
            allowClear
            className="wide-search"
            onSearch={setSkillQuery}
            onChange={(event) => setSkillQuery(event.target.value)}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'approved', label: 'approved' },
              { value: 'pending_review', label: 'pending_review' },
              { value: 'disabled', label: 'disabled' },
              { value: 'deprecated', label: 'deprecated' },
            ]}
          />
        </Space>
      </Card>

      <Card className="flat-card" title="Skill 列表">
        <Table
          rowKey="skill_id"
          loading={skillsQuery.isLoading}
          dataSource={filteredSkills}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: 'Skill', dataIndex: 'skill_id', render: (value, record) => <Space direction="vertical" size={0}><Typography.Text strong>{record.name}</Typography.Text><code>{value}</code></Space> },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value, record) => (
                <Space wrap>
                  <Tag color={record.enabled ? 'green' : 'orange'}>{formatSkillStatus(value)}</Tag>
                  {!record.enabled ? <Tag>未启用</Tag> : null}
                </Space>
              ),
            },
            {
              title: '合约测试',
              render: (_, record) => {
                const packageRecord = packageBySkillId[record.skill_id];
                if (!packageRecord) return <Tag>内置 Skill</Tag>;
                return <Tag color={packageRecord.last_contract_ok ? 'green' : 'red'}>{packageRecord.last_contract_ok ? '合约已通过' : '合约未通过'}</Tag>;
              },
            },
            {
              title: '审批人',
              render: (_, record) => {
                const packageRecord = packageBySkillId[record.skill_id];
                return packageRecord ? (packageRecord.approved_by ?? '未审批') : '-';
              },
            },
            {
              title: '审批时间',
              render: (_, record) => {
                const packageRecord = packageBySkillId[record.skill_id];
                return packageRecord ? (packageRecord.approved_at ?? '-') : '-';
              },
            },
            { title: '标签', dataIndex: 'tags', render: (tags: string[]) => <Space wrap>{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space> },
            { title: '权限', dataIndex: 'permissions', render: (items: string[]) => <Space wrap>{items.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}</Space> },
            { title: '插件包', render: (_, record) => (packageBySkillId[record.skill_id] ? <Tag color="purple">package</Tag> : <Tag>builtin</Tag>) },
            {
              title: '操作',
              render: (_, record) => (
                <Button
                  icon={<InfoCircleOutlined />}
                  onClick={() => {
                    setContractResultText(null);
                    setContractResult(null);
                    setPromptDebugResult(null);
                    setActiveSkill(record);
                  }}
                >
                  查看详情
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Drawer width={680} title={activeSkill?.name} open={Boolean(activeSkill)} onClose={() => setActiveSkill(null)}>
        {activeSkill ? (
          <Space direction="vertical" size="large" className="drawer-stack">
            <Typography.Paragraph>{activeSkill.description}</Typography.Paragraph>
            <Card size="small" title="合约测试做什么">
              <Typography.Paragraph>
                使用 Skill manifest 里的 example_input 和 example_config 执行一次 Skill，验证输入 schema、输出 schema、handler 返回结构和基础运行是否正常。
              </Typography.Paragraph>
            </Card>
            {packageBySkillId[activeSkill.skill_id] ? (
              <>
                <Card size="small" title="插件启用步骤">
                  <Space direction="vertical">
                    <Typography.Text>第 1 步：上传插件包</Typography.Text>
                    <Typography.Text>第 2 步：运行合约测试</Typography.Text>
                    <Typography.Text>第 3 步：治理页审批启用</Typography.Text>
                    <Typography.Text>第 4 步：Workflow 画布中搜索并添加</Typography.Text>
                  </Space>
                </Card>
                <Card size="small" title="插件审批状态">
                  <Space wrap>
                    <Tag color={packageBySkillId[activeSkill.skill_id].last_contract_ok ? 'green' : 'red'}>
                      {packageBySkillId[activeSkill.skill_id].last_contract_ok ? '合约已通过' : '合约未通过'}
                    </Tag>
                    <Typography.Text>审批人：{packageBySkillId[activeSkill.skill_id].approved_by ?? '未审批'}</Typography.Text>
                    <Typography.Text>审批时间：{packageBySkillId[activeSkill.skill_id].approved_at ?? '未审批'}</Typography.Text>
                  </Space>
                </Card>
              </>
            ) : null}
            <Card size="small" title="输入 Schema"><pre>{JSON.stringify(activeSkill.input_schema, null, 2)}</pre></Card>
            <Card size="small" title="输出 Schema"><pre>{JSON.stringify(activeSkill.output_schema, null, 2)}</pre></Card>
            <Card size="small" title="配置 Schema"><pre>{JSON.stringify(activeSkill.config_schema, null, 2)}</pre></Card>
            {activeSkill.prompts?.length ? (
              <Card size="small" title="Prompts">
                <Space direction="vertical" className="full-width-control">
                  {activeSkill.prompts.map((prompt) => (
                    <Card size="small" key={prompt.name} title={prompt.name}>
                      <Space direction="vertical" className="full-width-control">
                        <Typography.Text>路径：{prompt.path}</Typography.Text>
                        <Button
                          size="small"
                          loading={promptDebugMutation.isPending}
                          onClick={() => promptDebugMutation.mutate({ skill: activeSkill, promptName: prompt.name })}
                        >
                          Debug {prompt.name}
                        </Button>
                      </Space>
                    </Card>
                  ))}
                </Space>
              </Card>
            ) : null}
            {promptDebugResult ? <PromptDebugCard result={promptDebugResult} /> : null}
            {contractResultText ? <Alert type={contractResultText.includes('通过') ? 'success' : 'error'} showIcon message={contractResultText} /> : null}
            {contractResult ? <ContractResultCard result={contractResult} activeSkill={activeSkill} /> : null}
            <Tooltip title="会用示例输入和示例配置真实执行一次 Skill，并检查输入输出 schema。">
              <Button icon={<CheckCircleOutlined />} type="primary" loading={contractMutation.isPending} onClick={() => contractMutation.mutate(activeSkill.skill_id)}>
                运行合约测试
              </Button>
            </Tooltip>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="上传 Skill 插件包向导"
        open={uploadOpen}
        forceRender
        onCancel={() => setUploadOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setUploadOpen(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={uploadMutation.isPending} disabled={!uploadFile} onClick={() => form.submit()}>提交上传</Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={(values) => uploadMutation.mutate(values)}>
          <Form.Item name="filename" label="文件名">
            <Input placeholder="echo_skill.zip" />
          </Form.Item>
          <Upload.Dragger
            accept=".zip"
            beforeUpload={(file) => {
              setUploadFile(file);
              form.setFieldValue('filename', file.name);
              return false;
            }}
            fileList={uploadFile ? [uploadFile] : []}
            onRemove={() => setUploadFile(null)}
            maxCount={1}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">选择 zip 插件包</p>
            <p className="ant-upload-hint">包内必须包含 skill.yaml 或 skill.json，以及 handler.py。</p>
          </Upload.Dragger>
        </Form>
      </Modal>
    </section>
  );
}

async function readFileBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function getSelectedFile(uploadFile: UploadFile | null): File | null {
  // Ant Design Upload 的真实文件位置在不同触发路径下并不完全一致；
  // 这里统一归一化，让拖拽区和弹窗上传共用一套提交逻辑。
  return (uploadFile?.originFileObj ?? uploadFile ?? null) as File | null;
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

function PromptDebugCard({ result }: { result: PromptDebugResult }) {
  const artifactUris = result.artifact_uris && typeof result.artifact_uris === 'object' ? result.artifact_uris : null;
  return (
    <Card size="small" title="Prompt Debug Result">
      <Space direction="vertical" className="full-width-control">
        <Typography.Text strong>{result.prompt_name}</Typography.Text>
        <Card size="small" title="Rendered Prompt"><pre>{result.rendered_prompt}</pre></Card>
        <Card size="small" title="Raw Response"><pre>{result.raw_response}</pre></Card>
        <Card size="small" title="Parsed Output"><pre>{JSON.stringify(result.parsed_output ?? {}, null, 2)}</pre></Card>
        <Card size="small" title="Schema Validation"><pre>{JSON.stringify(result.schema_validation ?? {}, null, 2)}</pre></Card>
        <Card size="small" title="Token Usage"><pre>{JSON.stringify(result.token_usage ?? {}, null, 2)}</pre></Card>
        {artifactUris ? <Card size="small" title="Artifact URIs"><pre>{JSON.stringify(artifactUris, null, 2)}</pre></Card> : null}
      </Space>
    </Card>
  );
}

function ContractResultCard({ result, activeSkill }: { result: SkillContractResult; activeSkill: SkillManifest }) {
  const errorCode = typeof (result as unknown as Record<string, unknown>).code === 'string' ? String((result as unknown as Record<string, unknown>).code) : result.error;
  return (
    <Card size="small" title="合约测试结果">
      <Space direction="vertical" className="drawer-stack">
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="测试输入"><pre>{JSON.stringify(activeSkill.example_input, null, 2)}</pre></Descriptions.Item>
          <Descriptions.Item label="测试配置"><pre>{JSON.stringify(activeSkill.example_config, null, 2)}</pre></Descriptions.Item>
          <Descriptions.Item label="输出结果"><pre>{JSON.stringify(result.output ?? {}, null, 2)}</pre></Descriptions.Item>
          <Descriptions.Item label="耗时">{result.latency_ms === undefined ? '-' : `${result.latency_ms.toFixed(2)} ms`}</Descriptions.Item>
          {!result.ok ? <Descriptions.Item label="错误码">{errorCode ?? '-'}</Descriptions.Item> : null}
          {!result.ok ? <Descriptions.Item label="错误信息">{result.message ?? result.error ?? '-'}</Descriptions.Item> : null}
        </Descriptions>
        {!result.ok ? (
          <Alert
            type="warning"
            showIcon
            message="修复建议"
            description="检查 skill.yaml/skill.json 中的 schema 是否和 handler 输出一致；检查 handler.py 的 run(inputs, config) 是否返回 output、metrics、logs；如果超时，请减少初始化成本或外部调用。"
          />
        ) : null}
      </Space>
    </Card>
  );
}
