# AegisQA API 参考文档

> 基于 OpenAPI 3.0 规范

## 基础信息

- **Base URL**: `http://localhost:8000`
- **认证**: Bearer Token（可选）
- **内容类型**: `application/json`

## 响应格式

### 成功响应

```json
{
  "key": "value"
}
```

### 分页响应

```json
{
  "items": [...],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 100,
    "total_pages": 5
  }
}
```

### 错误响应

```json
{
  "code": "ERROR_CODE",
  "message": "错误描述",
  "details": {},
  "trace_id": "trace-xxx"
}
```

## 错误码

| HTTP 状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | `VALIDATION_ERROR` | 请求参数校验失败 |
| 401 | `AUTHENTICATION_ERROR` | 认证失败 |
| 403 | `FORBIDDEN` | 权限不足 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 资源冲突 |
| 422 | `UNPROCESSABLE_ENTITY` | 请求格式正确但语义错误 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |
| 502 | `MODEL_GATEWAY_ERROR` | 模型网关错误 |
| 503 | `SERVICE_UNAVAILABLE` | 服务不可用 |

## 端点列表

### 健康检查

```
GET /health
```

返回服务健康状态。

### Dashboard

```
GET /dashboard/summary
```

返回 Dashboard 摘要信息。

### Skills

```
GET    /skills                      # 列出所有 Skill
GET    /skills/packages             # 列出 Skill 包
POST   /skills/packages/upload      # 上传 Skill 包
POST   /skills/import               # 导入 Skill 包
GET    /skills/{skill_id}/export    # 导出 Skill 包
POST   /skills/{skill_id}/contract-test  # 运行合约测试
POST   /skills/{skill_id}/approve   # 审批 Skill
POST   /skills/{skill_id}/disable   # 禁用 Skill
GET    /skills/{skill_id}/versions  # 获取版本历史
```

### Tasks

```
GET    /tasks                       # 列出任务
GET    /tasks/{task_id}             # 获取任务详情
POST   /tasks                       # 创建任务
POST   /tasks/preflight             # 运行预检
GET    /tasks/{task_id}/diagnostics # 获取诊断
GET    /tasks/{task_id}/report      # 获取报告
GET    /tasks/{task_id}/trace-flow  # 获取 Trace Flow
GET    /tasks/{task_id}/trace-tree  # 获取 Trace Tree
```

### Runs

```
GET    /runs                        # 列出执行记录
GET    /runs/{run_id}               # 获取详情
POST   /runs                        # 创建 Run
POST   /runs/{run_id}/execute       # 执行
POST   /runs/{run_id}/cancel        # 取消
POST   /runs/{run_id}/pause         # 暂停
POST   /runs/{run_id}/resume        # 恢复
POST   /runs/{run_id}/retry-failed  # 重试失败项
GET    /runs/{run_id}/cache-stats   # 缓存统计
POST   /runs/{run_id}/cache/invalidate  # 失效缓存
```

### Workflows

```
GET    /workflows                   # 列出 Workflow
GET    /workflow-templates          # 列出模板
GET    /workflow-drafts             # 列出草稿
POST   /workflow-drafts             # 创建草稿
PUT    /workflow-drafts/{draft_id}  # 更新草稿
POST   /workflow-drafts/{draft_id}/publish  # 发布草稿
POST   /workflows/{version_id}/copy  # 复制
POST   /workflows/{version_id}/archive  # 归档
```

### 评测模板

```
GET    /eval-templates              # 列出评测模板
GET    /eval-templates/{template_id}  # 获取模板详情
POST   /eval-templates/{template_id}/create-workflow  # 从模板创建 Workflow
```

### 实验

```
GET    /experiments                 # 列出实验
GET    /experiments/{experiment_id} # 获取详情
POST   /experiments/statistical-test  # 运行统计检验
POST   /experiments/{experiment_id}/compare  # 对比 Run
```

### 数据集

```
GET    /datasets                    # 列出数据集
GET    /datasets/{dataset_id}       # 获取详情
GET    /datasets/{dataset_id}/versions  # 列出版本
```

### 报告

```
GET    /score-analytics             # 分数分析
GET    /badcases                    # Badcase 列表
```

### 模型网关

```
GET    /model-gateway/config        # 获取配置
PUT    /model-gateway/config        # 更新配置
POST   /model-gateway/test          # 测试连接
GET    /model-gateway/connections   # 列出连接
POST   /model-gateway/connections   # 创建连接
```

## 请求示例

### 创建任务

```bash
curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-eval-task",
    "dataset_id": "my-dataset",
    "dataset_version": 1,
    "workflow_version_id": "my-workflow:v1"
  }'
```

### 导出 Skill

```bash
curl http://localhost:8000/skills/my-skill@0.1.0/export \
  -o my-skill.zip
```

### 运行统计检验

```bash
curl -X POST http://localhost:8000/experiments/statistical-test \
  -H "Content-Type: application/json" \
  -d '{
    "metric_name": "pass_rate",
    "test_type": "t-test",
    "group_a_values": [0.85, 0.87, 0.82, 0.88, 0.86],
    "group_b_values": [0.78, 0.80, 0.75, 0.82, 0.79],
    "group_a_name": "Baseline",
    "group_b_name": "New Model"
  }'
```

## SDK 使用

### Python SDK

```bash
pip install aegisqa-sdk
```

```python
from aegisqa_sdk import AegisQA

client = AegisQA(base_url="http://localhost:8000")

# 列出 Skill
skills = client.skills.list()

# 创建任务
task = client.tasks.create(
    name="my-task",
    dataset_id="my-dataset",
    dataset_version=1,
    workflow_version_id="my-workflow:v1",
)

# 导出 Skill
client.skills.export_to_file("my-skill@0.1.0", "my-skill.zip")
```

### CLI

```bash
# 安装
cd sdk && pip install -e .

# 使用
aegisqa skill list
aegisqa task list
aegisqa report <task-id>
aegisqa health
```
