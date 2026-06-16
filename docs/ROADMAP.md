# AegisQA 全面优化方案与产品路线图

> AI 工程治理与评测平台 — 让任何 SOP 通过 Skill 接入，用工作流驱动质量闭环

**文档版本**: v1.0  
**更新时间**: 2026-06-16  
**基于**: 当前代码库分析 + LangSmith/Braintrust/Phoenix/Promptfoo 行业调研

---

## 一、现状评估

### 已有能力 (Strengths)

| 维度 | 能力 | 成熟度 |
|------|------|--------|
| **Skill 系统** | 12 种类型自动检测 + 7 个适配器 + 沙箱执行 | ⭐⭐⭐⭐ |
| **工作流引擎** | DAG 并行执行、条件分支、循环、子工作流定义 | ⭐⭐⭐ |
| **数据管理** | 上传/版本/血缘/质量诊断/修复 | ⭐⭐⭐⭐ |
| **评测报告** | 通过率/延迟/分段分析/Badcase/根因诊断 | ⭐⭐⭐⭐ |
| **治理与审计** | RBAC/审计日志/Skill 审批流/操作追溯 | ⭐⭐⭐⭐ |
| **模型网关** | 多 Provider/密钥轮换/降级链/流式输出 | ⭐⭐⭐⭐ |
| **前端 UI** | 16 个页面/DAG 画布/React Flow/全中文 | ⭐⭐⭐ |

### 核心差距 (Gaps vs 行业)

| 差距 | 对标 | 当前状态 | 影响 |
|------|------|----------|------|
| **无 Prompt Playground** | LangSmith Studio, Braintrust Playground, Phoenix Playground | 无 | 无法在线调试 Prompt |
| **无 SOP 快速接入** | 一行代码/一个 API 即可接入 | 需要写 Python + yaml + zip 打包 | 接入门槛高 |
| **无在线评估器编辑** | LangSmith Evaluator Framework | 硬编码 LLMJudgeSkill | 灵活度不足 |
| **无实时监控** | LangSmith Online Eval, Braintrust Online Scoring | 仅离线评测 | 生产环境盲区 |
| **Stability 测试不足** | 多轮一致性/方差检测 | multirun.py 有基础实现 | 可靠性验证薄弱 |
| **Celery Worker 是占位** | 生产级任务队列 | 仅有骨架代码 | 无法分布式执行 |
| **存储层是 MVP** | MySQL/PostgreSQL + Redis | SQLite + JSON 文件 | 无法支撑生产负载 |
| **Auth 硬编码** | 数据库用户管理 | 3 个固定用户 | 无法多团队使用 |
| **Feature Flags 默认 OFF** | 渐进式发布 | 6 个 feature 默认关闭 | 功能不可见 |
| **无 SDK/CLI** | Promptfoo CLI, Phoenix SDK | 仅 Web UI | 无法 CI/CD 集成 |

---

## 二、优化方案 (按优先级分层)

### P0: 核心体验优化 (1-2 周)

#### 2.1 SOP 快速接入 — "一行代码" Skill 创建

**目标**: 让非工程师也能将自己的 SOP 接入平台

**当前痛点**:
- 创建 Skill 需要: 写 `skill.yaml` + `handler.py` → zip 打包 → 上传 → 审批
- 对于简单场景（一个 API、一个脚本）过于复杂

**优化方案**:

```
┌─────────────────────────────────────────────────────────┐
│  Skill 创建方式 (从简到繁)                                │
├─────────────────────────────────────────────────────────┤
│  1. [新增] 在线编辑器: 粘贴代码 → 自动检测 → 一键注册     │
│  2. [新增] API 声明: 填写 URL + 参数 → 自动生成 Skill      │
│  3. [新增] 指令模式: 写自然语言描述 → Instruction Skill    │
│  4. [已有] Zip 包上传: 完整控制                           │
│  5. [已有] Agent SKILL.md 导入                            │
└─────────────────────────────────────────────────────────┘
```

