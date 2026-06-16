import { X } from 'lucide-react';
import type { SkillManifest } from '../../types';

type SkillDetailDrawerProps = {
  skill: SkillManifest | null;
  onClose: () => void;
};

export function SkillDetailDrawer({ skill, onClose }: SkillDetailDrawerProps) {
  if (!skill) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/40 z-[100] transition-opacity" 
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-[560px] bg-white shadow-xl z-[101] overflow-y-auto flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Skill 详情：{skill.name}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-6">
          <div className="border rounded-lg overflow-hidden text-sm shadow-sm">
            <div className="grid grid-cols-3 border-b">
              <div className="bg-slate-50 p-3 font-medium text-slate-700">Skill ID</div>
              <div className="col-span-2 p-3 font-mono text-xs break-all flex items-center">{skill.skill_id}</div>
            </div>
            <div className="grid grid-cols-3 border-b">
              <div className="bg-slate-50 p-3 font-medium text-slate-700">版本</div>
              <div className="col-span-2 p-3">{skill.version}</div>
            </div>
            <div className="grid grid-cols-3 border-b">
              <div className="bg-slate-50 p-3 font-medium text-slate-700">状态</div>
              <div className="col-span-2 p-3 flex gap-2 items-center">
                <span className={`px-2 py-1 text-xs rounded font-medium ${skill.enabled && skill.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                  {skill.status}
                </span>
                <span className="px-2 py-1 text-xs rounded font-medium bg-slate-100 text-slate-800">
                  {skill.enabled ? '已启用' : '未启用'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 border-b">
              <div className="bg-slate-50 p-3 font-medium text-slate-700">描述</div>
              <div className="col-span-2 p-3">{skill.description}</div>
            </div>
            <div className="grid grid-cols-3 border-b">
              <div className="bg-slate-50 p-3 font-medium text-slate-700">标签</div>
              <div className="col-span-2 p-3">{skill.tags.join('、') || '-'}</div>
            </div>
            <div className="grid grid-cols-3">
              <div className="bg-slate-50 p-3 font-medium text-slate-700">场景</div>
              <div className="col-span-2 p-3">{skill.scenarios.join('、') || '-'}</div>
            </div>
          </div>

          <div className="border rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold mb-2">输入字段</h3>
            <p className="text-slate-500 text-sm">{Object.keys(schemaProperties(skill.input_schema)).join('、') || '无'}</p>
          </div>

          <div className="border rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold mb-2">输出字段</h3>
            <p className="text-slate-500 text-sm">{Object.keys(schemaProperties(skill.output_schema)).join('、') || '无'}</p>
          </div>

          <div className="border rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold mb-2">输入 Schema</h3>
            <pre className="bg-slate-50 p-3 rounded text-xs overflow-x-auto text-slate-800">{JSON.stringify(skill.input_schema, null, 2)}</pre>
          </div>

          <div className="border rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold mb-2">输出 Schema</h3>
            <pre className="bg-slate-50 p-3 rounded text-xs overflow-x-auto text-slate-800">{JSON.stringify(skill.output_schema, null, 2)}</pre>
          </div>

          <div className="border rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold mb-2">配置 Schema</h3>
            <pre className="bg-slate-50 p-3 rounded text-xs overflow-x-auto text-slate-800">{JSON.stringify(skill.config_schema, null, 2)}</pre>
          </div>
        </div>
      </div>
    </>
  );
}

function schemaProperties(schema: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return ((schema ?? {}).properties ?? {}) as Record<string, unknown>;
}
