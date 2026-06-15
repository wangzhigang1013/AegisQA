import { CheckCircleOutlined, CopyOutlined, InboxOutlined, InfoCircleOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, List, Modal, Radio, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useMemo, useState } from 'react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { SkillContractResult, SkillManifest, SkillPackageRecord, SkillVersionHistory, SkillVersionHistoryItem } from '../types';

type UploadFormValues = {
  filename: string;
};

type ConflictStrategy = 'error' | 'replace' | 'new_version';

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
  const [form] = Form.useForm<UploadFormValues>();

  // 冲突处理状态
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictSkillId, setConflictSkillId] = useState<string | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('error');
  const [pendingUploadValues, setPendingUploadValues] = useState<UploadFormValues | null>(null);

  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const packagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const versionHistoryQuery = useQuery({
    queryKey: ['skill-version-history', activeSkill?.skill_id],
    queryFn: () => api.skillVersionHistory(activeSkill?.skill_id ?? ''),
    enabled: Boolean(activeSkill),
  });
  const skills = Array.isArray(skillsQuery.data) ? skillsQuery.data : [];
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
    mutationFn: async ({ values, strategy }: { values: UploadFormValues; strategy?: ConflictStrategy }) => {
      const selectedFile = getSelectedFile(uploadFile);
      if (!selectedFile) {
        throw new Error('请选择 zip 插件包。');
      }
      const content_base64 = await readFileBase64(selectedFile);
      return api.uploadSkillPackage({
        filename: values.filename || selectedFile.name,
        content_base64,
        conflict_strategy: strategy || 'error',
      });
    },
    onSuccess: async (record) => {
      const actionText = conflictStrategy === 'replace' ? '已替换' : conflictStrategy === 'new_version' ? '已创建新版本' : '已上传';
      setNotice(`插件包${actionText}：${record.manifest.skill_id}，当前状态 ${record.status}`);
      setUploadOpen(false);
      setUploadFile(null);
      setConflictModalOpen(false);
      setPendingUploadValues(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
    },
    onError: (error: unknown) => {
      const errorObj = error as { code?: string; message?: string; details?: { existing_skill_id?: string } };
      if (errorObj?.code === 'SKILL_ALREADY_EXISTS') {
        // 检测到冲突，显示冲突处理对话框
        setConflictSkillId(errorObj.details?.existing_skill_id || null);
        setConflictModalOpen(true);
        setPendingUploadValues(form.getFieldsValue());
      } else {
        setNotice(`上传失败：${formatApiError(error)}`);
      }
    },
  });

  // 处理冲突策略选择
  const handleConflictResolve = () => {
    if (pendingUploadValues) {
      uploadMutation.mutate({ values: pendingUploadValues, strategy: conflictStrategy });
    }
  };

  const contractMutation = useMutation({
    mutationFn: (skillId: string) => api.contractTest(skillId),
    onSuccess: async (result) => {
      const text = result.ok ? `合约测试通过：${result.skill_id}` : `合约测试失败：${result.message ?? result.error ?? '未知错误'}`;
      setContractResult(result);
      setContractResultText(text);
      setNotice(text);
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
    },
    onError: (error) => {
      setContractResult(null);
      setContractResultText(`合约测试失败：${formatApiError(error)}`);
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: (payload: { sourceSkillId: string; targetSkillId: string }) =>
      api.rollbackSkillVersion(payload.sourceSkillId, payload.targetSkillId, '从 Skill 市场回滚到历史版本'),
    onSuccess: async (history) => {
      setNotice(`已回滚到 ${history.latest_approved_skill_id ?? '目标版本'}`);
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-version-history'] });
    },
    onError: (error) => setNotice(`回滚失败：${formatApiError(error)}`),
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="能力市场"
        title="Skill 市场"
        description="上传、审批和管理可被 Workflow 引用的 Agent Skill 包。脚本型 Skill 直接跑参数逻辑，说明型 Skill 通过模型网关执行。"
        primaryAction={(
          <Space wrap>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传 Agent Skill 包</Button>
          </Space>
        )}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}
      {skillsQuery.isError ? <Alert type="error" showIcon message={`Skill 列表加载失败：${formatApiError(skillsQuery.error)}`} /> : null}

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
        <List
          grid={{ gutter: 16, xs: 1, sm: 1, md: 2, xl: 3 }}
          pagination={{ pageSize: 12 }}
          dataSource={filteredSkills}
          loading={skillsQuery.isLoading}
          locale={{ emptyText: <Empty description="暂无 Skill，请上传 Agent Skill 包并完成合约测试和审批。" /> }}
          renderItem={(record) => {
            const packageRecord = packageBySkillId[record.skill_id];
            const isContractOk = packageRecord?.last_contract_ok;
            const runtimeMode = packageRecord ? formatPackageRuntime(packageRecord.runtime_mode) : 'builtin';
            
            return (
              <List.Item>
                <Card 
                  hoverable 
                  className="flat-card h-full flex flex-col"
                  bodyStyle={{ flex: 1, padding: '16px' }}
                >
                  <div className="flex justify-between items-start mb-3">
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong className="text-base">{record.name}</Typography.Text>
                      <Typography.Text type="secondary" className="text-xs font-mono">{record.skill_id}</Typography.Text>
                    </Space>
                    <Tag color={record.enabled ? 'green' : 'orange'}>{formatSkillStatus(record.status)}</Tag>
                  </div>
                  
                  <div className="flex flex-wrap gap-1 mb-3">
                    {record.tags.map(tag => <Tag key={tag} className="text-xs m-0">{tag}</Tag>)}
                    <Tag color="purple" className="text-xs m-0">{runtimeMode}</Tag>
                  </div>

                  <div className="text-xs text-slate-500 flex flex-col gap-1 mb-4">
                    <div className="flex justify-between">
                      <span>合约状态:</span>
                      <span className={isContractOk ? 'text-green-600' : 'text-red-500'}>
                        {!packageRecord ? '内置 Skill' : (isContractOk ? '已通过' : '未通过')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>审批人:</span>
                      <span>{packageRecord?.approved_by ?? '未审批'}</span>
                    </div>
                  </div>

                  <div className="mt-auto pt-3 border-t border-slate-100 text-right">
                    <Button
                      size="small"
                      type="primary"
                      icon={<InfoCircleOutlined />}
                      onClick={() => {
                        setContractResultText(null);
                        setContractResult(null);
                        setActiveSkill(record);
                      }}
                    >
                      查看详情
                    </Button>
                  </div>
                </Card>
              </List.Item>
            );
          }}
        />
      </Card>

      <Drawer width={680} title={activeSkill?.name} open={Boolean(activeSkill)} onClose={() => setActiveSkill(null)}>
        {activeSkill ? (
          <Space direction="vertical" size="large" className="drawer-stack">
            <Typography.Paragraph>{activeSkill.description}</Typography.Paragraph>
            <Card size="small" title="合约测试做什么">
              <Typography.Paragraph>
                使用 Skill manifest 里的 example_input 和 example_config 执行一次 Skill，验证输入 schema、输出 schema、运行入口和返回结构是否正常。
                脚本型会调用 runtime.entrypoint，说明型会读取 SKILL.md 和 references 后走统一模型网关。
              </Typography.Paragraph>
            </Card>
            {packageBySkillId[activeSkill.skill_id] ? (
              <>
                <Card size="small" title="Agent Skill 包启用步骤">
                  <Space direction="vertical">
                    <Typography.Text>第 1 步：上传 zip 包，包内包含 SKILL.md，脚本型还需要 skill.yaml/skill.json 声明 schema 和 runtime.entrypoint。</Typography.Text>
                    <Typography.Text>第 2 步：运行合约测试，确认 example_input、example_config 和输出 schema 能对齐。</Typography.Text>
                    <Typography.Text>第 3 步：治理页审批启用</Typography.Text>
                    <Typography.Text>第 4 步：Workflow 画布中搜索并添加</Typography.Text>
                  </Space>
                </Card>
                <Card size="small" title="包运行方式">
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="运行模式">{formatPackageRuntime(packageBySkillId[activeSkill.skill_id].runtime_mode)}</Descriptions.Item>
                    <Descriptions.Item label="脚本入口">{packageBySkillId[activeSkill.skill_id].entrypoint ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="SKILL.md">{packageBySkillId[activeSkill.skill_id].skill_md_path ?? '-'}</Descriptions.Item>
                  </Descriptions>
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
                <SkillVersionHistoryCard
                  activeSkill={activeSkill}
                  history={versionHistoryQuery.data}
                  loading={versionHistoryQuery.isLoading}
                  rollbackLoading={rollbackMutation.isPending}
                  onRollback={(targetSkillId) => rollbackMutation.mutate({ sourceSkillId: activeSkill.skill_id, targetSkillId })}
                />
              </>
            ) : null}
            <Card size="small" title="输入 Schema"><pre>{JSON.stringify(activeSkill.input_schema, null, 2)}</pre></Card>
            <Card size="small" title="输出 Schema"><pre>{JSON.stringify(activeSkill.output_schema, null, 2)}</pre></Card>
            <Card size="small" title="配置 Schema"><pre>{JSON.stringify(activeSkill.config_schema, null, 2)}</pre></Card>
            {contractResultText ? <Alert type={contractResultText.includes('通过') ? 'success' : 'error'} showIcon message={contractResultText} /> : null}
            {contractResult ? <ContractResultCard result={contractResult} activeSkill={activeSkill} packageRecord={packageBySkillId[activeSkill.skill_id]} /> : null}
            <Tooltip title="会用示例输入和示例配置真实执行一次 Skill，并检查输入输出 schema。">
              <Button icon={<CheckCircleOutlined />} type="primary" loading={contractMutation.isPending} onClick={() => contractMutation.mutate(activeSkill.skill_id)}>
                运行合约测试
              </Button>
            </Tooltip>
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="上传 Agent Skill 包"
        open={uploadOpen}
        forceRender
        onCancel={() => setUploadOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setUploadOpen(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={uploadMutation.isPending} disabled={!uploadFile} onClick={() => form.submit()}>提交上传</Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={(values) => uploadMutation.mutate({ values })}>
          <Alert
            type="info"
            showIcon
            message="zip 包格式"
            description="推荐包含 SKILL.md、skill.yaml 或 skill.json、scripts、references、assets。纯参数或脚本型 Skill 必须在 skill.yaml/skill.json 中声明 input_schema、output_schema、config_schema 和 runtime.mode=script；说明型 Skill 使用 runtime.mode=instruction_model。旧的 handler.py 插件仍兼容。"
            style={{ marginBottom: 16 }}
          />
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
            <p className="ant-upload-text">选择 Agent Skill zip 包</p>
            <p className="ant-upload-hint">脚本型示例：SKILL.md + skill.yaml + scripts/run.py；说明型示例：SKILL.md + skill.yaml + references/。</p>
          </Upload.Dragger>
        </Form>
      </Modal>

      {/* 冲突处理对话框 */}
      <Modal
        title="Skill 名称冲突"
        open={conflictModalOpen}
        onCancel={() => {
          setConflictModalOpen(false);
          setPendingUploadValues(null);
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setConflictModalOpen(false);
            setPendingUploadValues(null);
          }}>
            取消
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={uploadMutation.isPending}
            onClick={handleConflictResolve}
          >
            确认{conflictStrategy === 'replace' ? '替换' : conflictStrategy === 'new_version' ? '创建新版本' : '上传'}
          </Button>,
        ]}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="已存在同名 Skill"
            description={
              <Space direction="vertical">
                <Typography.Text>
                  系统中已存在名为 <Typography.Text strong code>{conflictSkillId}</Typography.Text> 的 Skill。
                </Typography.Text>
                <Typography.Text type="secondary">
                  请选择处理方式：
                </Typography.Text>
              </Space>
            }
          />
          <Radio.Group
            value={conflictStrategy}
            onChange={(e) => setConflictStrategy(e.target.value)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Radio value="new_version" style={{ width: '100%' }}>
                <Card size="small" hoverable style={{ marginLeft: 8 }}>
                  <Space>
                    <CopyOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong>创建新版本</Typography.Text>
                      <Typography.Text type="secondary">自动递增版本号，保留历史版本记录</Typography.Text>
                    </Space>
                  </Space>
                </Card>
              </Radio>
              <Radio value="replace" style={{ width: '100%' }}>
                <Card size="small" hoverable style={{ marginLeft: 8 }}>
                  <Space>
                    <SwapOutlined style={{ fontSize: 24, color: '#faad14' }} />
                    <Space direction="vertical" size={0}>
                      <Typography.Text strong>替换现有版本</Typography.Text>
                      <Typography.Text type="secondary">覆盖当前版本，历史版本将被标记为已替换</Typography.Text>
                    </Space>
                  </Space>
                </Card>
              </Radio>
            </Space>
          </Radio.Group>
        </Space>
      </Modal>
    </section>
  );
}

function SkillVersionHistoryCard({
  activeSkill,
  history,
  loading,
  rollbackLoading,
  onRollback,
}: {
  activeSkill: SkillManifest;
  history?: SkillVersionHistory;
  loading: boolean;
  rollbackLoading: boolean;
  onRollback: (targetSkillId: string) => void;
}) {
  const versions = history?.versions ?? [];
  const activeVersion = versions.find((item) => item.skill_id === activeSkill.skill_id);
  return (
    <Card size="small" title="版本历史">
      <Space direction="vertical" className="drawer-stack">
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="版本族">{history?.base_skill_id ?? activeSkill.skill_id.split('@')[0]}</Descriptions.Item>
          <Descriptions.Item label="当前启用版本">{history?.latest_approved_skill_id ?? '-'}</Descriptions.Item>
        </Descriptions>
        <Table<SkillVersionHistoryItem>
          size="small"
          rowKey="skill_id"
          loading={loading}
          dataSource={versions}
          pagination={false}
          scroll={{ x: 760 }}
          columns={[
            { title: 'Skill ID', dataIndex: 'skill_id', render: (value) => <code>{value}</code> },
            { title: '状态', dataIndex: 'status', render: (value, record) => <Tag color={record.enabled ? 'green' : 'orange'}>{formatSkillStatus(String(value))}</Tag> },
            {
              title: '差异',
              render: (_, record) => (
                <Space wrap>
                  {record.diff_from_previous.length ? record.diff_from_previous.map((diff) => <Tag key={diff.field}>{diff.field}</Tag>) : <Tag>初始版本</Tag>}
                </Space>
              ),
            },
            {
              title: '操作',
              render: (_, record) => (
                record.skill_id === activeSkill.skill_id ? <Tag>当前</Tag> : (
                  <Button size="small" loading={rollbackLoading} onClick={() => onRollback(record.skill_id)}>
                    回滚到此版本
                  </Button>
                )
              ),
            },
          ]}
        />
        <LifecycleHistory title="合约测试历史" items={activeVersion?.contract_history ?? []} />
        <LifecycleHistory title="审批历史" items={activeVersion?.approval_history ?? []} />
      </Space>
    </Card>
  );
}

function LifecycleHistory({ title, items }: { title: string; items: Record<string, unknown>[] }) {
  return (
    <section>
      <Typography.Title level={5}>{title}</Typography.Title>
      {items.length ? (
        <Space direction="vertical" size="small">
          {items.map((item, index) => (
            <Typography.Text key={`${title}-${index}`}>
              {String(item.created_at ?? '-')} / {String(item.action ?? (item.ok ? 'contract_passed' : 'contract_failed'))} / {String(item.actor ?? 'api')}
            </Typography.Text>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary">暂无记录</Typography.Text>
      )}
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

function formatPackageRuntime(runtimeMode?: string): string {
  return {
    script: '脚本型',
    instruction_model: '说明型',
    safe_model: '说明型',
  }[runtimeMode ?? ''] ?? (runtimeMode || 'package');
}

function ContractResultCard({ result, activeSkill, packageRecord }: { result: SkillContractResult; activeSkill: SkillManifest; packageRecord?: SkillPackageRecord }) {
  const errorCode = typeof (result as unknown as Record<string, unknown>).code === 'string' ? String((result as unknown as Record<string, unknown>).code) : result.error;
  const suggestion = contractSuggestion(packageRecord);
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
            description={suggestion}
          />
        ) : null}
      </Space>
    </Card>
  );
}

function contractSuggestion(packageRecord?: SkillPackageRecord): string {
  if (packageRecord?.runtime_mode === 'script') {
    return '检查 skill.yaml/skill.json 中的 schema 是否和脚本输出一致；检查 runtime.entrypoint 指向的函数是否暴露 run(inputs, config)，并返回 output、metrics、logs；如果超时，请减少初始化成本或外部调用。';
  }
  if (packageRecord?.runtime_mode === 'instruction_model' || packageRecord?.runtime_mode === 'safe_model') {
    return '检查 SKILL.md 和 references 是否能清楚描述任务；检查 output_schema 是否与说明型输出字段 answer/text 对齐；如果模型网关失败，请检查模型接入配置。';
  }
  return '检查 skill.yaml/skill.json 中的 schema 是否和运行结果一致；旧插件请检查 handler.py 的 run(inputs, config)，新脚本型 Skill 请检查 runtime.entrypoint。';
}
