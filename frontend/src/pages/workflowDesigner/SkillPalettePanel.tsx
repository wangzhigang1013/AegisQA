import { BranchesOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Divider, Empty, Input, Space, Tag, Typography } from 'antd';

import type { SkillManifest, WorkflowGraphNode } from '../../types';
import { nodeTypeLabel, paletteNodeTypes } from './graphModel';

type SkillPalettePanelProps = {
  skills: SkillManifest[];
  skillSearch: string;
  onSkillSearchChange: (value: string) => void;
  onAddSkill: (skill: SkillManifest) => void;
  onShowSkill: (skill: SkillManifest) => void;
  onAddStructureNode: (nodeType: WorkflowGraphNode['node_type']) => void;
};

export function SkillPalettePanel({
  skills,
  skillSearch,
  onSkillSearchChange,
  onAddSkill,
  onShowSkill,
  onAddStructureNode,
}: SkillPalettePanelProps) {
  return (
    <Card className="flat-card full-height" title="Skill Palette">
      <Space direction="vertical" className="drawer-stack">
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索 Skill 名称、描述、标签或 schema"
          value={skillSearch}
          onChange={(event) => onSkillSearchChange(event.target.value)}
          allowClear
        />
        {skills.length ? (
          skills.map((skill) => {
            const disabled = !skill.enabled || skill.status !== 'approved';
            return (
              <Card size="small" key={skill.skill_id}>
                <Space direction="vertical" className="drawer-stack">
                  <Space wrap>
                    <Typography.Text strong>{skill.name}</Typography.Text>
                    <Tag color={disabled ? 'orange' : 'green'}>{skill.status}</Tag>
                  </Space>
                  <Typography.Text type="secondary">{skill.description}</Typography.Text>
                  <Typography.Text type="secondary">输入 {schemaFieldCount(skill.input_schema)} / 输出 {schemaFieldCount(skill.output_schema)}</Typography.Text>
                  {disabled ? <Typography.Text type="secondary">请先在 Skill 市场运行合约测试并审批启用</Typography.Text> : null}
                  <Space wrap>
                    <Button icon={<PlusOutlined />} disabled={disabled} onClick={() => onAddSkill(skill)}>
                      添加 {skill.name}
                    </Button>
                    <Button onClick={() => onShowSkill(skill)}>查看详情</Button>
                  </Space>
                </Space>
              </Card>
            );
          })
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={skillSearch.trim() ? '未找到匹配 Skill' : '暂无可用 Skill，请先在 Skill 市场上传并审批启用。'}
          />
        )}
      </Space>
      <Divider />
      <Typography.Text strong>结构节点</Typography.Text>
      <Space direction="vertical" className="drawer-stack node-help">
        {paletteNodeTypes.map((nodeType) => (
          <Button key={nodeType} icon={<BranchesOutlined />} onClick={() => onAddStructureNode(nodeType)} block>
            新增 {nodeTypeLabel[nodeType]}
          </Button>
        ))}
      </Space>
    </Card>
  );
}

function schemaFieldCount(schema: Record<string, unknown> | null | undefined): number {
  return Object.keys(((schema ?? {}).properties ?? {}) as Record<string, unknown>).length;
}