**具体实现**:

a) **在线 Skill 编辑器** (新增页面 `/skills/create`)
- Monaco Editor 代码编辑器
- 左侧写 Python 函数，右侧实时显示推断的 Schema
- 一键"测试运行"按钮
- 支持从模板开始: "API 调用"、"文本处理"、"LLM 评判"

b) **API Skill 快速注册** (在 SkillsPage 新增 Tab)
- 表单: URL + Method + Headers + Body Template
- 自动发送测试请求，推断 InputSchema/OutputSchema
- 生成 `rest_api` 类型 SkillManifest

c) **指令 Skill 增强** (已有 InstructionPackageSkill，优化 UI)
- 在 Skill 创建页增加"指令模式"
- 写 Markdown 描述 + 选择模型 → 自动生成 Skill
- 支持引用已有数据集作为上下文

#### 2.2 Prompt Playground (对标 LangSmith Studio)

**目标**: 在线调试 Prompt，无需创建工作流

**新增页面**: `/playground`

```
┌─────────────────────────────────────────────────────────┐
│  Prompt Playground                                       │
├──────────────┬──────────────────────────────────────────┤
│  左侧面板     │  右侧面板                                │
│  ┌──────────┐│  ┌────────────────────────────────────┐  │
│  │ Prompt   ││  │ Output                              │  │
│  │ Editor   ││  │ ┌──────────────────────────────┐   │  │
│  │          ││  │ │ 模型输出结果                   │   │  │
│  │ {{input}}││  │ │                                │   │  │
│  │          ││  │ │ Metrics: latency, tokens       │   │  │
│  └──────────┘│  │ └──────────────────────────────┘   │  │
│  ┌──────────┐│  │ ┌──────────────────────────────┐   │  │
│  │ Variables ││  │ │ Judge 评判结果                │   │  │
│  │ input: .. ││  │ │ score: 0.85, label: pass     │   │  │
│  └──────────┘│  │ └──────────────────────────────┘   │  │
│  ┌──────────┐│  └────────────────────────────────────┘  │
│  │ Model    ││  ┌────────────────────────────────────┐  │
│  │ Config   ││  │ Version History                    │  │
│  │ model:.. ││  │ v1: 2026-06-16 0.85               │  │
│  │ temp: 0  ││  │ v2: 2026-06-16 0.92 ← current    │  │
│  └──────────┘│  └────────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────────┘
```

**功能**:
- Prompt 模板编辑 + 变量注入
- 模型选择 (从 ModelGateway 连接列表)
- 实时执行 + 流式输出
- LLM-as-Judge 自动评判
- 版本历史 + Diff 对比
- 批量测试: 上传数据集 → 批量运行 → 统计通过率
- 一键"转为 Skill"或"转为工作流步骤"

#### 2.3 Feature Flags 全部开启

**当前问题**: 6 个 Feature Flag 默认 OFF，用户看不到完整功能

**操作**: 将 `aegisqa/core/features.py` 中所有默认值改为 `True`

```python
FEATURE_CI_GATE = _bool_env("AEGISQA_ENABLE_CI_GATE", True)      # 原 False
FEATURE_CANDIDATE_ASSETS = _bool_env("AEGISQA_ENABLE_CANDIDATE_ASSETS", True)
FEATURE_REPAIR_TASKS = _bool_env("AEGISQA_ENABLE_REPAIR_TASKS", True)
FEATURE_EXPERIMENTS = _bool_env("AEGISQA_ENABLE_EXPERIMENTS", True)
FEATURE_ANNOTATION_QUEUE = _bool_env("AEGISQA_ENABLE_ANNOTATION_QUEUE", True)
FEATURE_JUDGE_AUDIT = _bool_env("AEGISQA_ENABLE_JUDGE_AUDIT", True)
```

#### 2.4 清理生产代码中的调试残留

