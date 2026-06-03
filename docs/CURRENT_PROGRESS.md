# AegisQA 当前进展与实现程度

生成日期：2026-06-03

本文基于当前仓库代码、README、项目状态文档、验收矩阵、后端路由、前端路由和测试文件静态盘点生成。它描述的是当前本地仓库实现程度，不等同于生产环境部署验收。

## 总体判断

AegisQA 当前已经不是早期 Streamlit Demo，而是一个前后端分离的 AI 自动化评测平台 MVP：后端以 FastAPI 为主入口，前端以 React/Vite/TypeScript 工作台为主入口，核心链路已经围绕 Task 打通。

当前完成度可以按两个口径理解：

- 作为本地可演示、可验证的产品 MVP：完成度较高，核心闭环已经形成。
- 作为企业级生产平台：仍处在基础能力和生产化参考资产并存阶段，需要补真实分布式执行、强隔离插件沙箱、企业鉴权、多租户、生产数据库和 CI/CD 发布治理。

最适合当前项目的阶段描述是：工程化 MVP 已成型，产品主流程可演示，治理/修复/候选资产等高级能力已具备最小闭环，生产级可靠性仍待系统性补强。

## 当前代码规模

静态扫描结果：

| 类型 | 当前数量 | 说明 |
| --- | ---: | --- |
| 后端 Python 文件 | 61 | 覆盖 API、执行引擎、数据集、Workflow、Skill、报告、治理、存储等模块 |
| 后端测试文件 | 23 | 覆盖 API、平台核心、任务中心、Workflow、报告、风险分析、SQLite、插件安全等 |
| 前端 TS/TSX 文件 | 46 | 覆盖主应用、API client、页面、组件、测试与 Workflow 画布子模块 |
| FastAPI 路由装饰器 | 132 | 包含 Dataset、Skill、Workflow、Task、Report、治理和产品化扩展接口 |
| React 懒加载页面 | 16 | 包含概览、数据集、Skill、Workflow、执行、报告、修复任务、CI Gate、Annotation、候选资产等页面 |

## 主流程实现程度

### 1. 数据集能力：已实现基础闭环

当前已支持 CSV/JSONL 上传、本地路径导入、Source Skill 物化、数据集版本化、字段类型推断、字段修正、字段路径预览、Lineage 查询和按 chunk 读取行数据。

内部实现集中在 `aegisqa/datasets/service.py` 和 `aegisqa/api/routes/datasets.py`。执行器创建 RunItem 时按 chunk 消费数据集，避免创建阶段一次性把所有 rows 全部载入内存。

实现程度：本地评测任务够用；生产级数据源接入、权限隔离、对象存储和大规模数据索引仍未完整落地。

### 2. Skill 插件体系：已实现可控上传、合约测试和审批门禁

当前 Skill 由 manifest 定义输入、输出和运行参数。仓库内置了 CSV、JSONL、DBQuery、API Pull、Online Sample、LLM Call、LLM Judge、ASR Eval 等示例 Skill。

上传插件包要求 zip 根目录包含 `skill.yaml` 或 `skill.json` 以及 `handler.py`。插件包通过短生命周期 Python 子进程执行，不直接 import 到 FastAPI 主进程。当前已有路径安全检查、审批状态、合约测试、stdout 输出限制、本地路径脱敏和可配置超时。

实现程度：插件产品机制已经成型，适合本地演示和受控试用；生产级 CPU/内存/网络隔离、依赖环境隔离、包签名、病毒扫描、压缩炸弹检测和对象存储仍待补齐。

### 3. Workflow 编排：图形化设计和发布校验已可用

当前支持 Workflow 草稿、已发布版本、模板、复制、删除、归档、Graph 校验、试运行、参数预览和发布。前端使用 React Flow 构建画布，支持 Source/Skill/Join/Output/Aggregator 等节点、连线、删除、撤销/重做、字段绑定、参数配置和保存回放。

后端 `aegisqa/workflows/graph.py` 已提供 DAG 结构校验、点对多、多对一 Join/Aggregator 规则、必填输入映射、Skill 参数校验、上游输出引用检查和结构化错误提示。执行层会把节点输出暴露为 `step_id.field` 命名空间，下游可以直接引用。

实现程度：图形化编排体验已经达到产品 MVP；复杂表达式语言、企业调度策略、分布式 DAG 执行和更完整的 schema-driven 高级表单仍属于后续增强。

### 4. Task 与执行中心：Task 一等模型已经建立

当前产品语义已经从单纯 Run 转向 Task。Task 绑定 Dataset Version、Workflow Version、执行模板、评测目标、质量门槛、Preflight、Run Attempt、报告和 Badcase。

