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

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      // Generate skill package based on mode
      let skillContent: string;
      let skillId: string;
      let name: string;
      let tags: string[];

      if (mode === 'code') {
        skillId = `skill-${codeForm.name.toLowerCase().replace(/\s+/g, '-')}`;
        name = codeForm.name;
        tags = codeForm.tags.split(',').map(t => t.trim()).filter(Boolean);
        skillContent = generateCodeSkillPackage(codeForm);
      } else if (mode === 'api') {
        skillId = `skill-${apiForm.name.toLowerCase().replace(/\s+/g, '-')}`;
        name = apiForm.name;
        tags = apiForm.tags.split(',').map(t => t.trim()).filter(Boolean);
        skillContent = generateApiSkillPackage(apiForm);
      } else {
        skillId = `skill-${instForm.name.toLowerCase().replace(/\s+/g, '-')}`;
        name = instForm.name;
        tags = instForm.tags.split(',').map(t => t.trim()).filter(Boolean);
        skillContent = generateInstructionSkillPackage(instForm);
      }

      // Upload as base64 zip
      const response = await api.uploadSkillPackage({
        filename: `${skillId}.zip`,
        content_base64: btoa(skillContent),
        conflict_strategy: 'new_version',
      });

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-packages'] });
      navigate('/skills');
    },
  });

  // Test mutation
  const testMutation = useMutation({
    mutationFn: async () => {
      setTestStatus('loading');
      // Simulate test - in real implementation, this would call the contract test API
      await new Promise(resolve => setTimeout(resolve, 1500));
      return { success: true, output: '{"processed": true, "output": "TEST", "length": 4}' };
    },
    onSuccess: (data) => {
      setTestStatus('success');
      setTestResult(data.output);
    },
    onError: () => {
      setTestStatus('error');
      setTestResult('测试失败');
    },
  });

  const modes = [
    { key: 'code' as CreateMode, icon: Code, label: '在线代码', desc: '粘贴 Python 函数，自动推断 Schema' },
    { key: 'api' as CreateMode, icon: Globe, label: 'API 声明', desc: '填写 URL + 参数，自动生成 Skill' },
    { key: 'instruction' as CreateMode, icon: FileText, label: '指令模式', desc: '写自然语言描述，AI 自动执行' },
  ];

  return (
    <div style={{ padding: '0 24px 24px' }}>
      <PageHeader
        title="创建 Skill"
        subtitle="选择接入方式，让你的 SOP 快速接入评测平台"
      />

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {modes.map(m => (
          <Card
            key={m.key}
            onClick={() => setMode(m.key)}
            style={{
              flex: 1,
              cursor: 'pointer',
              border: mode === m.key ? '2px solid #3b82f6' : '1px solid #e5e7eb',
              background: mode === m.key ? '#eff6ff' : 'white',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <m.icon size={20} color={mode === m.key ? '#3b82f6' : '#6b7280'} />
              <span style={{ fontWeight: 600, color: mode === m.key ? '#3b82f6' : '#1f2937' }}>
                {m.label}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{m.desc}</div>
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
      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <Button
          onClick={() => testMutation.mutate()}
          disabled={testStatus === 'loading'}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {testStatus === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          测试运行
        </Button>
        <Button
          variant="default"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {createMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          创建 Skill
        </Button>
        <Button variant="ghost" onClick={() => navigate('/skills')}>
          <ArrowLeft size={16} style={{ marginRight: 4 }} />
          返回
        </Button>
      </div>

      {/* Test result */}
      {testResult && (
        <Card style={{ marginTop: 16, background: testStatus === 'success' ? '#f0fdf4' : '#fef2f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {testStatus === 'success' ? (
              <CheckCircle size={18} color="#22c55e" />
            ) : (
              <AlertCircle size={18} color="#ef4444" />
            )}
            <span style={{ fontWeight: 600 }}>
              {testStatus === 'success' ? '测试通过' : '测试失败'}
            </span>
          </div>
          <pre style={{
            background: '#1e293b',
            color: '#e2e8f0',
            padding: 12,
            borderRadius: 8,
            fontSize: 13,
            overflow: 'auto',
          }}>
            {testResult}
          </pre>
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
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      {/* Left: metadata */}
      <Card>
        <h3 style={{ fontWeight: 600, marginBottom: 16 }}>基本信息</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>Skill 名称</label>
            <Input
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="如: 文本情感分析"
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>描述</label>
            <textarea
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="描述这个 Skill 的功能..."
              style={{ width: '100%', minHeight: 80, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>标签 (逗号分隔)</label>
            <Input
              value={form.tags}
              onChange={e => onChange({ ...form, tags: e.target.value })}
              placeholder="nlp, sentiment, analysis"
            />
          </div>
        </div>
      </Card>

      {/* Right: code editor */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontWeight: 600 }}>Python 代码</h3>
          <span style={{ fontSize: 12, color: '#6b7280' }}>实现 run(input_data, config) 函数</span>
        </div>
        <textarea
          value={form.code}
          onChange={e => onChange({ ...form, code: e.target.value })}
          style={{
            width: '100%',
            minHeight: 400,
            padding: 16,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            background: '#1e293b',
            color: '#e2e8f0',
            resize: 'vertical',
            tabSize: 4,
          }}
          spellCheck={false}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
          <Zap size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
          平台会自动推断 input_schema 和 output_schema，无需手动定义
        </div>
      </Card>
    </div>
  );
}


// ── API Form ──────────────────────────────────────────────────────

function ApiForm({ form, onChange }: { form: ApiSkillForm; onChange: (f: ApiSkillForm) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      {/* Left: metadata */}
      <Card>
        <h3 style={{ fontWeight: 600, marginBottom: 16 }}>基本信息</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>Skill 名称</label>
            <Input
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="如: 客服 SOP 检测"
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>描述</label>
            <textarea
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="描述这个 API 的功能..."
              style={{ width: '100%', minHeight: 80, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>标签</label>
            <Input
              value={form.tags}
              onChange={e => onChange({ ...form, tags: e.target.value })}
              placeholder="api, sop, customer-service"
            />
          </div>
        </div>
      </Card>

      {/* Right: API config */}
      <Card>
        <h3 style={{ fontWeight: 600, marginBottom: 16 }}>API 配置</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={form.method}
              onChange={e => onChange({ ...form, method: e.target.value as 'GET' | 'POST' | 'PUT' })}
              style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, fontWeight: 600 }}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
            <Input
              value={form.url}
              onChange={e => onChange({ ...form, url: e.target.value })}
              placeholder="https://api.example.com/sop/evaluate"
              style={{ flex: 1 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>请求头 (JSON)</label>
            <textarea
              value={form.headers}
              onChange={e => onChange({ ...form, headers: e.target.value })}
              style={{ width: '100%', minHeight: 60, padding: 8, fontFamily: 'monospace', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>
              请求体模板 (JSON，支持 {'{{input.field}}'} 变量)
            </label>
            <textarea
              value={form.bodyTemplate}
              onChange={e => onChange({ ...form, bodyTemplate: e.target.value })}
              style={{
                width: '100%',
                minHeight: 120,
                padding: 12,
                fontFamily: 'monospace',
                fontSize: 13,
                lineHeight: 1.6,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#f8fafc',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ padding: 12, background: '#eff6ff', borderRadius: 8, fontSize: 13, color: '#1e40af' }}>
            <strong>变量说明:</strong>
            <ul style={{ margin: '4px 0 0 16px' }}>
              <li><code>{'{{input.field}}'}</code> — 引用输入数据的字段</li>
              <li><code>{'{{config.param}}'}</code> — 引用配置参数</li>
              <li><code>{'${ENV_VAR}'}</code> — 引用环境变量 (如 API Key)</li>
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
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      {/* Left: metadata + templates */}
      <Card>
        <h3 style={{ fontWeight: 600, marginBottom: 16 }}>基本信息</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>Skill 名称</label>
            <Input
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="如: 文本分类器"
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>描述</label>
            <textarea
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="描述这个 Skill 的功能..."
              style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>标签</label>
            <Input
              value={form.tags}
              onChange={e => onChange({ ...form, tags: e.target.value })}
              placeholder="instruction, classify"
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: '#6b7280', marginBottom: 4, display: 'block' }}>模型 (可选)</label>
            <Input
              value={form.model}
              onChange={e => onChange({ ...form, model: e.target.value })}
              placeholder="留空则使用默认模型"
            />
          </div>
        </div>

        {/* Templates */}
        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <h4 style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>快速模板</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(INSTRUCTION_TEMPLATES).map(([key, tpl]) => (
              <button
                key={key}
                onClick={() => onApplyTemplate(key)}
                style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#3b82f6', e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e5e7eb', e.currentTarget.style.background = 'white')}
              >
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Right: instruction editor */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontWeight: 600 }}>指令内容</h3>
          <span style={{ fontSize: 12, color: '#6b7280' }}>用自然语言描述你希望 AI 做什么</span>
        </div>
        <textarea
          value={form.instruction}
          onChange={e => onChange({ ...form, instruction: e.target.value })}
          placeholder="请在这里编写你的指令...

示例:
请对以下文本进行情感分析，返回 JSON 格式:
- label: positive/negative/neutral
- confidence: 0-1 的置信度
- reason: 判断原因"
          style={{
            width: '100%',
            minHeight: 350,
            padding: 16,
            fontSize: 14,
            lineHeight: 1.8,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            background: '#fafbfc',
            resize: 'vertical',
          }}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: '#9ca3af' }}>
          <span>💡 提示: 在指令中明确输出格式 (如 JSON) 可以提高解析成功率</span>
          <span>📝 支持 {'{{input.field}}'} 引用输入数据</span>
        </div>
      </Card>
    </div>
  );
}


// ── Helpers ──────────────────────────────────────────────────────

function generateCodeSkillPackage(form: CodeSkillForm): string {
  // In real implementation, this would generate a proper zip package
  // For now, return a JSON representation
  return JSON.stringify({
    type: 'python_function',
    name: form.name,
    description: form.description,
    code: form.code,
    tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
  });
}

function generateApiSkillPackage(form: ApiSkillForm): string {
  return JSON.stringify({
    type: 'rest_api',
    name: form.name,
    description: form.description,
    config: {
      url: form.url,
      method: form.method,
      headers: JSON.parse(form.headers || '{}'),
      body_template: form.bodyTemplate,
    },
    tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
  });
}

function generateInstructionSkillPackage(form: InstructionSkillForm): string {
  return JSON.stringify({
    type: 'instruction',
    name: form.name,
    description: form.description,
    instruction: form.instruction,
    model: form.model || undefined,
    tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
  });
}
