/**
 * Prompt Playground — 在线 Prompt 调试
 *
 * 功能:
 *   - Prompt 模板编辑 + 变量注入
 *   - 模型选择 (从 ModelGateway 连接列表)
 *   - 实时执行 + 流式输出
 *   - LLM-as-Judge 自动评判
 *   - 版本历史
 *   - 批量测试
 *   - 一键"转为 Skill"
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Loader2,
  Copy,
  Save,
  RotateCcw,
  Sparkles,
  GitBranch,
  BarChart3,
  CheckCircle,
  AlertCircle,
  Clock,
  Zap,
  ArrowRight,
  Info,
  Database,
} from 'lucide-react';

import { api, formatApiError } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

interface PlaygroundVersion {
  id: string;
  prompt: string;
  model: string;
  temperature: number;
  output?: string;
  judgeResult?: JudgeResult;
  latencyMs?: number;
  tokens?: number;
  timestamp: string;
}

interface JudgeResult {
  score: number;
  label: string;
  feedback: string;
  dimensions: { name: string; score: number; comment: string }[];
}

const DEFAULT_PROMPT = `你是一个专业的文本分类器。

请对以下文本进行情感分析:

文本: {{input.text}}

请返回 JSON 格式:
{
  "label": "positive/negative/neutral",
  "confidence": 0.0-1.0,
  "reason": "判断原因"
}`;

const DEFAULT_VARIABLES = `{
  "input": {
    "text": "这个产品非常好用，我很满意！"
  }
}`;

export function PlaygroundPage() {
  const navigate = useNavigate();

  // State
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [variables, setVariables] = useState(DEFAULT_VARIABLES);
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [output, setOutput] = useState('');
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [versions, setVersions] = useState<PlaygroundVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Judge prompt
  const [judgePrompt, setJudgePrompt] = useState(`请评估以下回答的质量。

评估维度:
- accuracy (0-1): 准确性
- completeness (0-1): 完整性
- format (0-1): 格式正确性

回答: {{output}}

请返回 JSON 格式:
{
  "score": 0.0-1.0,
  "label": "pass/fail",
  "feedback": "总体评价",
  "dimensions": [
    {"name": "accuracy", "score": 0.9, "comment": "评价"},
    {"name": "completeness", "score": 0.85, "comment": "评价"},
    {"name": "format", "score": 1.0, "comment": "评价"}
  ]
}`);

  const [enableJudge, setEnableJudge] = useState(false);

  // Fetch model connections
  const connectionsQuery = useQuery({
    queryKey: ['model-connections'],
    queryFn: api.modelGatewayConnections,
  });
  const connections = Array.isArray(connectionsQuery.data) ? connectionsQuery.data : [];

  // Execute mutation — 调用真实模型网关
  const executeMutation = useMutation({
    mutationFn: async () => {
      setIsStreaming(true);
      setOutput('');
      setJudgeResult(null);

      const startTime = Date.now();

      // Parse variables
      let parsedVars: Record<string, unknown> = {};
      try {
        parsedVars = JSON.parse(variables);
      } catch {
        throw new Error('变量 JSON 格式错误');
      }

      // Interpolate prompt with variables
      let interpolatedPrompt = prompt;
      const interpolate = (obj: Record<string, unknown>, prefix: string = '') => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'object' && value !== null) {
            interpolate(value as Record<string, unknown>, fullKey);
          } else {
            interpolatedPrompt = interpolatedPrompt.replace(
              new RegExp(`\\{\\{${fullKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g'),
              String(value)
            );
          }
        }
      };
      interpolate(parsedVars);

      // Call real Playground API
      const selectedModel = model || connections[0]?.default_model || undefined;
      const connectionId = connections[0]?.connection_id || undefined;

      const result = await api.playgroundExecute({
        prompt: interpolatedPrompt,
        variables: parsedVars,
        model_connection_id: connectionId,
        model: selectedModel,
        temperature,
        max_tokens: maxTokens,
      });

      const elapsed = Date.now() - startTime;
      // playgroundExecute 返回 { output, model, provider, latency_ms, usage }，
      // 这里取 output 作为展示文本；之前误用 result.response 永远命中 fallback 的 JSON。
      const outputText = result.output ?? '';
      const fallback = outputText || JSON.stringify(result, null, 2);
      setOutput(fallback);
      setLatencyMs(elapsed);
      // usage 是 Record<string, unknown>，total_tokens 需要强转成 number 才能进 state。
      const tokenCount = Number(result.usage?.total_tokens);
      setTokens(Number.isFinite(tokenCount) ? tokenCount : 0);
      setIsStreaming(false);

      // Judge if enabled — 调用真实 Judge API
      if (enableJudge) {
        try {
          const judgeResult = await api.playgroundJudge({
            output: outputText,
            judge_prompt: judgePrompt,
            model_connection_id: connectionId,
            model: selectedModel,
          });
          const parsed = judgeResult.result;
          setJudgeResult({
            score: Number(parsed.score) || 0,
            label: typeof parsed.label === 'string' ? parsed.label : 'unknown',
            feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
            dimensions: Array.isArray(parsed.dimensions)
              ? parsed.dimensions.map((d: Record<string, unknown>) => ({
                  name: String(d.name ?? ''),
                  score: Number(d.score) || 0,
                  comment: String(d.comment ?? ''),
                }))
              : [],
          });
        } catch (e) {
          setJudgeResult({
            score: 0,
            label: 'error',
            feedback: e instanceof Error ? e.message : '评判失败',
            dimensions: [],
          });
        }
      }

      // Save to version history
      const newVersion: PlaygroundVersion = {
        id: `v${versions.length + 1}`,
        prompt,
        model: selectedModel || 'default',
        temperature,
        output: outputText,
        latencyMs: elapsed,
        tokens: Number.isFinite(Number(result.usage?.total_tokens)) ? Number(result.usage?.total_tokens) : 0,
        timestamp: new Date().toLocaleString('zh-CN'),
      };
      setVersions(prev => [newVersion, ...prev]);
      setSelectedVersion(newVersion.id);

      return outputText;
    },
  });

  const handleExecute = useCallback(() => {
    executeMutation.mutate();
  }, [executeMutation]);

  // Convert to Skill
  const convertToSkill = useCallback(() => {
    navigate('/skills/create', {
      state: {
        mode: 'instruction',
        name: 'Playground Skill',
        instruction: prompt,
        model,
      },
    });
  }, [navigate, prompt, model]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto p-6 md:p-8">
      <PageHeader
        eyebrow="Playground"
        title="Prompt Playground"
        description="在线调试 Prompt，实时查看效果"
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Left: Input */}
        <div className="flex flex-col gap-6">
          {/* Prompt Editor */}
          <Card className="p-6 liquid-glass flex flex-col group">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" /> Prompt 模板
              </h3>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setPrompt(DEFAULT_PROMPT)} className="h-8 text-xs font-medium bg-white/50 hover:bg-white/80 text-slate-600 rounded-full px-3">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  重置
                </Button>
                <Button variant="ghost" onClick={convertToSkill} className="h-8 text-xs font-medium bg-white/50 hover:bg-white/80 text-indigo-600 rounded-full px-3">
                  <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                  转为 Skill
                </Button>
              </div>
            </div>
            <div className="relative group/editor flex-1">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="w-full min-h-[250px] p-5 font-mono text-sm leading-relaxed border border-slate-200/50 rounded-2xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner transition-all"
                spellCheck={false}
              />
              <div className="absolute top-4 right-4 text-xs font-medium text-slate-400 bg-white/80 backdrop-blur px-2 py-1 rounded-lg opacity-0 group-hover/editor:opacity-100 transition-opacity pointer-events-none border border-slate-100">
                支持 {'{{变量}}'}
              </div>
            </div>
            <div className="mt-3 text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <Info className="w-4 h-4" /> 使用 <code className="bg-indigo-50 text-indigo-600 px-1 rounded mx-0.5">{'{{input.field}}'}</code> 插入变量，如 <code className="bg-indigo-50 text-indigo-600 px-1 rounded mx-0.5">{'{{input.text}}'}</code>
            </div>
          </Card>

          {/* Variables */}
          <Card className="p-6 liquid-glass flex flex-col">
            <h3 className="font-bold text-slate-800 text-base mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-500" /> 变量 JSON
            </h3>
            <textarea
              value={variables}
              onChange={e => setVariables(e.target.value)}
              className="w-full min-h-[120px] p-4 font-mono text-sm border border-slate-200/50 rounded-xl bg-white/60 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner transition-all"
              spellCheck={false}
            />
          </Card>

          {/* Model Config */}
          <Card className="p-6 liquid-glass flex flex-col">
            <h3 className="font-bold text-slate-800 text-base mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> 模型配置
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">模型</label>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/60 border border-slate-200/50 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium shadow-sm"
                >
                  <option value="">默认 ({connections[0]?.default_model || '未配置'})</option>
                  {connections.map(c => (
                    <option key={c.connection_id} value={c.default_model}>
                      {c.name || c.connection_id} ({c.default_model})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Temperature</label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={e => setTemperature(Number(e.target.value))}
                  className="w-full px-3 py-2.5 bg-white/60 border border-slate-200/50 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium shadow-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Max Tokens</label>
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={maxTokens}
                  onChange={e => setMaxTokens(Number(e.target.value))}
                  className="w-full px-3 py-2.5 bg-white/60 border border-slate-200/50 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-medium shadow-sm"
                />
              </div>
            </div>
          </Card>

          {/* Judge Config */}
          <Card className="p-6 liquid-glass flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-rose-500" /> 自动评判 (LLM-as-Judge)
              </h3>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer hover:text-indigo-600 transition-colors bg-white/50 px-3 py-1.5 rounded-full">
                <input
                  type="checkbox"
                  checked={enableJudge}
                  onChange={e => setEnableJudge(e.target.checked)}
                  className="rounded text-indigo-500 focus:ring-indigo-500/30 w-4 h-4 border-slate-300"
                />
                启用
              </label>
            </div>
            {enableJudge && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <textarea
                  value={judgePrompt}
                  onChange={e => setJudgePrompt(e.target.value)}
                  className="w-full min-h-[140px] p-4 font-mono text-sm border border-slate-200/50 rounded-xl bg-rose-50/30 text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-rose-500/50 shadow-inner transition-all mt-2"
                  spellCheck={false}
                />
              </motion.div>
            )}
          </Card>

          {/* Execute button */}
          <Button
            variant="default"
            onClick={handleExecute}
            disabled={executeMutation.isPending || isStreaming}
            className="w-full py-4 text-base font-bold rounded-2xl shadow-lg hover:shadow-indigo-500/25 transition-all flex items-center justify-center gap-2"
          >
            {isStreaming ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                执行中...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" fill="currentColor" />
                运行 (Run)
              </>
            )}
          </Button>
        </div>

        {/* Right: Output */}
        <div className="flex flex-col gap-6">
          {/* Output */}
          <Card className="flex-1 p-6 liquid-glass flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-500" /> 输出结果
              </h3>
              {output && (
                <Button variant="ghost" onClick={() => navigator.clipboard.writeText(output)} className="h-8 text-xs font-medium bg-white/50 hover:bg-white/80 text-slate-600 rounded-full px-3">
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  复制
                </Button>
              )}
            </div>
            <div className={`flex-1 min-h-[300px] p-5 font-mono text-sm leading-relaxed border border-slate-200/50 rounded-2xl shadow-inner whitespace-pre-wrap break-all transition-colors ${output ? 'bg-indigo-50/40 text-slate-800' : 'bg-white/40 text-slate-400 flex items-center justify-center'}`}>
              {output || (isStreaming ? '等待输出...' : '点击左侧 "运行" 查看大模型生成结果')}
              {isStreaming && <span className="animate-pulse ml-1 text-indigo-500">▊</span>}
            </div>

            {/* Metrics */}
            {(latencyMs > 0 || tokens > 0) && (
              <div className="flex items-center gap-6 mt-5 text-sm font-semibold text-slate-500 px-2">
                <span className="flex items-center gap-1.5 bg-white/60 px-3 py-1.5 rounded-lg border border-slate-200/50 shadow-sm">
                  <Clock className="w-4 h-4 text-slate-400" /> {latencyMs.toLocaleString()} ms
                </span>
                <span className="flex items-center gap-1.5 bg-white/60 px-3 py-1.5 rounded-lg border border-slate-200/50 shadow-sm">
                  <Zap className="w-4 h-4 text-amber-500" /> {tokens.toLocaleString()} tokens
                </span>
              </div>
            )}
          </Card>

          {/* Judge Result */}
          {enableJudge && judgeResult && (
            <Card className={`p-6 liquid-glass flex flex-col border ${judgeResult.score >= 0.8 ? 'border-emerald-200 bg-emerald-50/30' : 'border-rose-200 bg-rose-50/30'}`}>
              <h3 className="font-bold text-slate-800 text-base mb-5 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-slate-500" /> 评判结果
              </h3>
              <div className="flex items-center gap-5 mb-6">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black shadow-inner border ${judgeResult.score >= 0.8 ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-rose-100 text-rose-600 border-rose-200'}`}>
                  {Math.round(judgeResult.score * 100)}
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className={`font-bold flex items-center gap-2 text-base ${judgeResult.label === 'pass' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {judgeResult.label === 'pass' ? (
                      <><CheckCircle className="w-5 h-5" /> 评测通过 (Pass)</>
                    ) : (
                      <><AlertCircle className="w-5 h-5" /> 评测未通过 (Fail)</>
                    )}
                  </div>
                  <div className="text-sm font-medium text-slate-600 leading-relaxed bg-white/60 p-2.5 rounded-lg border border-slate-200/50 shadow-sm">{judgeResult.feedback}</div>
                </div>
              </div>
              {judgeResult.dimensions.length > 0 && (
                <div className="flex flex-col gap-3">
                  {judgeResult.dimensions.map(dim => (
                    <div key={dim.name} className="flex items-center gap-3 bg-white/40 p-2 rounded-lg border border-slate-100">
                      <span className="w-28 text-xs font-bold text-slate-500 uppercase tracking-wider">{dim.name}</span>
                      <div className="flex-1 h-2.5 bg-slate-200/60 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{
                          width: `${dim.score * 100}%`,
                          background: dim.score >= 0.8 ? '#10b981' : dim.score >= 0.6 ? '#f59e0b' : '#ef4444',
                        }} />
                      </div>
                      <span className="w-8 text-sm font-bold text-slate-700 text-right">
                        {Math.round(dim.score * 100)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Version History */}
          <Card className="p-6 liquid-glass flex flex-col max-h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-indigo-500" />
                版本历史 ({versions.length})
              </h3>
            </div>
            {versions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm font-medium text-slate-400 bg-white/30 rounded-xl border border-slate-100 min-h-[120px]">
                运行后会自动保存版本
              </div>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto pr-2 custom-scrollbar">
                {versions.map(v => (
                  <div
                    key={v.id}
                    onClick={() => {
                      setSelectedVersion(v.id);
                      setPrompt(v.prompt);
                      setModel(v.model);
                      setTemperature(v.temperature);
                      if (v.output) setOutput(v.output);
                      if (v.latencyMs) setLatencyMs(v.latencyMs);
                      if (v.tokens) setTokens(v.tokens);
                    }}
                    className={`p-3.5 rounded-xl cursor-pointer transition-all border shadow-sm ${selectedVersion === v.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white/60 border-slate-200/50 hover:bg-white'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-bold text-sm ${selectedVersion === v.id ? 'text-indigo-700' : 'text-slate-700'}`}>{v.id}</span>
                      <span className="text-xs font-medium text-slate-400">{v.timestamp}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
                      <span className="bg-white/60 px-2 py-0.5 rounded border border-slate-100">{v.model}</span>
                      {v.latencyMs && <span>{v.latencyMs}ms</span>}
                      {v.tokens && <span>{v.tokens}t</span>}
                      {v.judgeResult && (
                        <span className={`px-2 py-0.5 rounded border ${v.judgeResult.score >= 0.8 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                          {Math.round(v.judgeResult.score * 100)}分
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
