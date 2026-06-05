# 接入真实模型

AegisQA 默认可以用 mock 模型离线跑通。要让说明型 Agent Skill 或内置 `model.chat@0.1.0` 调真实模型，需要配置模型网关。

## 推荐方式：模型连接别名

治理页支持多模型连接别名，对应接口：

```text
GET/POST/PUT/DELETE /model-gateway/connections
```

每个连接保存 `secret_ref`，不保存明文 API Key。例如：

```json
{
  "connection_id": "qwen-prod",
  "name": "Qwen 生产",
  "provider": "openai_compatible",
  "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "secret_ref": "env:QWEN_API_KEY",
  "default_model": "qwen-plus",
  "timeout_seconds": 60,
  "enabled": true
}
```

状态接口只返回：

```json
{
  "api_key_configured": true,
  "api_key_masked": "sk-q...1234"
}
```

不会回显真实密钥。

## 本地环境变量

PowerShell 示例：

```powershell
$env:QWEN_API_KEY="sk-..."
$env:AEGISQA_MODEL_PROVIDER="openai_compatible"
$env:AEGISQA_MODEL_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
$env:AEGISQA_MODEL_DEFAULT_MODEL="qwen-plus"
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000
```

如果使用连接别名，只需要保证 `secret_ref` 指向的环境变量存在，例如 `env:QWEN_API_KEY`。

## UI 操作

1. 打开“治理与审计”。
2. 在“模型连接别名”里新增连接，例如 `qwen-prod`。
3. 填写 Provider、Base URL、默认模型和 `secret_ref`。
4. 可以填写“临时测试 API Key”做连接测试；这个字段只用于测试请求，不会保存到 store。
5. 点击测试，看到模型返回文本后保存连接。

## Workflow 中选择连接

内置模型节点或支持模型网关的 Skill 可在运行参数里填写：

```yaml
model_connection_id: qwen-prod
model: qwen-plus
temperature: 0
```

任务执行快照会记录连接别名、模型名、参数和脱敏 secret ref，报告会聚合 token 与成本。旧的 `default_model` 行为仍保留；没有指定 `model_connection_id` 时会使用默认模型网关配置。

## 安全检查

- store 文件里不应出现真实 API Key。
- API 响应只返回 `api_key_configured` 和 mask。
- 临时测试密钥只用于 `/model-gateway/test`，不会出现在 `/model-gateway/connections` 保存请求里。
- 说明型 Agent Skill 需要 `permissions: [model:call]`，审批页会展示该权限风险。

相关文档：

- [Agent Skill 包上传指南](../AGENT_SKILL_PACKAGE_GUIDE.md)
- [Skill 示例包索引](../SKILL_EXAMPLES_INDEX.md)
