/**
 * Skill 创建页 — 零代码/低代码接入 SOP
 *
 * 三种创建模式:
 *   1. 在线代码编辑器: 粘贴 Python 函数 → 自动推断 Schema
 *   2. API 声明: 填写 URL + 参数 → 自动生成 REST API Skill
 *   3. 指令模式: 写自然语言描述 → Instruction Skill
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Code,
  Globe,
  FileText,
  Play,
  Save,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

type CreateMode = 'code' | 'api' | 'instruction';

interface CodeSkillForm {
  name: string;
  description: string;
  code: string;
  tags: string;
}

interface ApiSkillForm {
  name: string;
  description: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: string;
  bodyTemplate: string;
  tags: string;
}

interface InstructionSkillForm {
  name: string;
  description: string;
  instruction: string;
  model: string;
  tags: string;
}

const DEFAULT_CODE = `def run(input_data: dict, config: dict) -> dict:
    """
    在这里编写你的 Skill 逻辑。

    参数:
        input_data: 输入数据 (由工作流上游传入)
        config: 配置参数 (在工作流步骤中配置)

    返回:
        dict: 输出数据 (传给工作流下游)
    """
    text = input_data.get("text", "")

    # 在这里实现你的逻辑
    result = {
        "processed": True,
        "output": text.upper(),
        "length": len(text),
    }

    return result
`;

const INSTRUCTION_TEMPLATES = {
  'text-classify': {
    name: '文本分类',
    instruction: `请对以下文本进行分类。

分类类别:
- positive: 正面情感
- negative: 负面情感
- neutral: 中性

请返回 JSON 格式: {"label": "类别", "confidence": 0.95, "reason": "原因"}`,
  },
  'content-check': {
    name: '内容审核',
    instruction: `请检查以下内容是否符合规范。

检查维度:
1. 是否包含有害内容
2. 是否包含敏感信息
3. 是否符合业务规则

请返回 JSON 格式:
{"safe": true/false, "issues": ["问题1", "问题2"], "score": 0.95}`,
  },
  'text-extract': {
    name: '信息提取',
    instruction: `请从以下文本中提取关键信息。

提取字段:
- entities: 实体列表
- keywords: 关键词列表
- summary: 摘要

请返回 JSON 格式: {"entities": [...], "keywords": [...], "summary": "..."}`,
  },
  'quality-eval': {
    name: '质量评估',
    instruction: `请评估以下回答的质量。

评估维度:
- accuracy (0-1): 准确性
- completeness (0-1): 完整性
- fluency (0-1): 流畅性

请返回 JSON 格式:
{"accuracy": 0.9, "completeness": 0.85, "fluency": 0.95, "overall": 0.9, "feedback": "评价"}`,
  },
};

export function SkillCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<CreateMode>('code');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // Code mode state
  const [codeForm, setCodeForm] = useState<CodeSkillForm>({
    name: '',
    description: '',
    code: DEFAULT_CODE,
    tags: '',
  });

  // API mode state
  const [apiForm, setApiForm] = useState<ApiSkillForm>({
    name: '',
    description: '',
    url: '',
    method: 'POST',
    headers: '{"Content-Type": "application/json"}',
    bodyTemplate: '{"input": "{{input}}"}',
    tags: '',
  });

  // Instruction mode state
  const [instForm, setInstForm] = useState<InstructionSkillForm>({
    name: '',
    description: '',
    instruction: '',
    model: '',
    tags: '',
  });

  // Create mutation — 生成真实 zip 包
  const createMutation = useMutation({
    mutationFn: async () => {
      // 字段校验
      const form = mode === 'code' ? codeForm : mode === 'api' ? apiForm : instForm;
      if (!form.name.trim()) throw new Error('请填写 Skill 名称');
      if (mode === 'code' && !codeForm.code.trim()) throw new Error('请编写 Python 代码');
      if (mode === 'api' && !apiForm.url.trim()) throw new Error('请填写 API URL');
      if (mode === 'instruction' && !instForm.instruction.trim()) throw new Error('请编写指令内容');

      const zip = new JSZip();
      const skillId = `skill-${form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;

      if (mode === 'code') {
        // 代码模式: skill.yaml + handler.py
        zip.file('skill.yaml', [
          `skill_id: ${skillId}`,
          `name: ${form.name}`,
          `description: ${form.description || form.name}`,
          `version: 0.1.0`,
          `permissions: []`,
          `runtime:`,
          `  mode: script`,
          `  handler: handler.py`,
          `  function_name: run`,
          `example_input:`,
          `  text: hello`,
          `example_config: {}`,
        ].join('\n'));
        zip.file('handler.py', codeForm.code);
      } else if (mode === 'api') {
        // API 模式: skill.yaml + handler.py (调用外部 API)
        let headers: Record<string, string> = {};
        try { headers = JSON.parse(apiForm.headers || '{}'); } catch { /* ignore */ }
        zip.file('skill.yaml', [
          `skill_id: ${skillId}`,
          `name: ${form.name}`,
          `description: ${form.description || form.name}`,
          `version: 0.1.0`,
          `permissions: [network:http:request]`,
          `runtime:`,
          `  mode: script`,
          `  handler: handler.py`,
          `  function_name: run`,
          `example_input:`,
          `  text: hello`,
          `example_config: {}`,
        ].join('\n'));
        zip.file('handler.py', [
          `import json, urllib.request`,
          ``,
          `def run(input_data, config):`,
          `    url = "${apiForm.url}"`,
          `    headers = ${JSON.stringify(headers)}`,
          `    body = json.dumps(input_data).encode()`,
          `    req = urllib.request.Request(url, data=body, headers=headers, method="${apiForm.method}")`,
          `    with urllib.request.urlopen(req, timeout=30) as resp:`,
          `        return {"output": json.loads(resp.read())}`,
        ].join('\n'));
      } else {
        // 指令模式: SKILL.md
        zip.file('SKILL.md', [
          `---`,
          `name: ${form.name}`,
          `description: ${form.description || form.name}`,
          `version: 0.1.0`,
          `---`,
          ``,
          instForm.instruction,
        ].join('\n'));
      }

      // 生成 zip 的 base64
      const zipBlob = await zip.generateAsync({ type: 'uint8array' });
      const base64 = uint8ArrayToBase64(zipBlob);

      return api.uploadSkillPackage({
        filename: `${skillId}.zip`,
        content_base64: base64,
        conflict_strategy: 'new_version',
      });
    },
    onSuccess: async (result) => {
      // 等缓存刷新完成再触发合约测试，避免测试读到旧的 package 状态（如 stale last_contract_ok）。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['skills'] }),
        queryClient.invalidateQueries({ queryKey: ['skill-packages'] }),
      ]);
      // 如果上传成功，自动运行合约测试。
      // uploadSkillPackage 返回 SkillPackageRecord，skill_id 在 manifest 下而不是顶层，
      // 之前直接读 result.skill_id 永远拿不到值，导致上传后自动合约测试的链路是断的。
      const uploadedSkillId = result?.manifest?.skill_id;
      if (uploadedSkillId) {
        setUploadedSkillId(uploadedSkillId);
        testMutation.mutate(uploadedSkillId);
      }
    },
  });

  const [uploadedSkillId, setUploadedSkillId] = useState<string | null>(null);

  // Test mutation — 调用真实合约测试 API
  const testMutation = useMutation({
    mutationFn: async (skillId: string) => {
      setTestStatus('loading');
      setTestResult(null);
      return api.contractTest(skillId);
    },
    onSuccess: (result) => {
      setTestStatus(result.ok ? 'success' : 'error');
      setTestResult(
        result.ok
          ? `测试通过 (${result.latency_ms?.toFixed(0) ?? '?'}ms)\n${JSON.stringify(result.output, null, 2)}`
          : `测试失败: ${result.message ?? result.error ?? '未知错误'}`
      );
    },
    onError: (error) => {
      setTestStatus('error');
      setTestResult(`测试失败: ${error instanceof Error ? error.message : '未知错误'}`);
    },
  });

  const modes = [
    { key: 'code' as CreateMode, icon: Code, label: '在线代码', desc: '粘贴 Python 函数，自动推断 Schema' },
    { key: 'api' as CreateMode, icon: Globe, label: 'API 声明', desc: '填写 URL + 参数，自动生成 Skill' },
    { key: 'instruction' as CreateMode, icon: FileText, label: '指令模式', desc: '写自然语言描述，AI 自动执行' },
  ];

  return (
    <div className="flex flex-col gap-8 w-full max-w-7xl mx-auto p-6 md:p-8">
      <PageHeader
        eyebrow="能力接入"
        title="创建 Skill"
        description="选择接入方式，让你的 SOP 快速接入评测平台"
      />

      {/* Mode selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
        {modes.map(m => (
          <Card
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`p-6 cursor-pointer transition-all duration-300 border shadow-sm group ${
              mode === m.key 
                ? 'bg-indigo-50/80 border-indigo-500 shadow-indigo-500/20 shadow-lg scale-[1.02]' 
                : 'liquid-glass hover:bg-white/80 hover:border-indigo-300 hover:shadow-md'
            }`}
          >
            <div className="flex items-center gap-4 mb-3">
              <div className={`p-3 rounded-xl transition-colors ${
                mode === m.key ? 'bg-indigo-500 text-white shadow-md' : 'bg-white/80 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-500'
              }`}>
                <m.icon className="w-6 h-6" strokeWidth={mode === m.key ? 2.5 : 2} />
              </div>
              <span className={`text-lg font-bold ${
                mode === m.key ? 'text-indigo-700' : 'text-slate-700'
              }`}>
                {m.label}
              </span>
            </div>
            <div className={`text-sm font-medium ${mode === m.key ? 'text-indigo-600/80' : 'text-slate-500'}`}>
              {m.desc}
            </div>
          </Card>
        ))}
      </div>

      {/* Form area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {mode === 'code' && <CodeForm form={codeForm} onChange={setCodeForm} />}
          {mode === 'api' && <ApiForm form={apiForm} onChange={setApiForm} />}
          {mode === 'instruction' && (
            <InstructionForm
              form={instForm}
              onChange={setInstForm}
              onApplyTemplate={(key) => {
                const tpl = INSTRUCTION_TEMPLATES[key as keyof typeof INSTRUCTION_TEMPLATES];
                if (tpl) {
                  setInstForm(prev => ({
                    ...prev,
                    name: tpl.name,
                    instruction: tpl.instruction,
                  }));
                }
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Test & Create buttons */}
      <div className="flex flex-wrap items-center justify-end gap-4 mt-8 pt-6 border-t border-slate-200/50">
        <Button variant="ghost" onClick={() => navigate('/skills')} className="mr-auto font-semibold">
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (uploadedSkillId) {
              testMutation.mutate(uploadedSkillId);
            } else {
              createMutation.mutate(); // 先上传再自动测试
            }
          }}
          disabled={testStatus === 'loading' || createMutation.isPending}
          className="flex items-center gap-2 font-bold px-6 shadow-sm liquid-glass"
        >
          {testStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" fill="currentColor" />}
          {testStatus === 'loading' ? '测试中...' : '测试运行'}
        </Button>
        <Button
          variant="default"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-2 font-bold px-8 shadow-lg shadow-indigo-500/25"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          创建 Skill
        </Button>
      </div>

      {/* Test result */}
      {testResult && (
        <Card className={`p-6 liquid-glass flex flex-col border ${testStatus === 'success' ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50/50 border-rose-200'}`}>
          <div className="flex items-center gap-3 mb-4">
            {testStatus === 'success' ? (
              <CheckCircle className="w-6 h-6 text-emerald-500" />
            ) : (
              <AlertCircle className="w-6 h-6 text-rose-500" />
            )}
            <span className={`text-lg font-bold ${testStatus === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {testStatus === 'success' ? '测试通过' : '测试失败'}
            </span>
          </div>
          <div className="relative group/test-result">
            <pre className="w-full max-h-[300px] p-5 font-mono text-sm leading-relaxed border border-slate-200/50 rounded-2xl bg-white/60 text-slate-800 resize-y focus:outline-none shadow-inner overflow-auto">
              {testResult}
            </pre>
          </div>
        </Card>
      )}

      {createMutation.isError && (
        <Card style={{ marginTop: 16, background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} color="#ef4444" />
            <span style={{ color: '#ef4444' }}>{formatApiError(createMutation.error)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}


// ── Code Form ──────────────────────────────────────────────────────

function CodeForm({ form, onChange }: { form: CodeSkillForm; onChange: (f: CodeSkillForm) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8">
      {/* Left: metadata */}
      <Card className="p-6 liquid-glass flex flex-col gap-5">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">基本信息</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Skill 名称</label>
            <Input
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="如: 文本情感分析"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述</label>
            <textarea
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="描述这个 Skill 的功能..."
              className="w-full min-h-[100px] p-3 text-sm border border-slate-200/50 rounded-xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-sm transition-all"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">标签 (逗号分隔)</label>
            <Input
              value={form.tags}
              onChange={e => onChange({ ...form, tags: e.target.value })}
              placeholder="nlp, sentiment, analysis"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
        </div>
      </Card>

      {/* Right: code editor */}
      <Card className="p-6 liquid-glass flex flex-col group">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <Code className="w-5 h-5 text-indigo-500" /> Python 代码
          </h3>
          <span className="text-xs font-semibold text-slate-500 bg-white/60 px-3 py-1 rounded-full border border-slate-200/50">
            实现 run(input_data, config)
          </span>
        </div>
        <textarea
          value={form.code}
          onChange={e => onChange({ ...form, code: e.target.value })}
          className="w-full min-h-[450px] p-5 font-mono text-sm leading-relaxed border border-slate-200/50 rounded-2xl bg-slate-900/90 text-indigo-50 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner transition-all tab-size-4"
          spellCheck={false}
        />
        <div className="mt-4 text-xs font-semibold text-emerald-600 bg-emerald-50/80 px-4 py-2.5 rounded-xl border border-emerald-100 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          平台会自动推断 input_schema 和 output_schema，无需手动定义
        </div>
      </Card>
    </div>
  );
}


// ── API Form ──────────────────────────────────────────────────────

function ApiForm({ form, onChange }: { form: ApiSkillForm; onChange: (f: ApiSkillForm) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8">
      {/* Left: metadata */}
      <Card className="p-6 liquid-glass flex flex-col gap-5">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">基本信息</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Skill 名称</label>
            <Input
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="如: 客服 SOP 检测"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述</label>
            <textarea
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="描述这个 API 的功能..."
              className="w-full min-h-[100px] p-3 text-sm border border-slate-200/50 rounded-xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-sm transition-all"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">标签</label>
            <Input
              value={form.tags}
              onChange={e => onChange({ ...form, tags: e.target.value })}
              placeholder="api, sop, customer-service"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
        </div>
      </Card>

      {/* Right: API config */}
      <Card className="p-6 liquid-glass flex flex-col gap-5">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
          <Globe className="w-5 h-5 text-indigo-500" /> API 配置
        </h3>
        <div className="flex flex-col gap-5">
          <div className="flex gap-3">
            <select
              value={form.method}
              onChange={e => onChange({ ...form, method: e.target.value as 'GET' | 'POST' | 'PUT' })}
              className="px-4 py-2 bg-white/60 border border-slate-200/50 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-bold shadow-sm"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
            <Input
              value={form.url}
              onChange={e => onChange({ ...form, url: e.target.value })}
              placeholder="https://api.example.com/sop/evaluate"
              className="flex-1 bg-white/60 border-slate-200/50 shadow-sm font-mono text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">请求头 (JSON)</label>
            <textarea
              value={form.headers}
              onChange={e => onChange({ ...form, headers: e.target.value })}
              className="w-full min-h-[80px] p-4 font-mono text-sm border border-slate-200/50 rounded-xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              请求体模板 (JSON) <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px]">支持 {'{{input.field}}'} 变量</span>
            </label>
            <textarea
              value={form.bodyTemplate}
              onChange={e => onChange({ ...form, bodyTemplate: e.target.value })}
              className="w-full min-h-[160px] p-4 font-mono text-sm leading-relaxed border border-slate-200/50 rounded-xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner transition-all"
            />
          </div>

          <div className="bg-indigo-50/80 p-4 rounded-xl border border-indigo-100 text-sm text-indigo-800">
            <strong className="block mb-2 font-bold">变量说明:</strong>
            <ul className="list-disc pl-5 space-y-1 font-medium text-indigo-700/80">
              <li><code className="bg-white/60 px-1.5 py-0.5 rounded text-indigo-900 border border-indigo-200/50">{'{{input.field}}'}</code> — 引用输入数据的字段</li>
              <li><code className="bg-white/60 px-1.5 py-0.5 rounded text-indigo-900 border border-indigo-200/50">{'{{config.param}}'}</code> — 引用配置参数</li>
              <li><code className="bg-white/60 px-1.5 py-0.5 rounded text-indigo-900 border border-indigo-200/50">{'${ENV_VAR}'}</code> — 引用环境变量 (如 API Key)</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}


// ── Instruction Form ──────────────────────────────────────────────

function InstructionForm({
  form,
  onChange,
  onApplyTemplate,
}: {
  form: InstructionSkillForm;
  onChange: (f: InstructionSkillForm) => void;
  onApplyTemplate: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8">
      {/* Left: metadata + templates */}
      <Card className="p-6 liquid-glass flex flex-col gap-5">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">基本信息</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Skill 名称</label>
            <Input
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="如: 文本分类器"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述</label>
            <textarea
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="描述这个 Skill 的功能..."
              className="w-full min-h-[80px] p-3 text-sm border border-slate-200/50 rounded-xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-sm transition-all"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">标签</label>
            <Input
              value={form.tags}
              onChange={e => onChange({ ...form, tags: e.target.value })}
              placeholder="instruction, classify"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型 (可选)</label>
            <Input
              value={form.model}
              onChange={e => onChange({ ...form, model: e.target.value })}
              placeholder="留空则使用默认模型"
              className="bg-white/60 border-slate-200/50 shadow-sm"
            />
          </div>
        </div>

        {/* Templates */}
        <div className="mt-4 pt-5 border-t border-slate-200/50">
          <h4 className="font-bold text-slate-700 mb-3 text-sm">快速模板</h4>
          <div className="flex flex-col gap-2">
            {Object.entries(INSTRUCTION_TEMPLATES).map(([key, tpl]) => (
              <button
                key={key}
                onClick={() => onApplyTemplate(key)}
                className="text-left px-3.5 py-2.5 border border-slate-200/50 rounded-xl bg-white/60 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 font-medium text-sm text-slate-600 transition-all shadow-sm"
              >
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Right: instruction editor */}
      <Card className="p-6 liquid-glass flex flex-col group">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" /> 指令内容
          </h3>
          <span className="text-xs font-semibold text-slate-500 bg-white/60 px-3 py-1 rounded-full border border-slate-200/50">
            用自然语言描述你希望 AI 做什么
          </span>
        </div>
        <textarea
          value={form.instruction}
          onChange={e => onChange({ ...form, instruction: e.target.value })}
          placeholder={`请在这里编写你的指令...

示例:
请对以下文本进行情感分析，返回 JSON 格式:
- label: positive/negative/neutral
- confidence: 0-1 的置信度
- reason: 判断原因`}
          className="w-full min-h-[400px] p-5 font-mono text-sm leading-relaxed border border-slate-200/50 rounded-2xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner transition-all"
        />
        <div className="mt-4 flex flex-col gap-2 text-xs font-semibold text-slate-500 bg-white/40 p-4 rounded-xl border border-slate-100">
          <span className="flex items-center gap-2"><span className="text-amber-500">💡</span> 提示: 在指令中明确输出格式 (如 JSON) 可以提高解析成功率</span>
          <span className="flex items-center gap-2"><span className="text-emerald-500">📝</span> 支持 <code className="bg-white/80 border border-slate-200 px-1 rounded mx-0.5">{'{{input.field}}'}</code> 引用输入数据</span>
        </div>
      </Card>
    </div>
  );
}


// ── Helpers ──────────────────────────────────────────────────────

/** Uint8Array → base64 (兼容中文) */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
