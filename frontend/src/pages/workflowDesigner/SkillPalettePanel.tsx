import { GitBranch, Plus, Search } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

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
    <Card className="shadow-none border-0 h-full flex flex-col rounded-none">
      <CardHeader className="pb-4 pt-6 px-6">
        <CardTitle className="text-lg">Skill Palette</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-y-auto px-6 pb-6 pt-0">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="搜索 Skill 名称、描述、标签或 schema"
            value={skillSearch}
            onChange={(event) => onSkillSearchChange(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
          {skills.length ? (
            skills.map((skill) => {
              const disabled = !skill.enabled || skill.status !== 'approved';
              return (
                <div key={skill.skill_id} className="border rounded-lg p-4 flex flex-col gap-2 shadow-sm bg-white">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{skill.name}</span>
                    <span className={`px-2 py-0.5 text-xs rounded font-medium ${disabled ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                      {skill.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{skill.description}</p>
                  <p className="text-xs text-slate-500">输入 {schemaFieldCount(skill.input_schema)} / 输出 {schemaFieldCount(skill.output_schema)}</p>
                  {disabled && <p className="text-xs text-slate-500">请先在 Skill 市场运行合约测试并审批启用</p>}
                  <div className="flex gap-2 mt-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      disabled={disabled} 
                      onClick={() => onAddSkill(skill)}
                      className="flex items-center gap-1 flex-1 justify-center h-8 text-xs"
                    >
                      <Plus className="w-3 h-3" /> 添加 {skill.name}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => onShowSkill(skill)}
                      className="h-8 text-xs px-3"
                    >
                      查看详情
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
              <span className="text-4xl opacity-50">📭</span>
              {skillSearch.trim() ? '未找到匹配 Skill' : '暂无可用 Skill，请先在 Skill 市场上传并审批启用。'}
            </div>
          )}
        </div>
        
        <div className="my-2 border-b" />
        
        <h4 className="font-semibold text-sm">结构节点</h4>
        <div className="flex flex-col gap-2">
          {paletteNodeTypes.map((nodeType) => (
            <Button 
              key={nodeType} 
              variant="outline" 
              className="w-full justify-start flex items-center gap-2 bg-white"
              onClick={() => onAddStructureNode(nodeType)}
            >
              <GitBranch className="w-4 h-4" /> 新增 {nodeTypeLabel[nodeType]}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function schemaFieldCount(schema: Record<string, unknown> | null | undefined): number {
  return Object.keys(((schema ?? {}).properties ?? {}) as Record<string, unknown>).length;
}
