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
    <Card className="shadow-none border-0 flex-1 min-h-0 flex flex-col rounded-none">
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
                  <div 
                    key={skill.skill_id} 
                    className="group border border-slate-200 rounded-xl p-3 flex flex-col gap-2.5 bg-white transition-all hover:border-blue-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-sm text-slate-800 truncate" title={skill.name}>
                        {skill.name}
                      </h4>
                      <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] rounded-full font-medium ${
                        disabled ? 'bg-orange-100 text-orange-800 border border-orange-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {skill.status === 'approved' ? 'Approved' : skill.status}
                      </span>
                    </div>
                    
                    {skill.description && (
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed" title={skill.description}>
                        {skill.description}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium">
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                        输入 {schemaFieldCount(skill.input_schema)}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                        输出 {schemaFieldCount(skill.output_schema)}
                      </div>
                    </div>

                    {disabled && <p className="text-[10px] text-orange-600 bg-orange-50 px-2 py-1 rounded">⚠️ Skill 暂未发布或被禁用</p>}
                    
                    <div className="flex gap-2 mt-1">
                      <Button 
                        size="sm" 
                        variant="default" 
                        disabled={disabled} 
                        onClick={() => onAddSkill(skill)}
                        className="flex-1 h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> 添加
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => onShowSkill(skill)}
                        className="h-7 text-xs px-3 border-slate-200 hover:bg-slate-50 text-slate-600"
                      >
                        详情
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
