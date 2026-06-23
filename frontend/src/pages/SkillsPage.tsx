import { CheckCircle, Copy, Database, FlaskConical, Inbox, Info, ArrowLeftRight, Tag, Upload } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/Dialog';
import type { SkillContractResult, SkillManifest, SkillPackageRecord, SkillVersionHistory, SkillVersionHistoryItem } from '../types';
import { isMoreCanonicalPackage } from '../lib/skillPackageUtils';

type ConflictStrategy = 'error' | 'replace' | 'new_version';

export function SkillsPage() {
  const queryClient = useQueryClient();
  const [activeSkill, setActiveSkill] = useState<SkillManifest | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [skillQuery, setSkillQuery] = useState('');
  const [contractResultText, setContractResultText] = useState<string | null>(null);
  const [contractResult, setContractResult] = useState<SkillContractResult | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  useEffect(() => {
    setCurrentPage(1);
  }, [skillQuery, statusFilter]);

  // 冲突处理状态
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictSkillId, setConflictSkillId] = useState<string | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('error');
  const [pendingUploadValues, setPendingUploadValues] = useState<{ filename: string } | null>(null);

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

  const paginatedSkills = useMemo(() => {
    return filteredSkills.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filteredSkills, currentPage, pageSize]);

  const uploadMutation = useMutation({
    mutationFn: async ({ values, strategy }: { values: { filename: string }; strategy?: ConflictStrategy }) => {
      if (!uploadFile) {
        throw new Error('请选择 zip 插件包。');
      }
      const content_base64 = await readFileBase64(uploadFile);
      return api.uploadSkillPackage({
        filename: values.filename || uploadFile.name,
        content_base64,
        conflict_strategy: strategy || 'error',
      });
    },
    onSuccess: async (record) => {
      const actionText = conflictStrategy === 'replace' ? '已替换' : conflictStrategy === 'new_version' ? '已创建新版本' : '已上传';
      setNotice(`插件包${actionText}：${record.manifest.skill_id}，当前状态 ${record.status}`);
      setUploadOpen(false);
      setUploadFile(null);
      setFilename('');
      setConflictModalOpen(false);
      setPendingUploadValues(null);
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
    },
    onError: (error: unknown) => {
      const errorObj = error as { code?: string; message?: string; details?: { existing_skill_id?: string } };
      if (errorObj?.code === 'SKILL_ALREADY_EXISTS') {
        setConflictSkillId(errorObj.details?.existing_skill_id || null);
        setConflictModalOpen(true);
        setPendingUploadValues({ filename });
      } else {
        setNotice(`上传失败：${formatApiError(error)}`);
      }
    },
  });

  const handleConflictResolve = () => {
    if (pendingUploadValues) {
      uploadMutation.mutate({ values: pendingUploadValues, strategy: conflictStrategy });
    }
  };

  const contractMutation = useMutation({
    mutationFn: (skillId: string) => api.contractTest(skillId),
    onSuccess: async (result) => {
      const retryInfo = (result.retry_count ?? 0) > 0 ? ` (重试 ${result.retry_count} 次)` : '';
      const text = result.ok
        ? `合约测试通过：${result.skill_id}${retryInfo}，耗时 ${Math.round(result.latency_ms ?? 0)}ms`
        : `合约测试失败：${result.message ?? result.error ?? '未知错误'}${retryInfo}`;
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
    <section className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-6">
      <PageHeader
        eyebrow="能力市场"
        title="Skill 市场"
        description="上传、审批和管理可被 Workflow 引用的 Agent Skill 包。脚本型 Skill 直接跑参数逻辑，说明型 Skill 通过模型网关执行。"
        primaryAction={(
          <Button variant="default" onClick={() => setUploadOpen(true)} className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> 上传 Agent Skill 包
          </Button>
        )}
      />

      {notice && (
        <div className={`p-4 rounded-lg flex items-start gap-3 ${notice.includes('失败') ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
          <div className="flex-1 text-sm font-medium">{notice}</div>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100">&times;</button>
        </div>
      )}

      {skillsQuery.isError && (
        <div className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm font-medium">
          Skill 列表加载失败：{formatApiError(skillsQuery.error)}
        </div>
      )}

      <div className="flex flex-wrap justify-between items-center gap-4 mb-2">
        <div className="flex items-center gap-4 flex-wrap">
          <Input
            placeholder="搜索 Skill 名称或 ID"
            className="w-80"
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="all">全部状态</option>
            <option value="approved">已审批</option>
            <option value="pending_review">审核中</option>
            <option value="disabled">已禁用</option>
            <option value="deprecated">已弃用</option>
          </select>
        </div>
      </div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{
          hidden: { opacity: 0 },
          show: { opacity: 1, transition: { staggerChildren: 0.05 } }
        }}
      >
        {skillsQuery.isLoading ? (
          <div className="text-center py-12 text-slate-500 text-sm">加载中...</div>
        ) : filteredSkills.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm bg-slate-50 rounded-2xl border border-slate-100">暂无 Skill，请上传 Agent Skill 包并完成合约测试和审批。</div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
              {paginatedSkills.map((record) => {
              const packageRecord = packageBySkillId[record.skill_id];
              const isContractOk = packageRecord?.last_contract_ok;
              const runtimeMode = packageRecord ? formatPackageRuntime(packageRecord.runtime_mode) : 'builtin';

              return (
                <motion.div
                  key={record.skill_id}
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
                  }}
                  className="h-full flex min-w-0"
                >
                  <Card className="flex-1 flex flex-col group p-6 hover:shadow-lg transition-shadow liquid-glass min-w-0">
                    <div className="flex justify-between items-start mb-5 gap-4 w-full min-w-0">
                      <div className="flex gap-3 group-hover:translate-x-1 transition-transform overflow-hidden min-w-0 flex-1">
                        <div className="p-3 bg-violet-50 rounded-2xl text-violet-500 shadow-inner flex items-center justify-center flex-shrink-0">
                          <FlaskConical className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-lg font-bold text-slate-800 leading-tight truncate" title={record.name}>{record.name}</span>
                          <span className="text-xs font-mono text-slate-500 mt-1 truncate" title={record.skill_id}>{record.skill_id}</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full flex-shrink-0 whitespace-nowrap ${record.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {formatSkillStatus(record.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-5 min-w-0">
                      {record.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">{tag}</span>
                      ))}
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-md font-medium">{runtimeMode}</span>
                    </div>

                    <div className="text-sm text-slate-500 flex flex-col gap-2 mb-6 font-medium min-w-0">
                      <div className="flex justify-between bg-slate-50 px-3 py-2 rounded-lg items-center min-w-0 gap-2">
                        <span className="truncate flex-1">合约验证</span>
                        <span className={`truncate flex-shrink-0 max-w-[50%] text-right ${isContractOk ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}`}>
                          {!packageRecord ? '内置 Skill' : (isContractOk ? 'Pass' : 'Failed')}
                        </span>
                      </div>
                      <div className="flex justify-between px-3 min-w-0 gap-2">
                        <span className="truncate flex-1">审批人</span>
                        <span className="truncate flex-shrink-0 max-w-[50%] text-right">{packageRecord?.approved_by ?? '未审批'}</span>
                      </div>
                    </div>

                    <div className="mt-auto pt-4 border-t border-slate-100 flex justify-end min-w-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full shadow-sm flex items-center gap-1.5"
                        onClick={() => {
                          setContractResultText(null);
                          setContractResult(null);
                          setActiveSkill(record);
                        }}
                      >
                        <Info className="w-4 h-4" /> 配置与检查
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
            </div>

            {filteredSkills.length > pageSize && (
              <div className="flex items-center justify-between mt-8 pt-4 border-t border-slate-200/50">
                <div className="text-sm text-slate-500 font-medium">
                  显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredSkills.length)} 条，共 {filteredSkills.length} 条
                </div>
                <div className="flex items-center gap-1.5">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 rounded-full shadow-sm liquid-glass"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    上一页
                  </Button>
                  <div className="text-sm font-bold text-slate-700 px-3">
                    {currentPage} / {Math.ceil(filteredSkills.length / pageSize)}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 rounded-full shadow-sm liquid-glass"
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredSkills.length / pageSize), p + 1))}
                    disabled={currentPage === Math.ceil(filteredSkills.length / pageSize)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>

      <Dialog open={Boolean(activeSkill)} onOpenChange={(open) => !open && setActiveSkill(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activeSkill?.name}</DialogTitle>
          </DialogHeader>
          {activeSkill && (
            <div className="flex flex-col gap-6 py-4">
              <p className="text-sm text-slate-700">{activeSkill.description}</p>
              
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <h4 className="text-sm font-bold text-slate-800 mb-2">合约测试做什么</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  使用 Skill manifest 里的 example_input 和 example_config 执行一次 Skill，验证输入 schema、输出 schema、运行入口和返回结构是否正常。
                  脚本型会调用 runtime.entrypoint，说明型会读取 SKILL.md 和 references 后走统一模型网关。
                </p>
              </div>

              {packageBySkillId[activeSkill.skill_id] && (
                <>
                  <div className="border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-2">Agent Skill 包启用步骤</h4>
                    <div className="flex flex-col gap-1 text-xs text-slate-600">
                      <span>第 1 步：上传 zip 包，包内包含 SKILL.md，脚本型还需要 skill.yaml/skill.json 声明 schema 和 runtime.entrypoint。</span>
                      <span>第 2 步：运行合约测试，确认 example_input、example_config 和输出 schema 能对齐。</span>
                      <span>第 3 步：治理页审批启用</span>
                      <span>第 4 步：Workflow 画布中搜索并添加</span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-3">包运行方式</h4>
                    <div className="grid grid-cols-[100px_1fr] gap-2 text-xs">
                      <span className="text-slate-500 font-medium">运行模式</span>
                      <span className="text-slate-800">{formatPackageRuntime(packageBySkillId[activeSkill.skill_id].runtime_mode)}</span>
                      <span className="text-slate-500 font-medium">脚本入口</span>
                      <span className="text-slate-800">{packageBySkillId[activeSkill.skill_id].entrypoint ?? '-'}</span>
                      <span className="text-slate-500 font-medium">SKILL.md</span>
                      <span className="text-slate-800">{packageBySkillId[activeSkill.skill_id].skill_md_path ?? '-'}</span>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-3">插件审批状态</h4>
                    <div className="flex flex-wrap gap-4 items-center text-xs">
                      <span className={`px-2 py-1 rounded-md font-medium ${packageBySkillId[activeSkill.skill_id].last_contract_ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {packageBySkillId[activeSkill.skill_id].last_contract_ok ? '合约已通过' : '合约未通过'}
                      </span>
                      <span className="text-slate-600">审批人：{packageBySkillId[activeSkill.skill_id].approved_by ?? '未审批'}</span>
                      <span className="text-slate-600">审批时间：{packageBySkillId[activeSkill.skill_id].approved_at ?? '未审批'}</span>
                    </div>
                  </div>

                  <SkillVersionHistoryCard
                    activeSkill={activeSkill}
                    history={versionHistoryQuery.data}
                    loading={versionHistoryQuery.isLoading}
                    rollbackLoading={rollbackMutation.isPending}
                    onRollback={(targetSkillId) => rollbackMutation.mutate({ sourceSkillId: activeSkill.skill_id, targetSkillId })}
                  />
                </>
              )}

              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-800 mb-2">输入 Schema</h4>
                <pre className="text-[11px] bg-slate-50 p-3 rounded-lg overflow-x-auto text-slate-700 border border-slate-100">{JSON.stringify(activeSkill.input_schema, null, 2)}</pre>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-800 mb-2">输出 Schema</h4>
                <pre className="text-[11px] bg-slate-50 p-3 rounded-lg overflow-x-auto text-slate-700 border border-slate-100">{JSON.stringify(activeSkill.output_schema, null, 2)}</pre>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-800 mb-2">配置 Schema</h4>
                <pre className="text-[11px] bg-slate-50 p-3 rounded-lg overflow-x-auto text-slate-700 border border-slate-100">{JSON.stringify(activeSkill.config_schema, null, 2)}</pre>
              </div>

              {contractResultText && (
                <div className={`p-3 rounded-lg text-sm font-medium ${contractResultText.includes('通过') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {contractResultText}
                </div>
              )}
              
              {contractResult && <ContractResultCard result={contractResult} activeSkill={activeSkill} packageRecord={packageBySkillId[activeSkill.skill_id]} />}

              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <Button variant="default" className="flex items-center gap-2" disabled={contractMutation.isPending} onClick={() => contractMutation.mutate(activeSkill.skill_id)} title="会用示例输入和示例配置真实执行一次 Skill，并检查输入输出 schema。">
                  <CheckCircle className="w-4 h-4" />
                  {contractMutation.isPending ? '运行中 (最长 60s)...' : '运行合约测试'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传 Agent Skill 包</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-xs border border-blue-100">
              <strong className="block mb-1">zip 包格式</strong>
              推荐包含 SKILL.md、skill.yaml 或 skill.json、scripts、references、assets。纯参数或脚本型 Skill 必须在 skill.yaml/skill.json 中声明 input_schema、output_schema、config_schema 和 runtime.mode=script；说明型 Skill 使用 runtime.mode=instruction_model。旧的 handler.py 插件仍兼容。
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-700">文件名</label>
              <Input placeholder="echo_skill.zip" value={filename} onChange={(e) => setFilename(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-700">选择文件</label>
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 hover:border-indigo-400 transition-colors cursor-pointer relative">
                <input
                  type="file"
                  accept=".zip"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadFile(file);
                      setFilename(file.name);
                    }
                  }}
                />
                <Inbox className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-700 mb-1">
                  {uploadFile ? uploadFile.name : '点击或拖拽文件到此处上传'}
                </p>
                <p className="text-xs text-slate-500">
                  脚本型示例：SKILL.md + skill.yaml + scripts/run.py；说明型示例：SKILL.md + skill.yaml + references/。
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>取消</Button>
            <Button variant="default" disabled={!uploadFile || uploadMutation.isPending} onClick={() => uploadMutation.mutate({ values: { filename } })}>
              {uploadMutation.isPending ? '提交中...' : '提交上传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conflictModalOpen} onOpenChange={(open) => !open && setConflictModalOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skill 名称冲突</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-6 py-4">
            <div className="bg-amber-50 text-amber-800 p-4 rounded-xl text-sm border border-amber-200">
              <div className="font-bold flex items-center gap-2 mb-2"><Info className="w-4 h-4" />已存在同名 Skill</div>
              <p>系统中已存在名为 <code className="bg-amber-100 px-1 rounded">{conflictSkillId}</code> 的 Skill。</p>
              <p className="text-amber-700 opacity-80 mt-1 text-xs">请选择处理方式：</p>
            </div>

            <div className="flex flex-col gap-3">
              <label className={`flex gap-3 p-4 border rounded-xl cursor-pointer hover:border-indigo-400 transition-colors ${conflictStrategy === 'new_version' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                <input type="radio" name="conflict" value="new_version" checked={conflictStrategy === 'new_version'} onChange={() => setConflictStrategy('new_version')} className="mt-1" />
                <div className="flex gap-3">
                  <Copy className="w-6 h-6 text-indigo-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-800">创建新版本</span>
                    <span className="text-xs text-slate-500 mt-0.5">自动递增版本号，保留历史版本记录</span>
                  </div>
                </div>
              </label>

              <label className={`flex gap-3 p-4 border rounded-xl cursor-pointer hover:border-amber-400 transition-colors ${conflictStrategy === 'replace' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <input type="radio" name="conflict" value="replace" checked={conflictStrategy === 'replace'} onChange={() => setConflictStrategy('replace')} className="mt-1" />
                <div className="flex gap-3">
                  <ArrowLeftRight className="w-6 h-6 text-amber-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-800">替换现有版本</span>
                    <span className="text-xs text-slate-500 mt-0.5">覆盖当前版本，历史版本将被标记为已替换</span>
                  </div>
                </div>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setConflictModalOpen(false);
              setPendingUploadValues(null);
            }}>取消</Button>
            <Button variant="default" disabled={uploadMutation.isPending} onClick={handleConflictResolve}>
              确认{conflictStrategy === 'replace' ? '替换' : conflictStrategy === 'new_version' ? '创建新版本' : '上传'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className="border border-slate-200 rounded-xl p-4 bg-white">
      <h4 className="text-sm font-bold text-slate-800 mb-4">版本历史</h4>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[100px_1fr] gap-2 text-xs">
          <span className="text-slate-500 font-medium">版本族</span>
          <span className="text-slate-800">{history?.base_skill_id ?? activeSkill.skill_id.split('@')[0]}</span>
          <span className="text-slate-500 font-medium">当前启用版本</span>
          <span className="text-slate-800">{history?.latest_approved_skill_id ?? '-'}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 font-medium">Skill ID</th>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">差异</th>
                <th className="px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-500">加载中...</td></tr>
              ) : versions.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-500">暂无版本历史</td></tr>
              ) : (
                versions.map(record => (
                  <tr key={record.skill_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2"><code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{record.skill_id}</code></td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${record.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {formatSkillStatus(String(record.status))}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {record.diff_from_previous.length ? record.diff_from_previous.map((diff) => (
                          <span key={diff.field} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">{diff.field}</span>
                        )) : <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">初始版本</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {record.skill_id === activeSkill.skill_id ? (
                        <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-md text-[10px] font-bold">当前</span>
                      ) : (
                        <button
                          disabled={rollbackLoading}
                          onClick={() => onRollback(record.skill_id)}
                          className="px-2 py-1 border border-slate-300 text-slate-600 rounded text-[10px] hover:bg-slate-100 transition-colors disabled:opacity-50"
                        >
                          回滚到此版本
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <LifecycleHistory title="合约测试历史" items={activeVersion?.contract_history ?? []} />
        <LifecycleHistory title="审批历史" items={activeVersion?.approval_history ?? []} />
      </div>
    </div>
  );
}

function LifecycleHistory({ title, items }: { title: string; items: Record<string, unknown>[] }) {
  return (
    <section>
      <h5 className="text-xs font-bold text-slate-700 mb-2">{title}</h5>
      {items.length ? (
        <div className="flex flex-col gap-1 text-[11px] text-slate-600">
          {items.map((item, index) => (
            <div key={`${title}-${index}`} className="flex gap-2">
              <span className="text-slate-400">{String(item.created_at ?? '-')}</span>
              <span>/</span>
              <span className={item.ok ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                {String(item.action ?? (item.ok ? 'contract_passed' : 'contract_failed'))}
              </span>
              <span>/</span>
              <span className="text-slate-500">{String(item.actor ?? 'api')}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-slate-400">暂无记录</div>
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

function indexPackagesBySkillId(packages: SkillPackageRecord[]): Record<string, SkillPackageRecord> {
  // 见 src/lib/skillPackageUtils.ts：与后端 _find_skill_package 对齐，取「未被替换且最新」的记录。
  return packages.reduce<Record<string, SkillPackageRecord>>((index, item) => {
    const skillId = item.manifest.skill_id;
    const current = index[skillId];
    if (!current || isMoreCanonicalPackage(item, current)) {
      index[skillId] = item;
    }
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
    <div className="border border-slate-200 rounded-xl p-4 bg-white">
      <h4 className="text-sm font-bold text-slate-800 mb-4">合约测试结果</h4>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[80px_1fr] gap-x-4 gap-y-3 text-xs">
          <span className="text-slate-500 font-medium pt-1">测试输入</span>
          <pre className="bg-slate-50 p-2 rounded border border-slate-100 overflow-x-auto text-[10px] text-slate-700 m-0">{JSON.stringify(activeSkill.example_input, null, 2)}</pre>
          
          <span className="text-slate-500 font-medium pt-1">测试配置</span>
          <pre className="bg-slate-50 p-2 rounded border border-slate-100 overflow-x-auto text-[10px] text-slate-700 m-0">{JSON.stringify(activeSkill.example_config, null, 2)}</pre>
          
          <span className="text-slate-500 font-medium pt-1">输出结果</span>
          <pre className="bg-slate-50 p-2 rounded border border-slate-100 overflow-x-auto text-[10px] text-slate-700 m-0">{JSON.stringify(result.output ?? {}, null, 2)}</pre>
          
          <span className="text-slate-500 font-medium pt-1">耗时</span>
          <span className="text-slate-800 pt-1">{result.latency_ms == null ? '-' : `${Number(result.latency_ms).toFixed(2)} ms`}</span>
          
          {!result.ok && (
            <>
              <span className="text-slate-500 font-medium pt-1">错误码</span>
              <span className="text-red-600 font-mono pt-1">{errorCode ?? '-'}</span>
              
              <span className="text-slate-500 font-medium pt-1">错误信息</span>
              <span className="text-red-600 pt-1 break-words">{result.message ?? result.error ?? '-'}</span>
            </>
          )}
        </div>
        
        {!result.ok && (
          <div className="mt-2 bg-amber-50 text-amber-800 p-3 rounded-lg border border-amber-200 text-xs">
            <strong className="block mb-1">修复建议</strong>
            {suggestion}
          </div>
        )}
      </div>
    </div>
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
