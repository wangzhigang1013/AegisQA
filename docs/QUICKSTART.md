# AegisQA 5 分钟快速入门

> 本教程将引导您完成一次完整的 AI 评测流程。

## 前置条件

- Python 3.10+
- Node.js 18+
- 已启动 AegisQA 服务（`python -m uvicorn aegisqa.api.app:app`）

## 第一步：上传数据集

1. 打开浏览器访问 `http://localhost:5173/datasets`
2. 点击「上传数据集」按钮
3. 选择 CSV 或 JSONL 格式的数据文件
4. 确认字段映射后提交

**示例数据格式（CSV）：**

```csv
question,reference,context
AegisQA 是什么？,AegisQA 是一个 AI 评测治理平台,AegisQA 支持 Skill 管理和 Workflow 设计
如何创建 Workflow？,通过可视化画布创建,支持拖拽节点和连线
```

## 第二步：上传 Skill

1. 打开 `http://localhost:5173/skills`
2. 点击「上传 Skill 包」按钮
3. 选择 zip 格式的 Skill 包
4. 运行合约测试并通过审批

**示例 Skill 包结构：**

```
my-skill/
├── skill.yaml      # Skill 定义
├── handler.py      # 执行脚本
└── README.md       # 说明文档
```

**skill.yaml 示例：**

```yaml
skill_id: my.skill@0.1.0
name: My Skill
version: "0.1.0"
description: 示例 Skill
author: You
runtime:
  mode: package
  entrypoint: handler.py:run
input_schema:
  type: object
  required: [question]
  properties:
    question: { type: string }
output_schema:
  type: object
  required: [answer]
  properties:
    answer: { type: string }
```

**handler.py 示例：**

```python
def run(inputs, config):
    question = inputs.get("question", "")
    return {
        "output": {"answer": f"回答：{question}"},
        "metrics": {"score": 0.9},
    }
```

## 第三步：创建 Workflow

1. 打开 `http://localhost:5173/workflows`
2. 点击「新建 Workflow」
3. 在画布中拖拽节点：
   - Source → 数据源
   - Skill → 您上传的 Skill
   - Output → 输出节点
4. 连接节点并配置字段映射
5. 点击「发布」

## 第四步：执行任务

1. 打开 `http://localhost:5173/runs`
2. 点击「创建任务」
3. 选择数据集和 Workflow
4. 点击「执行」
5. 等待任务完成

## 第五步：查看报告

1. 打开 `http://localhost:5173/reports`
2. 选择已完成的任务
3. 查看评测结果：
   - 通过率
   - Badcase 列表
   - 分层分析
   - 诊断建议

## 使用 Python SDK

```bash
cd sdk && pip install -e .
```

```python
from aegisqa_sdk import AegisQA

client = AegisQA(base_url="http://localhost:8000")

# 列出数据集
datasets = client.datasets.list()
print(f"数据集数量：{len(datasets)}")

# 创建任务
task = client.tasks.create(
    name="快速评测",
    dataset_id="my-dataset",
    dataset_version=1,
    workflow_version_id="my-workflow:v1",
)
print(f"任务 ID：{task['task_id']}")

# 查看报告
report = client.reports.task_report(task["task_id"])
print(f"通过率：{report.get('pass_rate', 0):.2%}")
```

## 使用 CLI

```bash
# 安装 CLI
cd sdk && pip install -e .

# 检查服务状态
aegisqa health

# 列出数据集
aegisqa dataset list

# 列出 Skill
aegisqa skill list

# 创建任务
aegisqa task create --name "快速评测" --dataset my-dataset --dataset-version 1 --workflow my-workflow:v1

# 查看报告
aegisqa report <task-id>
```

## 常见场景

### RAG 评测

1. 上传包含 question/context/reference 的数据集
2. 使用 RAG 评测模板创建 Workflow
3. 执行任务并查看 faithfulness/relevance 指标

### Agent 评测

1. 上传包含 task/tools/expected_output 的数据集
2. 使用 Agent 评测模板创建 Workflow
3. 执行任务并查看 tool_use_accuracy 指标

### 安全评测

1. 上传包含 prompt/expected_safe 的数据集
2. 使用安全评测模板创建 Workflow
3. 执行任务并查看 prompt_injection_resistance 指标

## 下一步

- 阅读 [API 参考文档](API_REFERENCE.md)
- 查看 [评测模板指南](EVAL_TEMPLATES.md)
- 了解 [Skill 开发指南](AGENT_SKILL_PACKAGE_GUIDE.md)
