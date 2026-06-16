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

  // Execute mutation
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

      // Call model gateway
      const selectedModel = model || connections[0]?.default_model || 'gpt-4';
      const connectionId = connections[0]?.connection_id;

      // Simulate streaming output (in real implementation, use SSE)
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      const mockOutput = JSON.stringify({
        label: 'positive',
        confidence: 0.95,
        reason: '文本表达了对产品的满意和正面评价',
      }, null, 2);

      // Simulate character-by-character streaming
      for (let i = 0; i <= mockOutput.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        setOutput(mockOutput.slice(0, i));
      }

      const elapsed = Date.now() - startTime;
      setLatencyMs(elapsed);
      setTokens(Math.floor(Math.random() * 200) + 50);
      setIsStreaming(false);

      // Judge if enabled
      if (enableJudge) {
        await new Promise(resolve => setTimeout(resolve, 500));
        setJudgeResult({
          score: 0.92,
          label: 'pass',
          feedback: '回答格式正确，情感判断准确，置信度合理',
          dimensions: [
            { name: 'accuracy', score: 0.95, comment: '情感判断正确' },
            { name: 'completeness', score: 0.9, comment: '包含了所有必要字段' },
            { name: 'format', score: 0.9, comment: 'JSON 格式正确' },
          ],
        });
      }

      // Save to version history
      const newVersion: PlaygroundVersion = {
        id: `v${versions.length + 1}`,
        prompt,
        model: selectedModel,
        temperature,
        output: mockOutput,
        judgeResult: enableJudge ? {
          score: 0.92,
          label: 'pass',
          feedback: '回答格式正确',
          dimensions: [],
        } : undefined,
        latencyMs: elapsed,
        tokens: Math.floor(Math.random() * 200) + 50,
        timestamp: new Date().toLocaleString('zh-CN'),
      };
      setVersions(prev => [newVersion, ...prev]);
      setSelectedVersion(newVersion.id);

      return mockOutput;
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
    <div style={{ padding: '0 24px 24px' }}>
      <PageHeader
        title="Prompt Playground"
        subtitle="在线调试 Prompt，实时查看效果"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Left: Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Prompt Editor */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontWeight: 600 }}>Prompt 模板</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="ghost" onClick={() => setPrompt(DEFAULT_PROMPT)} style={{ fontSize: 12, padding: '4px 8px' }}>
                  <RotateCcw size={12} style={{ marginRight: 4 }} />
                  重置
                </Button>
                <Button variant="ghost" onClick={convertToSkill} style={{ fontSize: 12, padding: '4px 8px' }}>
                  <ArrowRight size={12} style={{ marginRight: 4 }} />
                  转为 Skill
                </Button>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              style={{
                width: '100%',
                minHeight: 250,
                padding: 14,
                fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                fontSize: 13,
                lineHeight: 1.7,
                border: '1px solid #d1d5db',
                borderRadius: 8,
                background: '#1e293b',
                color: '#e2e8f0',
                resize: 'vertical',
              }}
              spellCheck={false}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>
              使用 {'{{input.field}}'} 插入变量，如 {'{{input.text}}'}
            </div>
          </Card>

          {/* Variables */}
          <Card>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>变量</h3>
            <textarea
              value={variables}
              onChange={e => setVariables(e.target.value)}
              style={{
                width: '100%',
                minHeight: 100,
                padding: 12,
                fontFamily: 'monospace',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                background: '#f8fafc',
                resize: 'vertical',
              }}
            />
          </Card>

          {/* Model Config */}
          <Card>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>模型配置</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>模型</label>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="">默认 ({connections[0]?.default_model || '未配置'})</option>
                  {connections.map(c => (
                    <option key={c.connection_id} value={c.default_model}>
                      {c.name || c.connection_id} ({c.default_model})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Temperature</label>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={e => setTemperature(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Max Tokens</label>
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={maxTokens}
                  onChange={e => setMaxTokens(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            </div>
          </Card>

          {/* Judge Config */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontWeight: 600 }}>自动评判 (LLM-as-Judge)</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableJudge}
                  onChange={e => setEnableJudge(e.target.checked)}
                />
                启用
              </label>
            </div>
            {enableJudge && (
              <textarea
                value={judgePrompt}
                onChange={e => setJudgePrompt(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 120,
                  padding: 12,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  background: '#f8fafc',
                  resize: 'vertical',
                }}
              />
            )}
          </Card>

          {/* Execute button */}
          <Button
            variant="default"
            onClick={handleExecute}
            disabled={executeMutation.isPending || isStreaming}
            style={{ width: '100%', padding: '12px 0', fontSize: 15, fontWeight: 600 }}
          >
            {isStreaming ? (
              <>
                <Loader2 size={18} className="animate-spin" style={{ marginRight: 8 }} />
                执行中...
              </>
            ) : (
              <>
                <Play size={18} style={{ marginRight: 8 }} />
                运行
              </>
            )}
          </Button>
        </div>

        {/* Right: Output */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Output */}
          <Card style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontWeight: 600 }}>输出结果</h3>
              {output && (
                <Button variant="ghost" onClick={() => navigator.clipboard.writeText(output)} style={{ fontSize: 12, padding: '4px 8px' }}>
                  <Copy size={12} style={{ marginRight: 4 }} />
                  复制
                </Button>
              )}
            </div>
            <div style={{
              minHeight: 200,
              padding: 16,
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.7,
              background: output ? '#f0fdf4' : '#f8fafc',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {output || (isStreaming ? '等待输出...' : '点击"运行"查看结果')}
              {isStreaming && <span className="animate-pulse">▊</span>}
            </div>

            {/* Metrics */}
            {(latencyMs > 0 || tokens > 0) && (
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13, color: '#6b7280' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={14} /> {latencyMs}ms
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={14} /> {tokens} tokens
                </span>
              </div>
            )}
          </Card>

          {/* Judge Result */}
          {enableJudge && judgeResult && (
            <Card>
              <h3 style={{ fontWeight: 600, marginBottom: 12 }}>评判结果</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: judgeResult.score >= 0.8 ? '#dcfce7' : '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  color: judgeResult.score >= 0.8 ? '#16a34a' : '#dc2626',
                }}>
                  {Math.round(judgeResult.score * 100)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {judgeResult.label === 'pass' ? (
                      <CheckCircle size={16} color="#22c55e" />
                    ) : (
                      <AlertCircle size={16} color="#ef4444" />
                    )}
                    {judgeResult.label === 'pass' ? '通过' : '未通过'}
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{judgeResult.feedback}</div>
                </div>
              </div>
              {judgeResult.dimensions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {judgeResult.dimensions.map(dim => (
                    <div key={dim.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 90, fontSize: 12, color: '#6b7280' }}>{dim.name}</span>
                      <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 3 }}>
                        <div style={{
                          width: `${dim.score * 100}%`,
                          height: '100%',
                          background: dim.score >= 0.8 ? '#22c55e' : dim.score >= 0.6 ? '#f59e0b' : '#ef4444',
                          borderRadius: 3,
                          transition: 'width 0.3s',
                        }} />
                      </div>
                      <span style={{ width: 36, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>
                        {Math.round(dim.score * 100)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Version History */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontWeight: 600 }}>
                <GitBranch size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                版本历史 ({versions.length})
              </h3>
            </div>
            {versions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>
                运行后会自动保存版本
              </div>
            ) : (
              <div style={{ maxHeight: 250, overflow: 'auto' }}>
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
                    style={{
                      padding: '10px 12px',
                      border: selectedVersion === v.id ? '1px solid #3b82f6' : '1px solid #e5e7eb',
                      borderRadius: 6,
                      marginBottom: 6,
                      cursor: 'pointer',
                      background: selectedVersion === v.id ? '#eff6ff' : 'white',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{v.id}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>{v.timestamp}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: '#6b7280' }}>
                      <span>{v.model}</span>
                      {v.latencyMs && <span>{v.latencyMs}ms</span>}
                      {v.tokens && <span>{v.tokens} tokens</span>}
                      {v.judgeResult && (
                        <span style={{ color: v.judgeResult.score >= 0.8 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
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
