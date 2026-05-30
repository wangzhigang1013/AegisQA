import { CheckCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Drawer, Space, Tag, Typography } from 'antd';

import type { SkillManifest, SkillPackageRecord } from '../../types';

type SkillApprovalDrawerProps = {
  open: boolean;
  skill: SkillManifest | null;
  packageRecord?: SkillPackageRecord;
  loading?: boolean;
  onClose: () => void;
  onApprove: (skill: SkillManifest) => void;
};

export function SkillApprovalDrawer({ open, skill, packageRecord, loading = false, onClose, onApprove }: SkillApprovalDrawerProps) {
  const isPackageSkill = Boolean(packageRecord);
  const canApprove = !isPackageSkill || Boolean(packageRecord?.last_contract_ok);
  const contractText = packageRecord?.last_contract_ok ? '合约已通过' : '合约未通过';

  return (
    <Drawer width={760} title="Skill 审批详情" open={open} onClose={onClose}>
      {skill ? (
        <Space direction="vertical" size="large" className="drawer-stack">
          {!canApprove ? <Alert type="warning" showIcon message="未通过合约测试不能启用" description="请先在 Skill 市场运行合约测试，确认输入输出 schema 和 handler 返回结构稳定后再审批。" /> : null}

          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="Skill ID"><code>{skill.skill_id}</code></Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={skill.status === 'approved' ? 'green' : 'orange'}>{formatSkillStatus(skill.status)}</Tag></Descriptions.Item>
            <Descriptions.Item label="合约测试"><Tag color={packageRecord?.last_contract_ok ? 'green' : 'red'}>{contractText}</Tag></Descriptions.Item>
            <Descriptions.Item label="审批人">{packageRecord?.approved_by ?? '未审批'}</Descriptions.Item>
            <Descriptions.Item label="审批时间">{packageRecord?.approved_at ?? '未审批'}</Descriptions.Item>
          </Descriptions>

          <Card size="small" title="Manifest">
            <pre>{JSON.stringify(skill, null, 2)}</pre>
          </Card>
          <Card size="small" title="输入 Schema">
            <pre>{JSON.stringify(skill.input_schema, null, 2)}</pre>
          </Card>
          <Card size="small" title="输出 Schema">
            <pre>{JSON.stringify(skill.output_schema, null, 2)}</pre>
          </Card>
          <Card size="small" title="测试日志">
            {packageRecord?.last_contract_result ? <pre>{JSON.stringify(packageRecord.last_contract_result, null, 2)}</pre> : <Typography.Text type="secondary">暂无合约测试日志</Typography.Text>}
          </Card>

          <Button icon={<CheckCircleOutlined />} type="primary" disabled={!canApprove} loading={loading} onClick={() => onApprove(skill)}>
            审批启用
          </Button>
        </Space>
      ) : null}
    </Drawer>
  );
}

function formatSkillStatus(status: string): string {
  return {
    approved: '已启用',
    pending_review: '待审批',
    disabled: '已禁用',
    deprecated: '已废弃',
  }[status] ?? status;
}
