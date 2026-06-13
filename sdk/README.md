# AegisQA Python SDK

AegisQA AI 评测治理平台的 Python 客户端库。

## 安装

```bash
pip install aegisqa-sdk
```

或从源码安装：

```bash
cd sdk
pip install -e .
```

## 快速开始

```python
from aegisqa_sdk import AegisQA

# 创建客户端
client = AegisQA(base_url="http://localhost:8000")

# 检查服务状态
health = client.health()
print(health)

# 列出所有 Skill
skills = client.skills.list()
for skill in skills:
    print(f"{skill['skill_id']}: {skill['name']}")

# 列出任务
tasks = client.tasks.list(page=1, page_size=10)
print(f"共 {tasks['pagination']['total_items']} 个任务")

# 导出 Skill 包
client.skills.export_to_file("my-skill@0.1.0", "my-skill.zip")

# 导入 Skill 包
result = client.skills.import_package("my-skill.zip")
print(f"导入成功：{result['skill_id']}")
```

## 使用上下文管理器

```python
with AegisQA(base_url="http://localhost:8000") as client:
    skills = client.skills.list()
    # ...
```

## API 概览

### Skills

```python
client.skills.list()                          # 列出所有 Skill
client.skills.get(skill_id)                   # 获取 Skill 详情
client.skills.packages()                      # 列出 Skill 包
client.skills.upload(zip_path)                # 上传 Skill 包
client.skills.export(skill_id)                # 导出 Skill 包
client.skills.export_to_file(skill_id, path)  # 导出到文件
client.skills.import_package(zip_path)        # 导入 Skill 包
client.skills.contract_test(skill_id)         # 运行合约测试
client.skills.approve(skill_id)               # 审批 Skill
client.skills.disable(skill_id)               # 禁用 Skill
client.skills.versions(skill_id)              # 获取版本历史
```

### Tasks

```python
client.tasks.list(page, page_size, status)    # 列出任务
client.tasks.get(task_id)                     # 获取任务详情
client.tasks.create(name, dataset_id, ...)    # 创建任务
client.tasks.preflight(dataset_id, ...)       # 运行预检
client.tasks.diagnostics(task_id)             # 获取诊断
client.tasks.trace_flow(task_id)              # 获取 Trace Flow
client.tasks.trace_tree(task_id)              # 获取 Trace Tree
```

### Workflows

```python
client.workflows.list()                       # 列出 Workflow
client.workflows.templates()                  # 列出模板
client.workflows.drafts()                     # 列出草稿
client.workflows.create_draft(name, steps)    # 创建草稿
client.workflows.publish_draft(draft_id)      # 发布草稿
client.workflows.copy(version_id)             # 复制 Workflow
```

### Datasets

```python
client.datasets.list()                        # 列出数据集
client.datasets.get(dataset_id)               # 获取数据集详情
client.datasets.versions(dataset_id)          # 列出版本
```

### Runs

```python
client.runs.list(page, page_size)             # 列出执行记录
client.runs.get(run_id)                       # 获取详情
client.runs.execute(run_id)                   # 执行
client.runs.cancel(run_id)                    # 取消
client.runs.pause(run_id)                     # 暂停
client.runs.resume(run_id)                    # 恢复
client.runs.retry_failed(run_id)              # 重试失败项
```

### Reports

```python
client.reports.task_report(task_id)           # 获取任务报告
client.reports.score_analytics(**kwargs)      # 获取分数分析
client.reports.badcases(task_id)              # 获取 Badcase
```

## 异常处理

```python
from aegisqa_sdk import AegisQA, AegisQAError, NotFoundError, ValidationError

try:
    client.skills.get("nonexistent@0.1.0")
except NotFoundError as e:
    print(f"资源不存在：{e.message}")
except ValidationError as e:
    print(f"参数错误：{e.message}")
except AegisQAError as e:
    print(f"API 错误：{e.message}")
    print(f"详情：{e.details}")
```

## 认证

```python
# 使用 API Key
client = AegisQA(
    base_url="http://localhost:8000",
    api_key="your-api-key",
)
```

## 配置

```python
client = AegisQA(
    base_url="http://localhost:8000",  # API 地址
    api_key="your-api-key",            # API Key（可选）
    timeout=30.0,                       # 请求超时（秒）
)
```
