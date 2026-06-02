# AegisQA

AegisQA 是一个面向 AI 测试、评测与研发团队的轻代码自动化评测平台。它的核心目标不是只展示一些静态指标，而是把一次 AI 评测任务完整串起来：

```text
上传或选择数据集
  -> 选择或创建 Workflow
  -> 绑定 Skill 输入、输出和运行参数
  -> 创建 Task
  -> 按数据集逐条执行 Workflow
  -> 查看任务报告、Trace、Badcase
  -> 导出结果、人工纠错、沉淀 Golden Dataset
```

当前项目已经从最初的 Streamlit Demo 演进为 **FastAPI 后端 + React/Vite/TypeScript 前端** 的前后端分离产品形态。Streamlit 仍保留为 legacy demo，主要产品入口是 React 工作台。

## 项目定位

AegisQA 主要解决这些问题：

- 让评测数据、评测流程、执行任务和报告结果形成可追溯闭环。
- 让不同的评测能力以 Skill 插件形式接入，例如 LLM 调用、规则校验、Judge、抽样、质量检查、ASR 评测等。
- 让 Workflow 支持点对点、点对多、多对一、条件分支和聚合节点等更接近真实业务的流程结构。
- 让每条样本都有独立的执行轨迹，便于定位失败原因、复现 Badcase 和做人工纠错。
- 让 Judge 审计、Golden Dataset、Annotation Queue、CI Gate 等评测治理能力逐步进入同一个平台。

## 技术栈

后端：

- FastAPI：提供评测平台 API。
- Pydantic：定义请求、响应、Skill Manifest、Run/Task/Report 数据结构。
- 本地 JsonStore：默认单机开发存储，便于快速验证。
- SQLite Store：轻量本地持久化模式，适合单机长期试用。
- Celery / Redis / MySQL 适配资产：作为生产化演进参考。
- Pytest：后端单元测试、API 合约测试和执行链路测试。

前端：

- React：主工作台 UI。
- Vite：前端开发服务器与构建工具。
- TypeScript：类型约束。
- Ant Design：后台系统组件。
- React Flow：Workflow 画布。
- TanStack Query：API 请求、缓存和刷新。
- ECharts：报告图表和分析视图。
- Vitest / Testing Library / Playwright：前端单测和端到端验证。

## 目录结构

```text
AegisQA/
├── aegisqa/                 # 后端核心代码
│   ├── api/                 # FastAPI app 与领域路由
│   ├── datasets/            # 数据集上传、解析、版本化与字段推断
│   ├── engine/              # Run、RunItem、Step Trace 执行引擎
│   ├── skills/              # Skill 基类、注册表、内置 Skill、插件包执行
│   ├── workflows/           # Workflow 模型、DAG 校验、Graph 发布
│   ├── reports/             # 报告聚合、导出、诊断与 Trace Flow
│   ├── badcases/            # Badcase 服务、纠错与聚类
│   ├── judge/               # Judge Profile 与审计指标
│   ├── storage/             # JsonStore / SQLiteStore
│   └── infrastructure/      # 生产适配清单
├── frontend/                # React 前端工作台
│   ├── src/api/             # API Client 与前端类型
│   ├── src/pages/           # 数据集、Skill、Workflow、任务、报告等页面
│   └── src/test/            # 前端测试
├── docs/                    # 项目状态、验收矩阵和设计记录
├── examples/                # MVP Demo 与示例脚本
├── infra/                   # MySQL、Celery 等生产化参考资产
├── tests/                   # 后端测试
├── streamlit_app.py         # Legacy Streamlit Demo
└── docker-compose.yml       # MySQL / Redis / Celery 参考编排
```

## 核心概念

### Dataset

Dataset 是评测数据源。当前支持 CSV 和 JSONL 上传，也支持从本地路径导入。平台会为数据集创建版本，并推断字段类型，例如：

```text
row.question
row.reference
row.answer
row.metadata
```

Workflow 中的 Skill 输入通常绑定到这些 `row.xxx` 字段。

### Skill

Skill 是 Workflow 中可以执行的能力节点。每个 Skill 由 manifest 固定输入、输出和配置参数：

- `input_schema`：这个 Skill 需要什么输入，例如 `question`、`reference`。
- `output_schema`：这个 Skill 会产出什么结果，例如 `answer`、`score`、`label`。
- `config_schema`：运行参数，例如 `model`、`temperature`、`threshold`。

平台支持两类 Skill：

- 内置 Skill：随代码注册，用于基础演示和回归测试。
- 插件 Skill：用户上传 zip 包，合约测试通过并审批后，才允许放入 Workflow。

### Workflow

Workflow 是由多个节点组成的评测流程。一个 Workflow Version 发布后不可变，Task 会绑定某个固定版本执行，保证结果可追溯。

典型流程：

```text
Dataset row
  -> LLMCall
  -> LLMJudge
  -> Report
```

也可以支持更复杂结构：

```text
LLMCall
  -> RuleCheck
  -> LLMJudge
  -> HallucinationCheck
  -> Aggregator
  -> Report
```

### Task