- 删除 `app.py:939` 的 `debug_conflict.log` 写入
- 将 JWT secret 从硬编码改为环境变量读取
- 将硬编码用户改为可配置的 seed 用户

---

### P1: 生产就绪化 (2-4 周)

#### 2.5 存储层升级

**目标**: 从 SQLite/JSON 迁移到生产级存储

```
当前:  SQLite (json_documents + jsonl_rows)
       ↓ 
目标:  SQLite (开发) / MySQL (生产) — 已有 MySQLStore 实现
       + Redis (缓存 + 任务队列)
```

**具体工作**:
- `SQLiteStore` 已实现 WAL 模式，可支撑中小规模
- `MySQLStore` 已实现，需要: 连接池调优、索引优化、迁移脚本
- Redis 已有 `RedisCache` 和 `RedisRateLimiter`，需要: 正式集成配置
- 数据库迁移工具: Alembic 或自研 JSON→SQL 迁移脚本

#### 2.6 Auth 系统正式化

**当前**: 3 个硬编码用户  
**目标**: 数据库用户管理

```
┌─────────────────────────────────────────────────────────┐
│  Auth 升级路径                                            │
├─────────────────────────────────────────────────────────┤
│  Phase 1: 环境变量配置用户列表 (快速)                      │
│    AEGISQA_USERS=admin:pass123:admin,eval:pass:evaluator │
│                                                          │
│  Phase 2: 数据库用户表 + 注册/登录 API                    │
│    users(id, username, password_hash, role, created_at)  │
│    POST /auth/register, POST /auth/login                 │
│                                                          │
│  Phase 3: SSO/LDAP/OIDC 集成 (企业需求)                   │
│    OIDC Provider 配置 → JWT 令牌交换                      │
└─────────────────────────────────────────────────────────┘
```

#### 2.7 Celery Worker 正式集成

**当前**: `celery_app.py` 是占位代码  
**目标**: 分布式任务执行

```python
# 正式实现:
1. celery_app.py: 配置 Redis 作为 Broker
2. tasks.py: execute_run, execute_item, execute_step 三级任务
3. worker.py: 独立 Worker 进程启动脚本
4. 监控: Celery Flower 集成到治理页面
```

#### 2.8 LoopNode/SubWorkflowNode 集成到 Runner

**当前**: `dag.py` 定义了 LoopNode/SubWorkflowNode 但未集成  
**目标**: 在 `_execute_item_dag()` 中支持循环和子工作流

```python
# runner.py 中增加:
def _execute_loop_node(self, node, context):
    """遍历数组字段，对每个元素执行子步骤"""
    
def _execute_subworkflow_node(self, node, context):
    """嵌套执行另一个工作流"""
```

---

### P2: 功能增强 (1-2 个月)

#### 2.9 在线评估器框架 (对标 LangSmith Evaluators)

**目标**: 可视化配置评判规则，而非硬编码

**新增页面**: `/evaluators`

