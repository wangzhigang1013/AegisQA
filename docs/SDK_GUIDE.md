# AegisQA Python SDK 使用指南

## 安装

```bash
# 从源码安装
cd sdk
pip install -e .

# 或直接安装
pip install aegisqa-sdk
```

## 快速开始

```python
from aegisqa_sdk import AegisQA

# 创建客户端
client = AegisQA(base_url="http://localhost:8000")

# 检查服务状态
health = client.health()
print(health)  # {'status': 'ok', 'service': 'aegisqa'}
```

## 使用上下文管理器

```python
with AegisQA(base_url="http://localhost:8000") as client:
    skills = client.skills.list()
    print(f"共 {len(skills)} 个 Skill")
```

## Skill 管理

### 列出所有 Skill

```python
skills = client.skills.list()
for skill in skills:
    print(f"{skill['skill_id']}: {skill['name']}")
```

### 获取 Skill 详情

```python
skill = client.skills.get("my-skill@0.1.0")
print(skill['description'])
```

### 上传 Skill 包

```python
result = client.skills.upload("path/to/my-skill.zip")
print(f"上传成功：{result['package_id']}")
```

### 导出 Skill 包

```python
# 导出到文件
client.skills.export_to_file("my-skill@0.1.0", "exported-skill.zip")

# 获取导出数据
export = client.skills.export("my-skill@0.1.0")
print(export['metadata'])
```

### 导入 Skill 包

```python
result = client.skills.import_package("path/to/skill.zip")
print(f"导入成功：{result['skill_id']}")
```

### 运行合约测试

```python
result = client.skills.contract_test("my-skill@0.1.0")
print(f"测试结果：{'通过' if result.get('ok') else '失败'}")
```

### 审批 Skill

```python
result = client.skills.approve("my-skill@0.1.0", reason="测试通过")
print(f"已审批：{result['skill_id']}")
```

## 任务管理

### 列出任务

```python
# 分页查询
result = client.tasks.list(page=1, page_size=10)
tasks = result['items']
pagination = result['pagination']
print(f"共 {pagination['total_items']} 个任务")

# 按状态筛选
result = client.tasks.list(status="running")
```

### 创建任务

```python
task = client.tasks.create(
    name="我的评测任务",
    dataset_id="my-dataset",
    dataset_version=1,
    workflow_version_id="my-workflow:v1",
)
print(f"任务 ID：{task['task_id']}")
```

### 运行预检

```python
result = client.tasks.preflight(
    dataset_id="my-dataset",
    dataset_version=1,
    workflow_version_id="my-workflow:v1",
)
print(f"预检状态：{result['status']}")
```

### 获取诊断

```python
diagnostics = client.tasks.diagnostics("task-xxx")
print(f"根因数量：{len(diagnostics.get('root_causes', []))}")
```

## Workflow 管理

### 列出 Workflow

```python
workflows = client.workflows.list()
for wf in workflows:
    print(f"{wf['version_id']}: {wf['name']} v{wf['version']}")
```

### 列出模板

```python
templates = client.workflows.templates()
for tpl in templates:
    print(f"{tpl['template_id']}: {tpl['name']}")
```

### 创建草稿

```python
draft = client.workflows.create_draft(
    name="我的 Workflow",
    steps=[
        {
            "step_id": "step1",
            "skill_ref": "my-skill@0.1.0",
            "input_mapping": {"question": "row.question"},
            "output_mapping": {"answer": "step1.answer"},
        }
    ],
)
print(f"草稿 ID：{draft['draft_id']}")
```

### 发布草稿

```python
result = client.workflows.publish_draft("draft-xxx")
print(f"版本 ID：{result['version_id']}")
```

## 执行记录管理

### 列出执行记录

```python
result = client.runs.list(page=1, page_size=10)
runs = result['items']
```

### 执行 Run

```python
run = client.runs.execute("run-xxx")
print(f"状态：{run['status']}")
```

### 取消/暂停/恢复

```python
client.runs.cancel("run-xxx")
client.runs.pause("run-xxx")
client.runs.resume("run-xxx")
```

## 报告管理

### 获取任务报告

```python
report = client.reports.task_report("task-xxx")
print(f"通过率：{report.get('pass_rate', 0):.2%}")
print(f"Badcase 数：{report.get('badcase_count', 0)}")
```

### 获取分数分析

```python
analytics = client.reports.score_analytics(
    dataset_id="my-dataset",
    workflow_id="my-workflow",
)
```

## 数据集管理

### 列出数据集

```python
datasets = client.datasets.list()
for ds in datasets:
    print(f"{ds['dataset_id']}: {ds['name']}")
```

### 获取数据集版本

```python
versions = client.datasets.versions("my-dataset")
for v in versions:
    print(f"v{v['version']}: {v['row_count']} 行")
```

## 异常处理

```python
from aegisqa_sdk import (
    AegisQA,
    AegisQAError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
)

try:
    client.skills.get("nonexistent@0.1.0")
except NotFoundError as e:
    print(f"资源不存在：{e.message}")
except AuthenticationError as e:
    print(f"认证失败：{e.message}")
except ValidationError as e:
    print(f"参数错误：{e.message}")
except AegisQAError as e:
    print(f"API 错误：{e.message}")
    print(f"详情：{e.details}")
```

## 配置选项

```python
client = AegisQA(
    base_url="http://localhost:8000",  # API 地址
    api_key="your-api-key",            # API Key（可选）
    timeout=30.0,                       # 请求超时（秒）
)
```

## 最佳实践

1. **使用上下文管理器**：确保连接正确关闭
2. **处理异常**：捕获特定异常类型进行处理
3. **分页查询**：大数据集使用分页避免超时
4. **重试机制**：网络不稳定时实现重试逻辑
5. **缓存结果**：避免重复查询相同数据
