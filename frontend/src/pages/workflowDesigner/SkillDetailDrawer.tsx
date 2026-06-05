import { Card, Descriptions, Drawer, Space, Tag, Typography } from 'antd';

import type { SkillManifest } from '../../types';

type SkillDetailDrawerProps = {
  skill: SkillManifest | null;
  onClose: () => void;
};

export function SkillDetailDrawer({ skill, onClose }: SkillDetailDrawerProps) {
  return (
    <Drawer
      title={skill ? `Skill 详情：${skill.name}` : 'Skill 详情'}
      open={Boolean(skill)}
      onClose={onClose}
      width={560}
    >
      {skill ? (
        <Space direction="vertical" size="large" className="drawer-stack">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Skill ID">{skill.skill_id}</Descriptions.Item>
            <Descriptions.Item label="版本">{skill.version}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Space wrap>
                <Tag color={skill.enabled && skill.status === 'approved' ? 'green' : 'orange'}>{skill.status}</Tag>
                <Tag>{skill.enabled ? '已启用' : '未启用'}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="描述">{skill.description}</Descriptions.Item>
            <Descriptions.Item label="标签">{skill.tags.join('、') || '-'}</Descriptions.Item>
            <Descriptions.Item label="场景">{skill.scenarios.join('、') || '-'}</Descriptions.Item>
          </Descriptions>
          <Card size="small" title="输入字段">
            <Typography.Text type="secondary">{Object.keys(schemaProperties(skill.input_schema)).join('、') || '无'}</Typography.Text>
          </Card>
          <Card size="small" title="输出字段">
            <Typography.Text type="secondary">{Object.keys(schemaProperties(skill.output_schema)).join('、') || '无'}</Typography.Text>
          </Card>
          <Card size="small" title="输入 Schema"><pre>{JSON.stringify(skill.input_schema, null, 2)}</pre></Card>
          <Card size="small" title="输出 Schema"><pre>{JSON.stringify(skill.output_schema, null, 2)}</pre></Card>
          <Card size="small" title="配置 Schema"><pre>{JSON.stringify(skill.config_schema, null, 2)}</pre></Card>
        </Space>
      ) : null}
    </Drawer>
  );
}

function schemaProperties(schema: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return ((schema ?? {}).properties ?? {}) as Record<string, unknown>;
}