```
┌─────────────────────────────────────────────────────────┐
│  评估器管理                                               │
├─────────────────────────────────────────────────────────┤
│  [创建评估器]                                             │
│                                                          │
│  评估器类型:                                              │
│  ○ 代码评估器 (Python 函数)                               │
│  ○ LLM 评估器 (Prompt + 评分规则)                         │
│  ○ 规则评估器 (正则/关键词/长度)                           │
│  ○ 人工评估器 (标注队列)                                   │
│                                                          │
│  LLM 评估器配置:                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 评判 Prompt:                                       │  │
│  │ 请评估以下回答的质量...                              │  │
│  │                                                    │  │
│  │ 评分规则:                                           │  │
│  │ - 准确性 (0-1): 是否包含正确答案                     │  │
│  │ - 完整性 (0-1): 是否覆盖所有要点                     │  │
│  │ - 流畅性 (0-1): 语言是否自然                         │  │
│  │                                                    │  │
│  │ 输出格式: JSON {accuracy, completeness, fluency}    │  │
│  │ 通过条件: accuracy >= 0.8 AND completeness >= 0.7   │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### 2.10 数据集在线编辑 (对标 LangSmith Dataset Editor)

**增强 DatasetsPage**:
- 在线编辑数据行 (表格形式)
- 从运行结果中提取 Badcase → 一键加入数据集
- 数据集 Diff: 两个版本之间的变更对比
- 数据集模板: 按场景预置字段结构

#### 2.11 实验对比可视化增强

**增强 ExperimentsPage**:
- 多运行对比表格 (指标并排)
- 统计显著性标记 (* p<0.05, ** p<0.01)
- 雷达图: 多维度指标对比
- 趋势图: 指标随版本变化趋势

#### 2.12 追踪系统增强

**增强 TraceFlowPage**:
- 火焰图视图: 每步耗时占比
- 数据血缘: 从输入到输出的完整数据流
- 对比模式: 两个 Trace 的并排 Diff
- 导出: 导出为 OpenTelemetry 格式

#### 2.13 工作流模板市场增强

**增强 WorkflowMarketPage**:
- 社区模板: 用户可发布自己的工作流模板
- 模板评分和评论
- 模板分类: RAG/Agent/对话/安全/自定义
- 一键"从模板创建工作流"

---

### P3: 平台化能力 (2-3 个月)

#### 2.14 SDK/CLI (对标 Promptfoo CLI, Phoenix SDK)

**Python SDK**:
```python
import aegisqa

# 创建 Skill
skill = aegisqa.create_skill(
    name="my-sop",
    type="python_function",
    handler=my_function,
)

# 创建工作流
workflow = aegisqa.Workflow()
workflow.add_source("csv", path="data.csv")
workflow.add_step("my-sop", config={"model": "gpt-4"})
workflow.add_step("judge", config={"criteria": "accuracy"})

# 运行评测
report = workflow.evaluate(dataset="test-v1")
print(report.pass_rate)  # 0.92
print(report.badcases)    # [...]
```

**CLI**:
```bash
# 初始化项目
aegisqa init

# 上传 Skill
aegisqa skill upload ./my-skill/

# 运行评测
aegisqa eval --workflow rag-v1 --dataset test-set --model gpt-4

# 查看报告
aegisqa report --task-id xxx --format html