Task 是用户视角的“一次评测任务”。一个 Task 固定绑定：

- Dataset Version
- Workflow Version
- 执行参数
- Run Attempt
- Report
- Badcase
- Trace Tree

执行中心默认围绕 Task 展示，而不是孤立展示底层 Run。

### Run / RunItem / Step

Run 是 Task 的一次执行批次，也可以理解为 Attempt。Run 内部会把数据集拆成多个 RunItem：

```text
100 条数据
  -> 100 个 RunItem
  -> 每个 RunItem 独立执行一次完整 Workflow
```

如果 Workflow 有 3 个 Skill 节点，则 100 条数据最多会产生 300 次 Skill 调用。

Step 是单个 RunItem 中某个 Workflow 节点的执行轨迹，记录：

- 输入快照
- 输出快照
- 配置参数快照
- 参数来源 trace
- 耗时
- 缓存命中
- 错误信息

## 执行模型

当前推荐模型是：

```text
平台负责遍历数据集
Skill 只处理当前这一条样本
报告层聚合所有样本结果
```

这样做的好处：

- 每条样本有独立 Trace。
- 单条失败不会污染整个任务。
- Badcase 可以精确定位到 row。
- 失败项可以单独重试。
- 后续可以自然升级为队列并发执行。

不推荐把普通 Skill 写成自己循环 100 条数据。除非它是专门的批处理 Source / Sampling Skill，否则平台将无法知道内部哪一条样本失败、哪一条耗时过长。

## Agent Skill 包格式

Skill 市场现在以“上传 Agent Skill zip 包”为主入口。平台不再要求从本机 `.codex/skills`
或 `.agents/skills` 扫描目录；你可以把自己已经写好的 Agent Skill 打成 zip 上传。

推荐结构：

```text
my_agent_skill.zip
├── SKILL.md                 # 必须：Agent Skill 的说明、触发场景和使用约束
├── skill.yaml               # 强烈建议：平台机器可读合约
├── scripts/
│   └── run.py               # 脚本型 Skill 的执行入口
├── references/
│   └── rules.md             # 说明型 Skill 的补充资料
└── assets/                  # 可选资源
```

当前支持两种运行模式：

- `runtime.mode=script`：不调用模型，只执行 `runtime.entrypoint` 指向的 Python 函数，适合关键词检查、规则打分、字段转换、纯参数计算。
- `runtime.mode=instruction_model`：读取 `SKILL.md` 和 `references/`，通过统一模型网关生成结果，适合提示词型 Agent Skill。

脚本型 Skill 必须在 `skill.yaml` 或 `skill.json` 中声明 `input_schema`、`output_schema`、
`config_schema` 和 `runtime.entrypoint`。示例：

```yaml
skill_id: agent.keyword_check@0.1.0
name: 关键词检查
version: 0.1.0
description: 不调用模型的参数化关键词检查。
runtime:
  mode: script
  entrypoint: scripts/run.py:run
input_schema:
  type: object
  required: [text]
  properties:
    text:
      type: string
config_schema:
  type: object
  required: [keywords]
  properties:
    keywords:
      type: array
      items:
        type: string
output_schema:
  type: object
  required: [hit, matched_keywords]
  properties:
    hit:
      type: boolean
    matched_keywords:
      type: array
      items:
        type: string
example_input:
  text: 这段回答存在幻觉
example_config:
  keywords: [幻觉]
```

脚本入口必须暴露 `run(inputs, config)`：

```python
def run(inputs, config):
    text = inputs["text"]
    keywords = config["keywords"]
    matched = [item for item in keywords if item in text]
    return {
        "output": {"hit": bool(matched), "matched_keywords": matched},
        "metrics": {"matched_count": len(matched)},
        "artifacts": {},
        "logs": ["script mode"],
    }
```

旧版 `skill.yaml|skill.json + handler.py` 插件仍然兼容；如果没有声明 `runtime`，平台会把
`handler.py:run` 当作脚本入口。

插件不会直接 import 到 FastAPI 主进程中执行，而是通过短生命周期 Python 子进程运行。
说明型 Skill 则通过统一模型网关执行，不会运行脚本。更详细的打包、上传、审批和
Workflow 引用方式见 [docs/AGENT_SKILL_PACKAGE_GUIDE.md](docs/AGENT_SKILL_PACKAGE_GUIDE.md)。

当前插件执行保护：

- 默认单次 Skill 调用超时：60 秒。
- 可通过环境变量 `AEGISQA_PACKAGE_SKILL_TIMEOUT_SECONDS` 调整。
- 最大超时上限：600 秒。
- stdout JSON 输出大小限制：64KB。
- 插件 zip 会做路径安全检查，禁止绝对路径和 `../` 跨目录文件。

如果插件包非常大，当前 base64 JSON 上传方式不适合长期使用。后续生产方案应升级为 multipart 上传、对象存储、依赖隔离、包大小限制、压缩炸弹检测和沙箱执行。

## 主启动路径

### 1. 启动后端

```powershell
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000
```

后端 API：

```text
http://127.0.0.1:8000
```

API 文档：

```text
http://127.0.0.1:8000/docs
```

