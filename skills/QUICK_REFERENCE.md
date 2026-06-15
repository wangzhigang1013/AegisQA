# Skill 开发快速参考卡

## 🚀 上传前必检清单

```
□ skill_id      → asr.name@1.0.0
□ permissions   → []
□ example_input → 包含所有 required 字段
□ example_config → {}
□ handler.py    → run(inputs, config) 返回正确格式
```

## 📝 skill.yaml 最小模板

```yaml
skill_id: asr.your_skill@1.0.0
name: your_skill
version: 1.0.0
description: 一句话描述
author: AegisQA
tags: [your_tag]
permissions: []

input_schema:
  type: object
  required: [field1]
  properties:
    field1:
      type: string
      description: 字段描述

output_schema:
  type: object
  properties:
    result:
      type: string

config_schema:
  type: object
  properties: {}

example_input:
  field1: "示例值"

example_config: {}
```

## 🐍 handler.py 最小模板

```python
def run(inputs: dict, config: dict) -> dict:
    result = inputs.get("field1", "")
    
    return {
        "output": {"result": result},
        "metrics": {},
        "artifacts": {},
        "logs": []
    }
```

## ❌ 常见错误速查

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `skill_id Field required` | 缺少 skill_id | 添加 `skill_id: asr.name@1.0.0` |
| `SKILL_PACKAGE_PERMISSIONS_REQUIRED` | 缺少 permissions | 添加 `permissions: []` |
| `字段 $.xxx 类型不匹配：期望 required，实际 missing` | 缺少 example_input | 添加 example_input 包含所有 required 字段 |
| `SKILL_PACKAGE_NETWORK_DENIED` | 需要网络但未声明 | `permissions: [network]` |
| `SKILL_PACKAGE_FILE_ACCESS_DENIED` | 需要文件访问但未声明 | `permissions: [filesystem:skill_package_read]` |

## 🔑 权限列表

```yaml
permissions: []                              # 无权限（纯计算）
permissions: [filesystem:skill_package_read] # 读取包内文件
permissions: [network]                       # 网络访问
permissions: [model:call]                    # 调用 AI 模型
```

## 📦 打包命令

```bash
# Windows PowerShell
Compress-Archive -Path skill_folder\* -DestinationPath skill.zip

# Linux/Mac
cd skill_folder && zip -r ../skill.zip .
```

## 🧪 本地测试

```python
from your_skill.handler import run

result = run(
    inputs={"field1": "test"},
    config={}
)
print(result)
```

## 📚 完整文档

- [SKILL_DEVELOPMENT_GUIDE.md](./SKILL_DEVELOPMENT_GUIDE.md) - 详细开发指南
- [UPLOAD_GUIDE.md](./UPLOAD_GUIDE.md) - 上传问题解决方案
- [README.md](./README.md) - Skills 使用说明
