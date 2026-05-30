import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Input, Modal, Space, Table, Tag, Timeline } from 'antd';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import type { SkillManifest } from '../types';

const permissionRows = [
  { key: 'admin', role: 'admin', permissions: 'workflow:publish, run:control, skill:governance, audit:read' },
  { key: 'evaluator', role: 'evaluator', permissions: 'dataset:write, workflow:write, run:create, report:read' },
  { key: 'reviewer', role: 'reviewer', permissions: 'badcase:correct, judge:audit, report:read' },
];

export function GovernancePage() {
  const queryClient = useQueryClient();
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const auditEventsQuery = useQuery({ queryKey: ['audit-events'], queryFn: api.auditEvents });
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
      await queryClient.invalidateQueries({ queryKey: ['audit-events'] });
    },
    onError: (error) => setNotice(error instanceof Error ? `治理动作失败：${error.message}` : '治理动作失败'),
  });

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="平台治理"
        title="治理与审计"
        description="管理 RBAC、Skill 生命周期、审计日志，以及 MySQL / Redis / Celery 等生产适配状态。"
        primaryAction={<Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setMatrixOpen(true)}>查看权限矩阵</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="生产适配状态">
        <Descriptions bordered column={{ xs: 1, md: 2, xl: 4 }}>
          <Descriptions.Item label="MySQL">schema 已准备</Descriptions.Item>
          <Descriptions.Item label="Redis">缓存与队列占位</Descriptions.Item>
          <Descriptions.Item label="Celery">Worker 入口已准备</Descriptions.Item>
          <Descriptions.Item label="Secret 脱敏">启用</Descriptions.Item>
        </Descriptions>
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
            { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'approved' ? 'green' : value === 'disabled' ? 'orange' : 'red'}>{value}</Tag> },
            { title: '权限', dataIndex: 'permissions', render: (value: string[]) => value.length ? value.map((item) => <Tag key={item}>{item}</Tag>) : '-' },
            {
              title: '治理动作',
              render: (_, skill) => (
                <Space wrap>
                  <Button size="small" loading={skillMutation.isPending} onClick={() => skillMutation.mutate({ skill, action: 'approve' })}>启用</Button>
                  <Button size="small" loading={skillMutation.isPending} onClick={() => skillMutation.mutate({ skill, action: 'disable' })}>禁用</Button>
                  <Button size="small" danger loading={skillMutation.isPending} onClick={() => skillMutation.mutate({ skill, action: 'deprecate' })}>废弃</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

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
    </section>
  );
}