### 2. 启动前端

```powershell
cd frontend
npm install
npm run dev
```

前端默认地址：

```text
http://localhost:5173
```

Vite 会把 `/api/*` 代理到 `http://127.0.0.1:8000`。

### 3. SQLite 模式

默认存储是本地 JSON 文件。如果希望使用轻量 SQLite：

```powershell
$env:AEGISQA_STORAGE_BACKEND="sqlite"
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000
```

SQLite 文件默认位于：

```text
data/aegisqa_store/aegisqa.sqlite3
```

注意：Dataset rows、上传文件和插件包仍保留在本地文件目录中，避免把大对象全部塞进 SQLite。

## 前端页面

- 概览：展示任务数量、数据集数量、Workflow 数量、待审批 Skill、关键质量指标。
- 数据集：上传 CSV/JSONL、查看字段、预览字段路径、进行数据源准备。
- Skill 市场：上传插件包、查看 manifest、运行合约测试、查看输入输出 schema。
- Workflow 市场：查看草稿、已发布版本和模板，支持新建、复制、删除、进入画布。
- Workflow 画布：搜索 Skill、拖拽节点、连线、输入绑定、输出查看、运行参数、校验、试运行和发布。
- 执行中心：任务列表、创建任务、执行任务、查看执行进度和 RunItem 明细。
- 报告中心：按任务查看报告、指标卡、错误分布、耗时分布、Badcase 和导出入口。
- Judge 审计：管理 Judge Profile，查看 Accuracy、Precision、Recall、F1、Kappa 和混淆矩阵。
- 治理与审计：Skill 生命周期、RBAC 检查、审计日志和生产化状态。

## Workflow 设计规则

发布 Workflow 前会进行结构与类型校验：

- DAG 不能有环。
- Skill 必须已注册且允许被引用。
- 点对多允许，一个输出可以连接多个下游。
- 多对一必须使用 Join 或 Aggregator，避免隐式覆盖上下文。
- 条件分支必须配置条件表达式。
- Skill 输入字段来自 `input_schema`，输出字段来自 `output_schema`。
- 下游引用上游输出时，使用 `节点ID.字段名`，例如 `answer.answer`、`judge.score`。
- 可选 object/array 输入留空时不会传入 Skill，也不会触发类型错误。

## API 概览

常用 API：

```text
GET  /skills
POST /skills/packages/upload
POST /skills/{skill_id}/contract-test

GET  /datasets
POST /datasets/upload

GET  /workflow-drafts
POST /workflow-drafts
POST /workflow-drafts/{draft_id}/publish
DELETE /workflow-drafts/{draft_id}
GET  /workflows

GET  /tasks
POST /tasks
POST /tasks/{task_id}/execute
POST /tasks/{task_id}/pause
POST /tasks/{task_id}/resume
POST /tasks/{task_id}/cancel
POST /tasks/{task_id}/retry-failed

GET  /tasks/{task_id}/report
GET  /tasks/{task_id}/trace-tree
GET  /badcases
GET  /audit-events
```

错误响应统一包含：

```json
{
  "code": "TYPE_MISMATCH",
  "message": "字段 question 类型不匹配",
  "details": {},
  "trace_id": "trace_xxx"
}
```

## 验证命令

后端全量测试：

```powershell
python -m pytest -q
```

前端类型检查：

```powershell
cd frontend
npm run typecheck
```

前端单测：

```powershell
cd frontend
npm test
```

前端生产构建：

```powershell
cd frontend
npm run build
```

端到端测试：

```powershell
cd frontend
npm run e2e
```

MVP Demo：

```powershell
python -m aegisqa.examples.run_mvp_demo
```

Legacy Streamlit Demo：

```powershell
streamlit run streamlit_app.py
```

## 生产化演进建议

当前仓库包含生产化参考资产，但默认模式仍是本地开发/验证形态。生产部署建议：

- 元数据数据库：MySQL 或 PostgreSQL。
- 队列系统：Redis + Celery，队列消息只携带 `item_id`。
- 文件与报告：对象存储或受控文件服务。
- 插件运行：独立 venv、容器或沙箱，限制 CPU、内存、网络和文件权限。
- Secret 管理：接入 KMS 或密钥管理系统，禁止明文写入 Run 快照。
- 审计：所有上传、审批、执行、导出、纠错行为进入审计日志。
- 质量门禁：按通过率、关键指标、红队失败数和 Judge 可信度阻断发布。
- CI/CD：把评测任务与 Pull Request、模型发布、Prompt 发布流程连接。

生产适配相关文件：

- `docker-compose.yml`：MySQL、Redis、Celery Worker 参考编排。
- `infra/mysql/schema.sql`：PRD 核心实体 MySQL 表结构。
- `infra/celery/README.md`：轻量 `item_id` 消息契约和限速策略。
- `aegisqa/infrastructure/manifest.py`：生产就绪适配清单。

## 当前状态说明

项目状态会持续记录在：

```text
docs/PROJECT_STATUS.md
```

根据项目记忆，每次修改代码、文档、配置、测试、脚手架或 UI 后，都必须同步更新该文件。
