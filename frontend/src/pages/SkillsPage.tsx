import { CheckCircleOutlined, InboxOutlined, InfoCircleOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { demoSkills } from '../data/demo';
import type { SkillManifest } from '../types';

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
  const [contractResultText, setContractResultText] = useState<string | null>(null);
  const [form] = Form.useForm<UploadFormValues>();

  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const packagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const skills = skillsQuery.data?.length ? skillsQuery.data : demoSkills;
  const filteredSkills = useMemo(
    () => (statusFilter === 'all' ? skills : skills.filter((skill) => skill.status === statusFilter)),
    [skills, statusFilter],
  );

  const uploadMutation = useMutation({
    mutationFn: async (values: UploadFormValues) => {
      if (!uploadFile?.originFileObj) {
        throw new Error('请选择 zip 插件包。');
      }
      const content_base64 = await readFileBase64(uploadFile.originFileObj);
      return api.uploadSkillPackage({ filename: values.filename || uploadFile.name, content_base64 });
    },
    onSuccess: async (record) => {
      setNotice(`插件包已上传：${record.manifest.skill_id}，当前状态 ${record.status}`);
      setUploadOpen(false);
      setUploadFile(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `上传失败：${error.message}` : '上传失败'),
  });

  const contractMutation = useMutation({
    mutationFn: (skillId: string) => api.contractTest(skillId),
    onSuccess: (result) => {
      const text = result.ok ? `合约测试通过：${result.skill_id}` : `合约测试失败：${result.message ?? result.error ?? '未知错误'}`;
      setContractResultText(text);
      setNotice(text);
    },
    onError: (error) => setContractResultText(error instanceof Error ? `合约测试失败：${error.message}` : '合约测试失败：未知错误'),
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
          <Input.Search placeholder="搜索 Skill 名称或 ID" allowClear className="wide-search" />
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
            { title: '状态', dataIndex: 'status', render: (value, record) => <Tag color={record.enabled ? 'green' : 'orange'}>{value}</Tag> },
            { title: '标签', dataIndex: 'tags', render: (tags: string[]) => <Space wrap>{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space> },
            { title: '权限', dataIndex: 'permissions', render: (items: string[]) => <Space wrap>{items.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}</Space> },
            { title: '插件包', render: (_, record) => (packagesQuery.data?.some((item) => item.manifest.skill_id === record.skill_id) ? <Tag color="purple">package</Tag> : <Tag>builtin</Tag>) },
            {
              title: '操作',
              render: (_, record) => (
                <Button
                  icon={<InfoCircleOutlined />}
                  onClick={() => {
                    setContractResultText(null);
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
            <Card size="small" title="输入 Schema"><pre>{JSON.stringify(activeSkill.input_schema, null, 2)}</pre></Card>
            <Card size="small" title="输出 Schema"><pre>{JSON.stringify(activeSkill.output_schema, null, 2)}</pre></Card>
            <Card size="small" title="配置 Schema"><pre>{JSON.stringify(activeSkill.config_schema, null, 2)}</pre></Card>
            {contractResultText ? <Alert type={contractResultText.includes('通过') ? 'success' : 'error'} showIcon message={contractResultText} /> : null}
            <Button icon={<CheckCircleOutlined />} type="primary" loading={contractMutation.isPending} onClick={() => contractMutation.mutate(activeSkill.skill_id)}>
              运行合约测试
            </Button>
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
