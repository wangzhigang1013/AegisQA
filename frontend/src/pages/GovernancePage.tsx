import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input, Modal, Space, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { SkillApprovalDrawer } from './skills/SkillApprovalDrawer';
import type { SkillManifest, SkillPackageRecord } from '../types';

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
  const [approvalSkill, setApprovalSkill] = useState<SkillManifest | null>(null);
  const skillsQuery = useQuery({ queryKey: ['skills'], queryFn: api.skills });
  const packagesQuery = useQuery({ queryKey: ['skill-packages'], queryFn: api.skillPackages });
  const auditEventsQuery = useQuery({ queryKey: ['audit-events'], queryFn: api.auditEvents });
  const packageBySkillId = useMemo(() => indexPackagesBySkillId(packagesQuery.data ?? []), [packagesQuery.data]);
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

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="平台治理"
        title="治理与审计"
        description="管理 RBAC、Skill 生命周期和审计日志。生产适配说明保留在部署文档中，不作为当前页面的可操作状态。"
        primaryAction={<Button type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setMatrixOpen(true)}>查看权限矩阵</Button>}
      />

      {notice ? <Alert type={notice.includes('失败') ? 'error' : 'success'} showIcon message={notice} closable onClose={() => setNotice(null)} /> : null}

      <Card className="flat-card" title="生产适配边界已移至文档">
        <Space direction="vertical" size={8}>
          <Typography.Text>
            MySQL / Redis / Celery 是部署边界，不是当前前端页面里的可操作开关。请以 <Typography.Text code>README.md</Typography.Text> 和 <Typography.Text code>docs/PRD_ACCEPTANCE_MATRIX.md</Typography.Text> 为准。
          </Typography.Text>
          <Typography.Text type="secondary">
            当前页面只保留治理动作：权限矩阵、Skill 生命周期和审计日志。
          </Typography.Text>
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