执行器 `aegisqa/engine/runner.py` 的核心模型是：

```text
Dataset Version
  -> Run
  -> RunItem per row
  -> Step per Workflow node
```

每条样本独立执行完整 Workflow，Step 记录输入快照、输出快照、参数来源、耗时、缓存命中、限速等待和错误。当前支持执行、暂停、恢复、取消、失败重试、Run Attempt、Step 级 Evaluation Cache 和基础限速记录。

实现程度：本地同步执行闭环可用，Trace 可追溯；真正的异步 Worker、Celery/Redis 队列、任务级超时、分布式断点续跑和高并发调度仍是生产化重点。

### 5. Task Preflight：创建前门禁已经进入主链路

当前创建 Task 前会运行 Preflight，检查数据集非空、Workflow 字段映射、历史坏 Workflow、Skill 审批状态、Skill 参数配置、Golden 覆盖、质量门槛和成本预算。

Preflight 会生成 `preflight_id`，并保存创建任务前用户实际看到的证据。创建 Task 时服务端会重新计算 Preflight，客户端不能伪造 passed 结果绕过门禁。关键参数变化后会触发过期判断。

实现程度：创建前防错能力较完整；权限策略、模板审批、跨团队共享范围和更细的预算/成本事实源还需继续补。

### 6. 报告、Badcase 与 Trace：报告闭环已成型

当前报告能力包含 Run Report 聚合、Task Report 包装、质量决策、分层分析、根因诊断、成本预算状态、红队扫描、Badcase 明细、Badcase 状态流转、加入 Golden、报告导出和导出审批。

Trace 已拆成 Trace Tree 和 Trace Flow 两类视角：前者看 RunItem -> Step 调用树，后者看样本级数据流和参数来源。报告中心前端围绕 Task 展示评测结论、摘要、指标、诊断、Badcase、导出和修复入口。

实现程度：评测结果解释和问题追踪已经可演示；真实成本账单、复杂趋势分析、长周期报表仓库和企业审批流集成仍待增强。

### 7. 修复任务与候选资产：高级治理已具备最小闭环

当前已有 Repair Task 工作台，可以从诊断 root cause 生成修复任务，并支持领取、指派、完成、重开、逾期提醒、修复树、动作历史和后续动作。

修复动作覆盖 Annotation Queue、CI Gate 复测、复跑对比、上下文修复建议、二级修复任务、Dataset 字段修复计划、Workflow 参数 diff/回滚计划、Prompt/Skill 版本对比、候选资产沉淀和从候选生成 Workflow 草稿。

候选资产中心支持候选列表、复跑优先级、批量指派、负责人容量、逾期升级、批量审批、终态归档、复跑对比、晋升建议、Workflow 晋升审批、baseline 替换、影响分析、回滚门禁和 baseline 变更提醒。

实现程度：治理闭环设计完整度高，已可用于产品演示；真实组织审批、通知分派、容量策略配置化和外部系统联动仍是后续工作。

### 8. Experiment、CI Gate、Annotation、Judge：产品化扩展已落地基础版本

当前已经有以下扩展能力：

- Experiment：从 Run 生成实验快照，支持 baseline 对比。
- CI Gate：创建质量门禁，对 Task/Run 进行阻断评估并保留历史。
- Annotation Queue：从 Run 播种样本，支持领取、分派、审核、批量审核和回流 Golden。
- Candidate Assets：承接 Prompt/Skill 候选治理。
- Judge Audit：管理 Judge Profile，计算 Accuracy、Precision、Recall、F1、Kappa、混淆矩阵、偏差趋势和多 Judge 一致性。
- Assertion DSL：提供 contains、regex、json_schema、similarity、latency、cost、safety 等基础断言。

实现程度：这些能力已从“概念”进入可调用 API 和可见页面，但大多仍是最小产品闭环，距离企业环境中的权限、审批、通知、数据权限和自动化发布流水线还有差距。

### 9. 前端工作台：主页面已覆盖产品全链路

前端使用 React、Vite、TypeScript、Ant Design、TanStack Query、React Flow 和 ECharts。`frontend/src/App.tsx` 目前按懒加载组织 16 个主页面：

- 概览
- 数据集
- Skill 市场
- Workflow 市场
- Workflow 画布
- 执行中心
- Trace Flow
- Trace Tree
- 报告中心
- 修复任务
- 实验中心
- CI Gate
- Annotation Queue
- 候选资产
- Judge 审计
- 治理与审计

实现程度：页面覆盖面完整，主链路和大量按钮已有真实 API 反馈；部分页面逻辑较重，后续需要继续拆组件、抽领域状态模型、强化真实浏览器回归和异常态体验。