# CI/CD 集成
aegisqa ci --gate quality-v1 --threshold 0.85
```

#### 2.15 REST API 文档与 OpenAPI

- 自动生成 OpenAPI 3.0 规范 (FastAPI 原生支持)
- 交互式 API 文档 (Swagger UI / ReDoc)
- API Key 认证 (供 SDK/CLI 使用)
- Rate Limiting 策略文档

#### 2.16 Webhook 与事件系统

**目标**: 当评测完成/质量门禁失败/Badcase 积累时，自动触发外部系统

```python
# Webhook 配置
POST /webhooks
{
    "url": "https://hooks.slack.com/...",
    "events": ["task.completed", "ci_gate.failed", "badcase.threshold"],
    "secret": "whsec_xxx"
}
```

#### 2.17 多租户支持

- 工作空间 (Workspace) 隔离
- 每个 Workspace 独立的 Skill/Workflow/Dataset
- 跨 Workspace 的 Skill 共享市场

---

### P4: 高级能力 (3-6 个月)

#### 2.18 在线评测 (Online Evaluation)

**目标**: 生产环境实时监控 (对标 LangSmith Online Eval)

```
┌─────────────────────────────────────────────────────────┐
│  在线评测管道                                             │
│                                                          │
│  生产流量 → 采样 → 评估器 → 指标聚合 → 告警              │
│              ↓                                           │
│         异常检测                                          │
│         - 通过率突降                                      │
│         - 延迟突增                                        │
│         - 新 Badcase 模式                                 │
│              ↓                                           │
│         自动创建修复任务                                   │
└─────────────────────────────────────────────────────────┘
```

#### 2.19 AI Agent 评测 (对标 Phoenix Agent Eval)

- 多步 Agent 轨迹评估
- 工具调用正确性验证
- Agent 规划效率评估
- 多 Agent 协作评测

#### 2.20 红队测试增强 (对标 Promptfoo Red Team)

- 自动化对抗测试生成
- Jailbreak 检测
- Prompt Injection 扫描
- 数据泄露风险检测
- 合规性检查 (GDPR/CCPA)

#### 2.21 OpenTelemetry 集成

- 导出 Trace 到 Jaeger/Zipkin/Phoenix
- 标准化 Span 格式
- 与现有 APM 系统集成

---

## 三、SOP 接入方案详细设计

### 核心理念: "平台适应 Skill，而非 Skill 适应平台"

```
┌─────────────────────────────────────────────────────────────┐
│                     SOP 接入路径                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ 零代码接入    │    │ 低代码接入    │    │ 全代码接入    │  │
│  │              │    │              │    │              │  │
│  │ • API 声明   │    │ • Python函数 │    │ • 自定义Skill │  │
│  │ • 指令模式   │    │ • LangChain  │    │ • Docker容器  │  │
│  │ • 在线编辑器 │    │ • LlamaIndex │    │ • gRPC服务    │  │
│  │              │    │ • OpenAI Tool│    │ • 自定义适配器 │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              统一 Skill 注册层                        │   │
│  │  自动检测 → Schema 推断 → 安全扫描 → 合约测试        │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              工作流编排层                              │   │
│  │  可视化 DAG → 数据映射 → 条件分支 → 并行执行          │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              评测闭环层                                │   │
│  │  自动评判 → 人工审核 → Badcase 分析 → 持续优化        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### SOP 接入示例

#### 示例 1: 客服 SOP 接入 (零代码)

```yaml
# 前端 API 声明表单生成
name: customer-service-sop
type: rest_api
config:
  url: https://api.company.com/sop/evaluate
  method: POST
  headers:
    Authorization: Bearer ${API_KEY}
  body_template:
    question: "{{input.question}}"
    answer: "{{input.answer}}"
    sop_rules: "{{config.rules}}"
input_schema:
  type: object
  properties:
    question: { type: string }
    answer: { type: string }
output_schema:
  type: object
  properties:
    compliant: { type: boolean }
    violations: { type: array, items: { type: string } }
    score: { type: number }
```

#### 示例 2: 文本处理 SOP 接入 (低代码)

```python
# 在线编辑器粘贴，自动检测
def check_toxicity(input_data: dict, config: dict) -> dict:
    """检测文本中的有害内容"""
    text = input_data.get("text", "")
    # 调用已有的安全检测 API
    result = call_safety_api(text, config.get("threshold", 0.8))
    return {
        "is_toxic": result["score"] > config.get("threshold", 0.8),
        "toxicity_score": result["score"],
        "categories": result["categories"],
    }
```

#### 示例 3: LangChain Agent SOP 接入 (全代码)

```python
# 已有适配器自动检测
from langchain.agents import AgentExecutor
from langchain.tools import Tool

agent = create_customer_agent(tools=[crm_tool, knowledge_tool])
# 上传 zip 包，自动检测为 langchain 类型
# Platform 自动推断 input_schema/output_schema
```

---

## 四、技术实现优先级

### Phase 1: 立即可做 (本周)

| 任务 | 文件 | 工作量 |
|------|------|--------|
| Feature Flags 全部开启 | `core/features.py` | 5 min |
| 清理 debug_conflict.log | `api/app.py` | 5 min |
| 在线 Skill 编辑器页面 | 新增 `pages/SkillCreatePage.tsx` | 2-3 天 |
| API Skill 快速注册表单 | 新增 `pages/SkillCreatePage.tsx` | 1-2 天 |
| 指令 Skill UI 增强 | 修改 `pages/SkillsPage.tsx` | 1 天 |

### Phase 2: 短期 (2-4 周)

| 任务 | 涉及模块 | 工作量 |
|------|----------|--------|
| Prompt Playground | 新增 `pages/PlaygroundPage.tsx` + 后端 API | 1 周 |
| 评估器框架 | 新增 `evaluators/` 模块 + 页面 | 1 周 |
| Auth 环境变量配置 | 修改 `security/auth.py` | 2 天 |
| LoopNode 集成到 Runner | 修改 `engine/runner.py` | 3 天 |
| 数据集在线编辑 | 增强 `pages/DatasetsPage.tsx` | 3 天 |

### Phase 3: 中期 (1-2 个月)

| 任务 | 涉及模块 | 工作量 |
|------|----------|--------|
| Python SDK | 新增 `sdk/` 包 | 2 周 |
| CLI 工具 | 新增 `cli/` 模块 | 1 周 |
| Celery 正式集成 | 重写 `workers/` | 1 周 |
| Webhook 系统 | 新增 `webhooks/` 模块 | 1 周 |
| 实验对比可视化 | 增强 `ExperimentsPage` | 1 周 |
| 追踪火焰图 | 增强 `TraceFlowPage` | 1 周 |

### Phase 4: 长期 (3-6 个月)

| 任务 | 涉及模块 | 工作量 |
|------|----------|--------|
| 在线评测管道 | 新增 `online_eval/` 模块 | 3 周 |
| Agent 评测 | 新增 `agent_eval/` 模块 | 3 周 |
| 红队测试增强 | 扩展 `reports/` 模块 | 2 周 |
| OpenTelemetry 集成 | 扩展 `observability/` | 2 周 |
| 多租户 | 架构级改造 | 4 周 |

---

## 五、行业定位

### AegisQA 的差异化优势

| 维度 | LangSmith | Phoenix | Promptfoo | **AegisQA** |
|------|-----------|---------|-----------|-------------|
| 定位 | LangChain 生态的评测平台 | 通用 AI 可观测性 | AI 安全测试 | **SOP 评测治理平台** |
| Skill 系统 | 无 | 无 | 无 | **12 种类型 + 自动检测** |
| DAG 工作流 | 无 | 无 | 线性 Pipeline | **完整 DAG + 条件分支** |
| 治理审计 | 基础 | 无 | 无 | **RBAC + 审计 + 审批流** |
| 人工标注 | 有 | 基础 | 无 | **标注队列 + SLA** |
| 修复闭环 | 无 | 无 | 无 | **修复任务 + 根因分析** |
| 自部署 | 混合 | Docker | 本地 | **SQLite/MySQL/Redis** |
| 中文支持 | 无 | 无 | 无 | **全中文 UI** |

### 目标用户画像

1. **AI 工程团队**: 需要系统化评测 LLM 应用质量
2. **产品经理**: 需要将业务 SOP 接入 AI 评测
3. **质量团队**: 需要 Badcase 管理和修复闭环
4. **安全团队**: 需要红队测试和合规检查

### 核心价值主张

> **"把你的 SOP 告诉我，我帮你用 AI 评测它"**

- 不是通用的 LLM 可观测性工具 (那是 Phoenix)
- 不是纯安全测试工具 (那是 Promptfoo)
- 而是 **让任何业务流程 (SOP) 通过 Skill 接入，用工作流驱动质量持续改进的平台**

---

## 六、立即执行清单

- [ ] 开启所有 Feature Flags
- [ ] 清理调试代码
- [ ] 创建在线 Skill 编辑器页面
- [ ] 实现 API Skill 快速注册
- [ ] 实现 Prompt Playground MVP
- [ ] 添加评估器框架
- [ ] Auth 环境变量化
- [ ] LoopNode/SubWorkflowNode 集成
- [ ] 编写 Python SDK 骨架
- [ ] 编写 CLI 骨架