## 内部架构现状

当前后端仍有明显的 MVP 演进痕迹：`aegisqa/api/app.py` 保留了大量请求模型和通用 helper，同时具体领域路由已拆到 `aegisqa/api/routes/*`。这说明项目已经开始从单文件 API 走向模块化，但历史兼容和产品化扩展逻辑仍使 API 层偏厚。

核心分层大致如下：

```text
FastAPI routes
  -> RouteContext 注入 store / registry / services
  -> DatasetService / WorkflowService / WorkflowGraphService / WorkflowRunner
  -> JsonStore 或 SQLiteStore
  -> 本地文件 rows / reports / plugin packages
```

当前架构优点：

- 业务对象边界比较清晰：Dataset、Skill、Workflow、Task、Run、Report、Badcase、Judge、Candidate。
- 核心流程有可测试服务层，不完全绑死在前端交互。
- JsonStore 默认模式轻量，SQLiteStore 已提供更稳定的单机持久化选择。
- API 错误响应已经统一为 `code/message/details/trace_id`，便于前端展示结构化修复建议。

当前架构风险：

- API 层 helper 和产品化逻辑较多，长期需要继续拆服务。
- 默认 JsonStore 不具备事务、索引、高并发和分布式一致性。
- SQLite 适合单机长期试用，不等于生产数据库方案。
- Celery、Redis、MySQL 目前主要是参考资产和演进方向，不是默认主链路。
- 插件执行隔离是子进程级，尚未达到强沙箱等级。

## 验证与质量现状

仓库内已有较完整的验证资产：

- 后端 Pytest 覆盖平台核心、API、任务中心、Workflow、报告、风险分析、SQLite、插件包安全、分页和产品化增强。
- 前端 Vitest 覆盖 API client、页面交互、Workflow 画布、任务创建向导、报告中心、修复任务和候选资产。
- Playwright E2E 覆盖上传数据、上传并审批 Skill、发布 Workflow、创建并执行 Task、查看报告、纠错 Badcase、Trace Flow、CI Gate、Annotation Queue 和 Workflow 画布操作。
- 文档中记录最近全量后端测试、前端 typecheck、前端测试、前端 build 和 E2E 曾通过。

本次生成报告没有重新运行全量测试，只做了静态代码与文档盘点。文档变更后建议至少执行：

```powershell
git diff --check
python -m pytest -q
cd frontend
npm run typecheck
npm test
```

## 当前最可演示的端到端链路

1. 上传 CSV/JSONL 数据集。
2. 上传 Skill 插件包，运行合约测试，在治理页审批启用。
3. 在 Workflow 市场创建草稿，进入画布拖拽 Skill、配置字段映射和参数。
4. 选择数据集做参数预览、校验和试运行。
5. 发布 Workflow。
6. 在执行中心选择 Dataset + Workflow 创建 Task，运行 Preflight。
7. 执行 Task，查看任务详情、Trace、报告、Badcase。
8. 从报告生成修复任务、进入 Annotation Queue、CI Gate 或候选资产治理。

这条链路已经基本覆盖 AI 评测平台最核心的“数据 -> 流程 -> 执行 -> 报告 -> 修复 -> 沉淀”闭环。

## 主要未完成项

按优先级看，后续最关键的是：

1. 生产级执行：接入真实异步 Worker、队列、任务级超时、重试策略、并发控制、运行时资源隔离。
2. 生产级存储：把 Task、Run、Report、Audit、Workflow、Skill Package 等核心实体迁移到事务型数据库和对象存储。
3. 插件安全：补依赖隔离、CPU/内存/网络限制、包大小限制、签名校验、恶意包扫描和审计。
4. 企业权限：补真实登录、角色、团队、租户、资源级权限和审批流。
5. 前端拆分：继续拆 WorkflowDesigner、Reports、RepairTasks、CandidateAssets 等重页面，降低维护成本。
6. 真实成本与质量治理：接入模型调用账单、token 统计、长期趋势仓库、发布流水线和外部通知。
7. 部署工程：补 CI/CD、环境配置、迁移脚本、容器镜像、健康检查、监控和回滚策略。

## 结论

AegisQA 当前已经完成从 Demo 到工程化 MVP 的关键跃迁。它的核心能力不是单点页面展示，而是已经把 AI 评测任务按平台对象串成闭环：Dataset、Skill、Workflow、Task、Run、Report、Trace、Badcase、Repair Task、CI Gate、Annotation 和候选资产之间都有可追踪关系。

当前最强的部分是产品流程完整度、评测治理设计和测试资产；最需要补强的是生产级运行时、强隔离、安全合规、企业权限和持久化基础设施。
