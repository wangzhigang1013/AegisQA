# AegisQA 项目状态

## 当前阶段

新一轮“评测数据流与产品体验升级”正在执行中。阶段 1（Skill 参数解析与冻结）和阶段 2（Trace 数据流模型与独立页面）已完成：后端已提供 Task Trace Flow API，前端已新增独立 Trace Flow 页面，并在任务详情、报告页和 Playwright 主链路中接入；下一步进入阶段 3：UI 信息架构与任务驾驶舱优化。

## 当前已完成

- 后端 MVP 与 PRD 主链路已实现。
- Skill 注册、Dataset、Workflow、DAG、Run、Report、Badcase、Judge 审计、RBAC、审计日志、生产适配资产已具备基础能力。
- Streamlit 工作台可访问，但 UI 粗糙、使用路径不清晰，不作为产品化主前端继续扩展。
- 已新增项目状态同步规则：每次执行代码、文档、配置、测试、脚手架、UI 等改动后，都必须同步更新本文件。
- React 主前端已从静态样板推进到任务中心化交互闭环：数据集上传弹窗、Source Skill 物化、Skill 插件包上传、Workflow 市场、Workflow 画布、任务列表、任务控制、任务报告、Badcase 纠错、Judge 审计、治理动作均已有明确 API 或禁用/失败反馈。
- Skill 市场已支持 zip 插件包上传，后端校验 `skill.yaml|skill.json` 与 `handler.py`，上传后进入 `pending_review`，合约测试通过后才能审批启用。
- Skill 插件包受控子进程默认超时已从 1 秒调整为 5 秒，避免 Windows + Playwright 并发下把正常插件冷启动误判为超时，同时保留超时保护测试。
- 新增 Task 一等模型，Task 绑定 Dataset Version、Workflow Version 和底层 Run，执行中心与报告中心都围绕任务组织。
- 已建立 `docs/INTERACTION_ACCEPTANCE_MATRIX.md`，逐页记录可见按钮的可用状态、依赖 API 和验收方式。
- 已新增正式 Playwright E2E，自动覆盖“上传数据 -> 上传并审批 Skill -> 创建 Workflow -> 发布 -> 创建 Task -> 执行 -> 查看任务报告 -> 纠错 Badcase”主链路。
- 已新增全量优化执行计划 `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`，阶段顺序为 P0 稳定性、Workflow 画布、Task、Report/Badcase、Skill 安全、Experiment/CI/Annotation、工程结构。
- 已完成 P0 稳定性第一批：数据集上传空文件/坏 JSONL/空 CSV 拒绝；Skill zip 非法路径拒绝；插件合约测试超时返回结构化 code；Task completed/running/canceled 状态禁止非法动作；前端任务动作按钮按状态禁用；API client 保留后端 code/details/trace_id。
- Workflow 画布图模型已从页面抽离为 `frontend/src/pages/workflowDesigner/graphModel.ts`，新增独立单元测试；Playwright 已新增画布 E2E，覆盖进入画布、新增 Join、删除选中、校验、发布。
- Workflow 画布已新增撤销/重做历史栈，节点新增、删除、自动布局、Inspector 编辑、连线会进入历史；组件测试和 Playwright 已覆盖新增 Join 后撤销/重做。
- Workflow Inspector 已支持查看选中节点的下游连线，并可单条删除连线；组件测试和 Playwright 已覆盖 `answer -> judge_a` 删除路径。
- Workflow Inspector 已支持“可连接目标”，可以选择未连接的下游节点并创建连线；创建/删除连线都会进入撤销历史并在 Console 给反馈。
- Workflow Inspector 已支持节点工具栏，提供删除当前节点和自动布局；画布支持 Delete/Backspace 快捷删除选中的节点或连线，输入框编辑时不会误删。
- Workflow Palette 的 Source、Skill、Join、Output 新增路径已进入 Playwright 自动化，避免后续回归成“按钮能看不能用”。
- Workflow 发布前校验已用后端测试锁定：未审批或禁用 Skill 不能发布，多对一输入必须使用 Join/Aggregator，Branch 必须配置条件表达式。
- Workflow 发布失败时，前端会把后端 `details.errors` 回填到 Console 的“错误与建议”页签，用户能看到错误码、节点和修复方向。
- Workflow Inspector 已支持 Aggregator 聚合策略配置，当前覆盖多数投票、均值和一致性三类策略。
- Workflow 草稿保存后可从 Workflow 市场重新打开并保留流程名称、节点名称等配置；试运行会使用当前选择的数据集并回填 step trace 与队列消息提示。
- 执行中心已抽出 `TaskCreateWizard`，创建任务前必须选择 Dataset Version 和 Workflow Version；任务参数支持分片大小、并发、repeat、最大重试、重试退避和成本预算。
- 后端 Task 创建已保存 `execution_config`，报告和后续 Run Attempt 可以追溯任务创建时的执行参数。
- 后端 Task 已支持 `POST /tasks/{task_id}/attempts`，只有当前任务没有活动执行实例时才能创建新 Attempt；旧 Run 报告会保存在 `attempts` 快照里。
- 前端任务详情已展示 Run Attempts、当前 Attempt、执行参数和 Trace Tree，并提供“新建 Attempt”动作。
- Task Report API 已返回 `task_summary`、`version_snapshot`、`step_distribution`、`judge_score_distribution`、RunReport、Badcase 和导出链接。
- 报告中心已拆出 `ReportSummary` 与 `BadcaseTable`，任务报告页面围绕版本快照、核心指标、Step 分布、Badcase 纠错和导出组织。
- 报告中心 Badcase 表格已支持单条加入 Golden、忽略、重开、加入 Annotation Queue，以及选择多条后批量加入 Golden；动作成功后刷新 Task Report。
- Skill 插件包记录已保存合约测试时间、审批人、审批时间和审批备注；Skill 市场展示审批状态，治理页提供审批抽屉，未通过合约测试的插件不能在前端直接启用。
- 前端 `AppShell` 的 TanStack QueryClient 已改为实例内创建，避免测试和嵌入式渲染场景复用旧缓存导致页面数据串扰。
- Skill 插件受控子进程已增加 stdout 输出体积上限、stdout/stderr 截断标记和本地绝对路径脱敏，避免恶意或异常插件把大响应、本地路径泄露到 API 与前端。
- 新增 Experiment 实验中心页面，主导航可进入，页面围绕 Run 不可变快照展示 baseline 对比、指标变化、失败样本变化、成本变化，并支持从已完成 Run 生成实验快照。
- 新增 CI Gate 质量门禁页面，主导航可进入，页面围绕发布门槛展示门禁配置列表、创建弹窗、Task/Run 评估控制台和阻断原因；后端新增 `GET/POST /ci-gates`，`POST /ci-gates/evaluate` 支持直接按 Task/Run 抽取指标。
- 新增 Annotation Queue 人工审核页面，主导航可进入，页面围绕审核队列展示状态/负责人/来源任务筛选、领取、分派、审核和回流 Golden；后端队列记录已回填 `source_task_id` 与 `source_task_name`，支持按来源任务筛选。
- FastAPI API 路由已按业务域拆分到 `aegisqa/api/routes/`，`aegisqa/api/app.py` 保留应用装配、错误处理、共享模型和辅助函数，降低后续维护成本。
- JSON Store 已增加 `FileLock`、JSON 原子写入和 JSONL 读写锁保护，并新增并发写入测试；README 已说明该存储仅适合本地 demo，不承担生产数据库职责。
- Skill 参数处理已从各节点散落配置升级为统一解析：`schema_default < workflow_config < task_override < runtime_expression < secret_ref`，Run Step 会保存脱敏后的 `config_snapshot` 和字段级 `parameter_trace`。
- Trace Flow 已从 Trace Tree 中独立出来，支持按 Task 查看 Dataset Row、Skill Input、参数来源、Output、Metrics、Badcase 和队列消息形状，帮助解释评测过程中的数据流转。

## 最近验证

- `python -m pytest -q`：48 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
- `python -m aegisqa.examples.run_mvp_demo`：1000 条样本端到端完成，最新 Dataset `rag_qa_1000:v7`，Run `run-5a86aceede3f` completed，队列消息仅 `item_id`，`pass_rate=0.8`，`error_rate=0.0`，Badcase 200 条，Judge 审计 Accuracy/Precision/Recall/F1/Kappa 均为 1.0。
- `cd frontend && npm run typecheck`：通过。
- `cd frontend && npm test`：4 个测试文件、31 个测试通过。
- `cd frontend && npm run build`：通过。
- `cd frontend && npm run e2e`：8 个 Playwright E2E 测试通过，覆盖任务主链路、任务报告进入 Trace Flow、参数来源查看、CI Gate 创建与阻断评估、Annotation Queue 领取/审核/回流 Golden，以及 Workflow 画布 Source/Skill/Join/Output/Aggregator 新增、聚合策略、创建连线、删除下游连线、节点工具栏、键盘删除、删除节点、保存草稿回放、试运行回填、校验、发布。
- `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`：5 个 Playwright E2E 测试通过，覆盖 Workflow 画布新增节点、聚合策略、删除下游连线、新增 Join、撤销/重做、删除节点、保存草稿回放、试运行回填、校验、发布。
- `http://127.0.0.1:8000/health`：FastAPI 页面健康检查通过。
- `http://127.0.0.1:5173`：React 前端可访问。
- 无头 Chrome 页面验证：`/`、`/skills`、`/workflows`、`/workflows/designer/draft-test`、`/runs`、`/reports` 均能打开并展示关键入口。
- Headless Chrome CDP 交互验证：概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均返回明确结果。
- Headless Chrome CDP 产品化概览验证：首页包含真实 Dashboard 指标和 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 入口。

## 当前问题

- Workflow 画布的 Source/Skill/Join/Output/Aggregator 新增、创建连线、删除节点、删除下游连线、节点工具栏、键盘删除、撤销/重做、保存草稿回放、试运行、校验和发布已进入 Playwright；后续需要继续拆分 Palette/Inspector 组件，降低单文件维护成本。
- Task 已成为前端主线，完整端到端 UI 流程已由 Playwright 覆盖；阶段 3.2 已补 Run Attempt，后续需要继续接入 CI Gate、baseline 对比和权限检查。
- Skill 插件包已采用受控子进程执行，默认 5 秒超时已覆盖并发 E2E；后续还需补资源限额、依赖隔离、签名校验和更完整的审批页。
- Experiment 快照、CI Gate 和 Annotation Queue 已有独立产品页；Trace Tree 仍需做成完整独立页面，并继续补成本预算、baseline 可视化对比、质量门禁历史记录和审核任务批量操作。
- 报告、Badcase、Judge 审计已经接入基础数据与动作，人工审阅队列已有后端最小闭环；仍需补齐多 Judge 一致性视图、红队安全扫描和跨任务 Score Analytics。
- 本地服务曾出现旧 FastAPI 进程未重启导致新增路由 404 的问题；已重启后端并完成浏览器复测。后续修改后端 API 时必须确认 8000 端口加载的是最新代码。

## 下一阶段目标

- 后续建议优先进入 Trace Tree 独立页面、CI Gate 历史记录、Annotation Queue 批量审核、多 Judge 一致性视图、红队安全扫描和真实 MySQL/Redis/Celery Repository/Worker 接入。

## 最近改动

### 2026-05-31 Trace Flow 数据流独立页面

- 改动摘要：完成评测数据流升级计划阶段 2。新增 Task Trace Flow API，把 Task、Dataset、Workflow、Attempt、队列消息形状、样本 row、Skill 输入、解析后参数、参数来源、输出、指标和 Badcase 状态整理成可解释的数据流；前端新增 `/tasks/:task_id/trace` 独立页面，并从任务详情和报告页提供入口；Playwright 主链路已覆盖“报告 -> Trace Flow -> 查看参数来源”。
- 变更文件：
  - `aegisqa/reports/trace_flow.py`
  - `aegisqa/api/routes/tasks.py`
  - `tests/test_trace_flow_api.py`
  - `frontend/src/pages/TraceFlowPage.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/task-flow.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-evaluation-flow-productization.md`
- 验证命令：
  - `python -m pytest tests/test_trace_flow_api.py -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "Trace Flow"`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run e2e -- e2e/task-flow.spec.ts`
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Trace Flow 后端定向测试：1 passed。
  - Trace Flow 前端定向测试：1 passed。
  - Typecheck：通过。
  - Task Flow Playwright 定向测试：1 passed。
  - 后端全量：48 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端全量：4 个测试文件、31 passed。
  - Build：通过。
  - Playwright 全量 E2E：8 passed。
- 下一步：进入阶段 3，优化首页工作台与任务详情驾驶舱，让任务详情承载样本、Trace、Badcase、Attempts 和参数快照。

### 2026-05-31 Skill 参数解析与冻结

- 改动摘要：完成评测数据流升级计划阶段 1。新增 `SkillParameterResolver`，支持 schema default、Workflow 节点配置、Task skill_overrides、运行时表达式和 Secret 引用的统一解析；Runner 调用 Skill 前解析最终参数，并在 Step Trace 中保存脱敏 `config_snapshot` 与 `parameter_trace`；新增 `POST /workflow-graphs/parameter-preview`，前端 API client 和类型已接入；同时修复脱敏正则误把 `task-model` 中的 `sk-` 当成密钥的问题。
- 变更文件：
  - `aegisqa/skills/parameters.py`
  - `aegisqa/engine/runner.py`
  - `aegisqa/core/security.py`
  - `aegisqa/api/app.py`
  - `aegisqa/api/routes/tasks.py`
  - `aegisqa/api/routes/workflows.py`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `tests/test_skill_parameter_resolution.py`
  - `docs/PROJECT_STATUS.md`
  - `docs/superpowers/plans/2026-05-31-evaluation-flow-productization.md`
- 验证命令：
  - `python -m pytest tests/test_skill_parameter_resolution.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Skill 参数定向测试：3 passed。
  - 后端全量：47 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、30 passed。
  - Build：通过。
  - Playwright 全量 E2E：8 passed。
- 下一步：进入阶段 2，构建 Task Trace Flow API 和独立 Trace 页面。

### 2026-05-31 评测数据流与产品体验升级计划

- 改动摘要：新增下一轮全面优化计划，覆盖 UI 信息架构、评测数据流转、Skill 参数解析与冻结、Trace 独立页面、任务驾驶舱、Workflow 字段映射、报告分层分析、Annotation/Golden 闭环、CI Gate 历史和需要移除/降级的功能。
- 变更文件：
  - `docs/superpowers/plans/2026-05-31-evaluation-flow-productization.md`
  - `docs/PROJECT_STATUS.md`
- 验证命令：
  - 文档计划批次未运行测试；下一批进入代码实现时按计划执行后端、前端和 E2E 验证。
- 测试结果：
  - 未运行测试。
- 下一步：执行阶段 1，新增 `SkillParameterResolver`，让 Skill 参数来源、覆盖优先级、表达式、Secret 脱敏和 Task 参数冻结可追踪。

### 2026-05-31 最终验收

- 改动摘要：完成产品严谨化全方位优化计划的最终验收。重新执行后端、1000 样本 Demo、前端类型检查、单元测试、生产构建和 Playwright E2E；同步更新 PRD 验收矩阵、交互验收矩阵和计划最终清单。
- 变更文件：
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest -q`
  - `python -m aegisqa.examples.run_mvp_demo`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - 后端全量：44 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 1000 样本 Demo：Dataset `rag_qa_1000:v7`，Run `run-5a86aceede3f` completed，队列消息字段仅 `item_id`，`pass_rate=0.8`，`error_rate=0.0`，Badcase 200 条。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、30 passed。
  - Build：通过。
  - Playwright 全量 E2E：8 passed。
- 下一步：进入下一轮产品增强规划，优先补 Trace Tree 独立视图、CI Gate 历史、批量人工审核、多 Judge 一致性和真实生产 Repository/Worker。

### 2026-05-31 JSON Store 文件锁与生产化边界

- 改动摘要：完成阶段 7 Task 7.2。新增跨平台 `FileLock`，通过进程内线程锁和独占 `.lock` 文件串行化本地文件访问；`JsonStore` 的 JSON 写入改为临时文件 + `os.replace` 原子替换，JSON/JSONL 读写都进入文件锁保护；README 增加本地 demo 存储与生产 MySQL/PostgreSQL、Redis/Celery、对象存储的边界说明。
- 变更文件：
  - `aegisqa/storage/file_lock.py`
  - `aegisqa/storage/json_store.py`
  - `tests/test_json_store_locking.py`
  - `README.md`
  - `docs/PROJECT_STATUS.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests/test_json_store_locking.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - 文件锁定向测试：2 passed。
  - 后端全量：44 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、30 passed。
  - Build：通过。
  - Playwright 全量 E2E：8 passed。
- 下一步：进入最终验收，重新执行后端、1000 样本 Demo、前端构建与 E2E，并更新验收矩阵。

### 2026-05-31 API 路由拆分

- 改动摘要：完成阶段 7 Task 7.1。将 `aegisqa/api/app.py` 中的内联业务路由拆分为独立 domain route 模块，新增共享 `RouteContext`，`create_app()` 继续作为唯一对外应用工厂并按域注册路由；拆分过程中修正了治理概览、权限检查和 Judge 审计路由对现有服务 API 的调用方式，保持前端契约不变。
- 变更文件：
  - `aegisqa/api/app.py`
  - `aegisqa/api/routes/__init__.py`
  - `aegisqa/api/routes/context.py`
  - `aegisqa/api/routes/datasets.py`
  - `aegisqa/api/routes/governance.py`
  - `aegisqa/api/routes/judge.py`
  - `aegisqa/api/routes/productization.py`
  - `aegisqa/api/routes/reports.py`
  - `aegisqa/api/routes/skills.py`
  - `aegisqa/api/routes/tasks.py`
  - `aegisqa/api/routes/workflows.py`
  - `docs/PROJECT_STATUS.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests/test_productization_api.py tests/test_task_center_api.py -q`
  - `python -m pytest tests/test_api.py::test_api_runs_full_mvp_flow tests/test_api_interaction_contract.py::test_frontend_list_and_summary_api_contract tests/test_api_interaction_contract.py::test_badcase_judge_and_export_actions -q`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Productization + Task Center 定向测试：7 passed。
  - 拆分回归定向测试：3 passed。
  - 后端全量：42 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、30 passed。
  - Build：通过。
  - Playwright 全量 E2E：8 passed。
- 下一步：进入阶段 7 Task 7.2，新增 JSON Store 并发写入保护和生产化边界说明。

### 2026-05-31 Annotation Queue 人工审核页面

- 改动摘要：完成阶段 6 Task 6.3。后端 Annotation Queue 记录新增来源任务字段，并支持按 `source_task_id` 筛选；前端新增 `/annotation-queue` 页面和主导航入口，支持状态、负责人、来源任务筛选，支持领取、分派、审核和回流 Golden Dataset。
- 变更文件：
  - `aegisqa/api/app.py`
  - `tests/test_productization_api.py`
  - `frontend/src/App.tsx`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `frontend/src/pages/AnnotationQueuePage.tsx`
  - `frontend/src/pages/OverviewPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/productization.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests/test_productization_api.py -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "Annotation Queue"`
  - `cd frontend && npm run e2e -- e2e/productization.spec.ts`
  - `cd frontend && npm run typecheck`
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Productization API 定向测试：5 passed。
  - Annotation Queue 前端定向测试：1 passed。
  - Productization Playwright 定向测试：2 passed。
  - 后端全量：42 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、30 passed。
  - Build：通过。
  - Playwright 全量 E2E：8 passed。
- 下一步：进入阶段 7 Task 7.1，拆分 API 路由并保持外部行为不变。

### 2026-05-31 CI Gate 质量门禁页面

- 改动摘要：完成阶段 6 Task 6.2。后端新增质量门禁配置保存/列表接口，`POST /ci-gates/evaluate` 支持使用配置并直接按 Task 或 Run 抽取指标；前端新增 `/ci-gates` 页面和主导航入口，支持创建门禁配置、选择 Task/Run 执行评估，并在阻断时展示失败规则、实际值、阈值和阻断/预警状态。
- 变更文件：
  - `aegisqa/api/app.py`
  - `tests/test_productization_api.py`
  - `frontend/src/App.tsx`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `frontend/src/pages/CIGatesPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/productization.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests/test_productization_api.py -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "CI Gate"`
  - `cd frontend && npm run e2e -- e2e/productization.spec.ts`
  - `cd frontend && npm run typecheck`
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Productization API 定向测试：4 passed。
  - CI Gate 前端定向测试：1 passed。
  - Productization Playwright 定向测试：1 passed。
  - 后端全量：41 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、29 passed。
  - Build：通过。
  - Playwright 全量 E2E：7 passed。
- 下一步：进入阶段 6 Task 6.3，建设 Annotation Queue 页面和人工审核回流体验。

### 2026-05-31 Experiment 实验中心

- 改动摘要：完成阶段 6 Task 6.1。新增 `/experiments` 页面和主导航入口，展示实验快照列表、baseline 对比、通过率变化、失败样本变化、成本变化，并提供“从 Run 生成实验快照”的弹窗入口。
- 变更文件：
  - `frontend/src/App.tsx`
  - `frontend/src/pages/ExperimentsPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/test/App.test.tsx -t "Experiment 页面"`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Experiment 页面定向测试：1 passed。
  - 后端全量：40 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、28 passed。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 6 Task 6.2，建设 CI Gate 页面和质量门禁评估体验。

### 2026-05-31 Skill 安全执行边界

- 改动摘要：完成阶段 5 Task 5.2。`SubprocessPackageSkill` 对插件 stdout 增加 64KB 输出上限，超限返回 `SKILL_PACKAGE_OUTPUT_TOO_LARGE`；运行时错误会清洗本地绝对路径，并在 stdout/stderr 超长时返回截断内容和 `stdout_truncated`、`stderr_truncated` 标记。
- 变更文件：
  - `aegisqa/skills/packages.py`
  - `tests/test_skill_package_security.py`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests/test_skill_package_security.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Skill 安全边界定向测试：4 passed。
  - 后端全量：40 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Typecheck：通过。
  - 前端全量：4 个测试文件、27 passed。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 6 Task 6.1，建设 Experiment 页面和 baseline 对比体验。

### 2026-05-31 Skill 审批体验

- 改动摘要：完成阶段 5 Task 5.1。后端插件包记录新增合约测试时间、审批人、审批时间和审批备注；Skill 市场展示待审批、合约测试状态、审批人和审批时间；治理页新增 `SkillApprovalDrawer`，展示 Manifest、输入/输出 Schema、测试日志，并在插件未通过合约测试时禁用审批启用。同步修复前端测试中的 QueryClient 缓存串扰，让每次 `AppShell` 渲染都有独立查询缓存。
- 变更文件：
  - `aegisqa/api/app.py`
  - `tests/test_skill_package_security.py`
  - `frontend/src/App.tsx`
  - `frontend/src/pages/SkillsPage.tsx`
  - `frontend/src/pages/GovernancePage.tsx`
  - `frontend/src/pages/skills/SkillApprovalDrawer.tsx`
  - `frontend/src/types.ts`
  - `frontend/src/test/App.test.tsx`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests/test_skill_package_security.py -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "Skill 市场展示插件包审批状态|治理页审批抽屉"`
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Skill 审批后端测试：1 passed。
  - Skill 审批前端定向测试：2 passed。
  - 后端全量：37 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端全量：4 个测试文件、27 passed。
  - Typecheck：通过。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 5 Task 5.2，补 Skill 安全执行边界与脱敏策略。

### 2026-05-31 Badcase 状态流转与批量动作

- 改动摘要：完成阶段 4 Task 4.2。`BadcaseTable` 增加行选择、单条加入 Golden、忽略、重开、加入 Annotation Queue，以及批量加入 Golden；报告页统一通过 mutation 执行动作，成功后刷新 Task Report 并给出中文反馈。现有后端 Badcase API 已覆盖 correct/reopen/bulk/annotation 队列入口，本批重点补齐前端工作流。
- 变更文件：
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/pages/report/BadcaseTable.tsx`
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/e2e/task-flow.spec.ts`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `frontend/src/test/App.test.tsx`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心"`
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - 报告中心 Badcase 动作测试：1 passed。
  - 后端全量：36 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端全量：4 个测试文件、25 passed。
  - Typecheck：通过。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 5 Task 5.1，完善 Skill 审批体验和治理审批抽屉。

### 2026-05-31 Task Report 结构化

- 改动摘要：完成阶段 4 Task 4.1。`GET /tasks/{task_id}/report` 新增任务摘要、Dataset/Workflow 版本快照、执行参数、Step 分布、Judge 分数分布；导出 HTML/CSV/JSON 增加内容断言；前端报告页拆出 `ReportSummary` 和 `BadcaseTable`，展示任务上下文、版本快照、指标、Step 分布和 Badcase 纠错入口。
- 变更文件：
  - `aegisqa/api/app.py`
  - `tests/test_task_center_api.py`
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/pages/report/ReportSummary.tsx`
  - `frontend/src/pages/report/BadcaseTable.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/src/types.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests\test_task_center_api.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心"`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Task Center API：2 passed。
  - 后端全量：36 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 报告中心前端测试：1 passed。
  - 前端全量：4 个测试文件、25 passed。
  - Typecheck：通过。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 4 Task 4.2，补 Badcase 状态流转和批量处理交互。

### 2026-05-31 Task Run Attempt 历史执行记录

- 改动摘要：完成阶段 3 Task 3.2。后端新增 `POST /tasks/{task_id}/attempts`，为已完成/失败/取消等非活动任务创建新的 Run Attempt，旧 Run 的报告快照保留在 `attempts` 中，避免重新执行覆盖历史报告；任务详情展示当前 Attempt、历史 Run Attempts、执行参数和 Trace Tree，并新增“新建 Attempt”动作。
- 变更文件：
  - `aegisqa/api/app.py`
  - `tests/test_task_center_api.py`
  - `frontend/src/api/client.ts`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/src/types.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests\test_task_center_api.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "Run Attempts"`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Task Center API：2 passed。
  - 后端全量：36 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Run Attempts 前端测试：1 passed。
  - 前端全量：4 个测试文件、25 passed。
  - Typecheck：通过。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 4 Task 4.1，重构任务报告详情结构并补报告导出内容校验。

### 2026-05-31 Task 创建向导与执行参数快照

- 改动摘要：完成阶段 3 Task 3.1。新增独立 `TaskCreateWizard`，创建按钮在未选择 Dataset Version 或 Workflow Version 时保持禁用；表单补齐分片大小、并发、repeat、最大重试、重试退避、成本预算；后端 `POST /tasks` 接收并保存 `execution_config`，任务详情可展示执行参数，后续 Run Attempt 和 CI Gate 可以复用这份快照。
- 变更文件：
  - `aegisqa/api/app.py`
  - `tests/test_task_center_api.py`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/pages/task/TaskCreateWizard.tsx`
  - `frontend/src/pages/task/TaskCreateWizard.test.tsx`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests\test_task_center_api.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm test -- src/pages/task/TaskCreateWizard.test.tsx`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Task Center API：2 passed。
  - 后端全量：36 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - TaskCreateWizard 单测：2 passed。
  - 前端全量：4 个测试文件、24 passed。
  - Typecheck：通过。
  - Build：通过。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 3 Task 3.2，增加 Run Attempt/历史执行记录，避免重新执行覆盖旧报告。

### 2026-05-31 Workflow 发布前校验与保存/试运行回放

- 改动摘要：完成阶段 2 Task 2.3。新增后端发布阻断测试，覆盖禁用或未审批 Skill、多对一缺少 Join/Aggregator、Branch 缺少条件表达式；前端发布失败时把后端结构化 `details.errors` 回填到 Console；Inspector 新增 Aggregator 聚合策略配置；Playwright 覆盖草稿保存后从市场重新打开仍保留配置，以及选择数据集后试运行回填结果。全量 E2E 暴露出插件子进程 1 秒超时在 Windows 并发测试下会误杀正常插件，本批同步把默认超时调整为 5 秒，并保留超时失败测试。
- 变更文件：
  - `tests/test_workflow_graph_hardening.py`
  - `aegisqa/skills/packages.py`
  - `tests/test_p0_hardening.py`
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `python -m pytest tests\test_workflow_graph_hardening.py -q`
  - `python -m pytest tests\test_p0_hardening.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "发布失败"`
  - `cd frontend && npm test -- src/test/App.test.tsx -t "聚合策略"`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Workflow Graph 发布阻断后端测试：3 passed。
  - P0 插件超时与上传安全测试：3 passed。
  - 后端全量：36 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 发布失败和聚合策略组件测试分别通过；前端全量：3 个测试文件、22 passed。
  - Typecheck：通过。
  - Build：通过。
  - Workflow 画布 E2E：5 passed。
  - Playwright 全量 E2E：6 passed。
- 下一步：进入阶段 3 Task 3.1，抽出任务创建向导，强制选择 Dataset Version 和 Workflow Version，并加入并发、重试、repeat、成本预算参数。

### 2026-05-31 Workflow 节点工具栏与键盘删除

- 改动摘要：为 Workflow Inspector 增加节点工具栏，支持删除当前节点和自动布局；新增全局 Delete/Backspace 快捷删除，且在输入框、文本域和可编辑内容中不触发删除，避免用户编辑字段映射时误删节点。组件测试和 Playwright E2E 均覆盖工具栏删除、撤销后键盘删除。
- 变更文件：
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/test/App.test.tsx -t "节点工具栏"`
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - 节点工具栏组件测试：1 passed。
  - 前端全量：3 个测试文件、20 passed。
  - Workflow 画布 E2E：3 passed。
  - Playwright 全量 E2E：4 passed。
  - Typecheck：通过。
  - Build：通过。
- 下一步：进入阶段 2 Task 2.3，补未审批 Skill 发布阻断、多对一缺 Join/Aggregator 阻断、Branch 条件阻断、保存草稿回放和试运行结果回填。

### 2026-05-31 Workflow Inspector 创建连线入口

- 改动摘要：为 Workflow Inspector 增加“可连接目标”区域，选中节点后展示尚未连接的下游候选节点，点击即可创建依赖连线；创建与删除连线都复用当前 nodes/edges 事实来源，进入撤销/重做历史，并在 Console 中展示明确结果。为避免 JSDOM 环境下复杂页面测试偶发 5 秒超时，将 Vitest 单测超时时间提升到 10 秒。
- 变更文件：
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `frontend/vitest.config.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/test/App.test.tsx`
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - App 交互测试：16 passed。
  - 前端全量：3 个测试文件、19 passed。
  - Workflow 画布 E2E：2 passed。
  - Playwright 全量 E2E：3 passed。
  - Typecheck：通过。
  - Build：通过。
- 下一步：继续阶段 2，补节点工具栏/键盘删除、保存草稿回放、试运行结果回填和更严格发布前校验。

### 2026-05-31 Workflow Palette 新增节点 E2E

- 改动摘要：为 Workflow 画布新增 Playwright 测试，覆盖从 Palette 点击新增 Source、Skill、Join、Output 四类核心节点。测试先暴露出按钮可访问名与真实渲染名称不一致的问题，随后按实际产品按钮名修正断言，保证 E2E 不再依赖 demo 文案。
- 变更文件：
  - `frontend/e2e/workflow-designer.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Workflow 画布 E2E：2 passed。
  - Playwright 全量 E2E：3 passed。
- 下一步：继续阶段 2，补创建连线的浏览器自动化、节点工具栏/键盘删除、保存草稿回放、试运行结果回填和更严格发布前校验。

### 2026-05-31 Workflow 画布连线删除入口

- 改动摘要：为 Workflow Inspector 增加“下游连线”管理区，选中节点后可以看到从该节点流出的所有边，并单条删除；删除会进入撤销/重做历史并在 Console 展示明确反馈。同步补充组件测试与 Playwright E2E，覆盖默认流程中 `answer -> judge_a` 的删除路径。
- 变更文件：
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/test/App.test.tsx`
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm run e2e`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
- 测试结果：
  - App 交互测试：15 passed。
  - 前端全量：3 个测试文件、18 passed。
  - Workflow 画布 E2E：1 passed。
  - Playwright 全量 E2E：2 passed。
  - Typecheck：通过。
  - Build：通过。
- 下一步：继续阶段 2，补创建连线的浏览器自动化、节点工具栏/键盘删除、保存草稿回放、试运行结果回填和更严格发布前校验。

### 2026-05-31 Workflow 画布图模型与 E2E 第一批

- 改动摘要：启动阶段 2。把 Workflow 画布 nodes/edges 到后端 `WorkflowGraph` 的转换逻辑抽成独立 `graphModel.ts`，补前端单元测试覆盖 payload 转换、缺 Skill、Branch 条件缺失、坏 JSON 配置；新增 Playwright Workflow 画布 E2E，覆盖进入画布、新增 Join、删除选中、校验、发布。
- 变更文件：
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/pages/workflowDesigner/graphModel.ts`
  - `frontend/src/pages/workflowDesigner/graphModel.test.ts`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/pages/workflowDesigner/graphModel.test.ts`
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run e2e`
- 测试结果：
  - 图模型单测：2 passed。
  - 前端全量：3 个测试文件、16 个测试通过；typecheck 通过。
  - Playwright：2 passed，包含任务主链路与 Workflow 画布路径。
- 下一步：继续阶段 2，补真实连线/删除边、撤销/重做、保存草稿回放、试运行结果回填与更严格 Inspector 字段映射。

### 2026-05-31 Workflow 画布撤销重做

- 改动摘要：为 Workflow 设计器增加撤销/重做历史栈，覆盖新增 Skill/结构节点、删除节点/边、Inspector 编辑、自动布局、连线等画布操作；画布工具栏新增“撤销”“重做”按钮，并在 Console 中展示操作反馈；Workflow 画布 E2E 追加撤销/重做路径。
- 变更文件：
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/e2e/workflow-designer.spec.ts`
  - `docs/PROJECT_STATUS.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
- 验证命令：
  - `cd frontend && npm test -- src/test/App.test.tsx`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`
  - `cd frontend && npm test`
- 测试结果：
  - App 交互测试：14 passed。
  - 前端全量：3 个测试文件、17 passed。
  - Workflow 画布 E2E：1 passed。
  - Typecheck：通过。
- 下一步：继续阶段 2，补真实连线/删除边的 E2E、保存草稿回放、试运行结果回填与更严格 Inspector 字段映射。

### 2026-05-31 P0 Bug 与稳定性修复完成

- 改动摘要：按全量计划完成阶段 1。新增统一业务异常 `AegisQAError`；数据集上传增加空文件、坏 JSONL 行号、空 CSV 校验；Skill 插件包增加非法路径 code、子进程 timeout 和输出截断；Task API 增加状态机保护，防止 completed/running/canceled 状态重复或非法动作；前端执行按钮根据状态禁用并展示原因；API client 解析结构化错误并保留 `code/details/trace_id`。
- 变更文件：
  - `aegisqa/core/errors.py`
  - `aegisqa/datasets/service.py`
  - `aegisqa/skills/base.py`
  - `aegisqa/skills/packages.py`
  - `aegisqa/api/app.py`
  - `tests/test_p0_hardening.py`
  - `tests/test_task_center_api.py`
  - `frontend/src/api/client.ts`
  - `frontend/src/pages/DatasetsPage.tsx`
  - `frontend/src/pages/SkillsPage.tsx`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/src/test/apiClient.test.ts`
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- 验证命令：
  - `python -m pytest tests\test_p0_hardening.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - P0 后端新增测试：3 passed。
  - 后端全量：33 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端：typecheck 通过；Vitest 2 个测试文件、14 个测试通过；生产构建通过。
  - Playwright：1 个 E2E 测试通过，主链路未被 P0 状态机和插件 timeout 破坏。
- 下一步：进入阶段 2，抽出 Workflow 图模型转换，补画布拖拽/连线/删除/保存/试运行/发布的精细 E2E。

### 2026-05-31 产品严谨化全量计划启动

- 改动摘要：根据用户要求，把下一阶段所有优化写入正式执行计划，并切换到 `feature/product-hardening-roadmap` 分支，后续按计划从 P0 Bug 与稳定性修复开始顺序执行。
- 变更文件：
  - `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`
  - `docs/PROJECT_STATUS.md`
- 验证命令：
  - `git switch -c feature/product-hardening-roadmap`
  - `Select-String -Path docs\superpowers\plans\2026-05-31-product-hardening-roadmap.md -Pattern 'TBD|TODO|later|fill in|适当|类似'`
- 测试结果：
  - 计划文档已创建，未发现占位符。
  - 本批次仅新增计划和状态同步，尚未修改业务代码。
- 下一步：提交计划文档，然后按计划执行阶段 1：P0 Bug 与稳定性修复。

### 2026-05-31 Playwright E2E 主链路完成

- 改动摘要：把当前目录转为 Git 仓库并建立基线提交；新增正式 Playwright E2E，覆盖上传数据、上传并审批 Skill、发布 Workflow、创建并执行任务、查看任务报告、导出报告、Badcase 加入 Golden；同时修复 E2E 暴露出的真实交互问题，包括上传文件归一化、插件 handler 子进程路径、Skill/Workflow/Governance 搜索、任务创建可搜索 Select、报告聚合 Badcase 持久化纠错、Vitest 排除 E2E 文件和 Playwright 依赖重复。
- 变更文件：
  - `.gitignore`
  - `aegisqa/skills/packages.py`
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/playwright.config.ts`
  - `frontend/e2e/task-flow.spec.ts`
  - `frontend/vitest.config.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/pages/DatasetsPage.tsx`
  - `frontend/src/pages/SkillsPage.tsx`
  - `frontend/src/pages/GovernancePage.tsx`
  - `frontend/src/pages/WorkflowMarketPage.tsx`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/pages/ReportsPage.tsx`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- 验证命令：
  - `git init`
  - `git commit -m "chore: 初始化 AegisQA 项目基线"`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`
- 测试结果：
  - Git：基线提交 `9770009 chore: 初始化 AegisQA 项目基线` 已创建。
  - 后端：30 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端：typecheck 通过；Vitest 1 个测试文件、12 个测试通过；生产构建通过。
  - Playwright：1 个 E2E 测试通过，主链路从数据上传跑到报告纠错。
- 下一步：提交本批次 E2E 改动，并继续把 Workflow 画布精确拖拽、连线、删除、保存草稿、试运行、发布纳入 Playwright 自动化。

### 2026-05-31 Git 初始化与 Playwright E2E 批次启动

- 改动摘要：按用户要求把当前目录初始化为 Git 仓库，并启动正式 Playwright E2E 批次，目标覆盖“上传数据 -> 上传并审批 Skill -> 创建 Workflow -> 发布 -> 创建 Task -> 执行 -> 查看任务报告 -> 纠错 Badcase”主链路。
- 变更文件：
  - `.git/`
  - `docs/PROJECT_STATUS.md`
- 验证命令：
  - `git init`
  - `git status --short`
- 测试结果：
  - Git 仓库已初始化，当前文件进入待提交状态。
- 下一步：建立当前项目基线提交，然后新增 Playwright 配置与端到端测试。

### 2026-05-31 任务中心化产品重构批次启动

- 改动摘要：根据最新产品反馈，启动“任务中心化”重构：Skill 市场支持插件包上传，Workflow 从画布首屏拆为市场 + 设计器，执行中心改为任务列表，报告中心改为围绕 Task 的任务报告。
- 变更文件：
  - `docs/PROJECT_STATUS.md`
- 验证命令：准备先新增失败测试，尚未执行。
- 测试结果：尚未执行。
- 下一步：按 TDD 新增后端 Skill 插件包与 Task API 测试，再实现后端和前端闭环。

### 2026-05-31 任务中心化产品重构第一批完成

- 改动摘要：新增 Skill 插件包上传/合约测试/审批门禁；新增 Task 一等模型与任务执行、任务报告、Trace Tree API；前端改为 Workflow 市场 + 画布、执行中心任务列表、报告中心任务报告，并补齐交互测试；收尾清理了后端未使用导入。
- 变更文件：
  - `aegisqa/api/app.py`
  - `aegisqa/skills/packages.py`
  - `tests/test_task_center_api.py`
  - `frontend/src/App.tsx`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `frontend/src/pages/SkillsPage.tsx`
  - `frontend/src/pages/WorkflowMarketPage.tsx`
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/pages/OverviewPage.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/test/App.test.tsx`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- 验证命令：
  - `python -m pytest tests\test_task_center_api.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `python -m aegisqa.examples.run_mvp_demo`
  - Headless Chrome CDP 打开 `http://127.0.0.1:5173` 并检查 `/`、`/skills`、`/workflows`、`/workflows/designer/draft-test`、`/runs`、`/reports`。
  - 清理未使用导入后复跑 `python -m pytest tests\test_task_center_api.py -q`
- 测试结果：
  - 后端：30 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端：12 个交互测试通过；typecheck/build 通过。
  - 端到端 Demo：最新 Dataset `rag_qa_1000:v6`，Run `run-9311b164dd1f` completed，1000 条样本完成，队列消息仅 `item_id`，Badcase 200 条。
  - 浏览器烟测：Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均能真实渲染关键入口。
- 下一步：补正式 Playwright E2E，完善 Skill 插件审批页、任务详情 Trace Tree、Annotation Queue 和 Experiment/CI Gate 独立页面。

### 2026-05-31 产品化增强批次启动

- 改动摘要：在第一批交互闭环通过后，继续实现市场对标增强能力的最小闭环：Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree，并把概览页从静态指标改为真实 Dashboard 数据。
- 变更文件：
  - `docs/PROJECT_STATUS.md`
- 验证命令：已新增失败测试并执行，失败原因为目标 API/页面能力不存在。
- 测试结果：RED 已确认。
- 下一步：实现后端产品化 API 和前端产品化入口。

### 2026-05-31 产品化增强最小闭环

- 改动摘要：新增 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 后端 API；概览页改为读取真实 Dashboard/Runs/Experiments/Annotation Queue，并展示产品化增强入口；前端 API client 补齐产品化接口。
- 变更文件：
  - `aegisqa/api/app.py`
  - `frontend/src/api/client.ts`
  - `frontend/src/pages/OverviewPage.tsx`
  - `frontend/src/types.ts`
  - `frontend/src/test/App.test.tsx`
  - `tests/test_productization_api.py`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- 验证命令：
  - `python -m pytest tests\test_productization_api.py -q`
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - Headless Chrome CDP 打开 `http://127.0.0.1:5173` 检查首页产品化入口。
  - `python -m aegisqa.examples.run_mvp_demo`
- 测试结果：
  - 后端：28 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端：10 个交互测试通过；typecheck/build 通过。
  - 浏览器交互：首页真实渲染 Dashboard 与 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree。
  - 端到端 Demo：最新 Dataset `rag_qa_1000:v5`，Run `run-6a7b9d2e77a3` completed，1000 条样本完成，队列消息仅 `item_id`，Badcase 200 条。
- 下一步：为 Experiment/Annotation/CI Gate 增加独立页面，补正式 Playwright E2E，并把红队安全扫描和跨 Run Score Analytics 接到报告中心。

### 2026-05-31 前端真实交互闭环与浏览器复测

- 改动摘要：接通数据集、Workflow 设计器、执行中心、报告中心、Judge 审计、治理与审计页面的第一批真实交互；补充交互验收矩阵；发现当前 8000 端口后端进程仍是旧代码导致 `/workflow-drafts` 返回 404，已重启 FastAPI 后端并复测保存草稿成功。
- 变更文件：
  - `frontend/src/types.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/pages/DatasetsPage.tsx`
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/pages/SkillsPage.tsx`
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/pages/JudgeAuditPage.tsx`
  - `frontend/src/pages/GovernancePage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/src/test/setup.ts`
  - `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
  - `docs/PROJECT_STATUS.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
- 验证命令：
  - `python -m pytest -q`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
  - `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health`
  - `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173`
  - Headless Chrome CDP 打开 `http://127.0.0.1:5173` 并点击核心页面按钮。
- 测试结果：
  - 后端：25 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端：9 个交互测试通过；typecheck/build 通过。
  - 端到端 Demo：最新 Dataset `rag_qa_1000:v4`，Run `run-20eb4c596adf` completed，1000 条样本完成，队列消息仅 `item_id`，Badcase 200 条。
  - 浏览器交互：概览、数据集上传弹窗、Workflow 新增 Join、保存草稿、执行中心创建 Run、报告导出反馈、Judge 创建审计、治理权限矩阵均返回明确结果。
- 下一步：把浏览器 CDP 烟测升级为正式 Playwright E2E，并继续实现 Experiment、Assertion DSL、CI Gate、Annotation Queue、Trace Tree。

### 2026-05-31 交互修复批次启动

- 改动摘要：根据完整验证结果，启动 React 前端真实交互修复与产品化优化执行批次；当前先同步项目状态，后续按 TDD 补交互测试、后端 API、前端按钮闭环与验收文档。
- 变更文件：
  - `docs/PROJECT_STATUS.md`
- 验证命令：
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
- 测试结果：
  - 后端：22 passed，仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - 前端 typecheck：通过。
  - 前端 test：1 个测试文件、2 个测试通过。
  - 交互问题：大量按钮缺少真实事件或 API 反馈，需在本批次修复。
- 下一步：先补前端交互回归测试并观察失败，再实现后端与前端交互闭环。

### 2026-05-31 后端交互 API 补齐

- 改动摘要：按 TDD 新增前端交互契约测试，并补齐数据集列表、Workflow 列表、Workflow 草稿、Run 列表、Dashboard 汇总、Skill 合约测试、Badcase 重开/批量/聚类/导出、Judge Profile/Audit 列表、报告导出和 Skill 治理动作 API。
- 变更文件：
  - `aegisqa/api/app.py`
  - `aegisqa/datasets/service.py`
  - `aegisqa/workflows/service.py`
  - `aegisqa/engine/runner.py`
  - `aegisqa/judge/profiles.py`
  - `tests/test_api_interaction_contract.py`
- 验证命令：
  - `python -m pytest tests\test_api_interaction_contract.py -q`
- 测试结果：
  - 3 passed。
  - 仍有 Windows `.pytest_cache` 创建警告，不影响测试结果。
- 下一步：接通 React 前端数据集上传、Workflow 设计器、执行中心和 Skill 合约测试等真实按钮交互。

### 2026-05-30 文档、验收矩阵与最终验证

- 改动摘要：更新 README 前后端分离启动说明、PRD 验收矩阵、`.gitignore`，清理 TypeScript 构建缓存输出，并完成后端、前端、端到端 Demo 与浏览器页面验证。
- 变更文件：
  - `.gitignore`
  - `README.md`
  - `docs/PRD_ACCEPTANCE_MATRIX.md`
  - `docs/PROJECT_STATUS.md`
  - `frontend/tsconfig.app.json`
  - `frontend/tsconfig.node.json`
  - `frontend/src/test/App.test.tsx`
- 验证命令：
  - `python -m pytest -q`
  - `python -m aegisqa.examples.run_mvp_demo`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `Invoke-WebRequest http://127.0.0.1:8000/health`
  - `Invoke-WebRequest http://127.0.0.1:5173`
  - 无头 Chrome CDP 打开 `http://127.0.0.1:5173` 和 `/workflow` 并读取 DOM 文本。
- 测试结果：
  - 后端：22 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
  - Demo：1000 条样本 Run completed，队列消息仅 `item_id`。
  - 前端：typecheck/test/build 均通过。
  - 浏览器验证：概览页与 Workflow 设计器关键内容均存在，截图已人工查看。
- 当前服务：
  - FastAPI：`http://127.0.0.1:8000`
  - React 前端：`http://127.0.0.1:5173`
- 下一步：把 Workflow 设计器的“发布/试运行/保存草稿”按钮接成真实交互流，并继续增强节点拖拽、字段映射表单和报告数据联动。

### 2026-05-30 React 前端工程与页面骨架

- 改动摘要：新增 `frontend/` 前端工程，接入 React、Vite、TypeScript、Ant Design、React Flow、TanStack Query、ECharts，并完成主导航、概览、数据集、Skill 市场、Workflow 设计器、执行中心、报告中心、Judge 审计、治理与审计页面。
- 变更文件：
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/index.html`
  - `frontend/tsconfig.json`
  - `frontend/tsconfig.app.json`
  - `frontend/tsconfig.node.json`
  - `frontend/vite.config.ts`
  - `frontend/vitest.config.ts`
  - `frontend/src/main.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/api/client.ts`
  - `frontend/src/types.ts`
  - `frontend/src/data/demo.ts`
  - `frontend/src/components/PageHeader.tsx`
  - `frontend/src/components/MetricTile.tsx`
  - `frontend/src/pages/OverviewPage.tsx`
  - `frontend/src/pages/DatasetsPage.tsx`
  - `frontend/src/pages/SkillsPage.tsx`
  - `frontend/src/pages/WorkflowDesignerPage.tsx`
  - `frontend/src/pages/RunsPage.tsx`
  - `frontend/src/pages/ReportsPage.tsx`
  - `frontend/src/pages/JudgeAuditPage.tsx`
  - `frontend/src/pages/GovernancePage.tsx`
  - `frontend/src/test/App.test.tsx`
  - `frontend/src/test/setup.ts`
  - `frontend/src/vite-env.d.ts`
- 验证命令：
  - `cd frontend && npm install`
  - `cd frontend && npm test`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm run build`
- 测试结果：
  - `npm test`：1 个测试文件、2 个测试通过。
  - `npm run typecheck`：通过。
  - `npm run build`：通过。
  - `npm install`：完成，npm 报告 5 个 moderate 漏洞，暂未执行 `npm audit fix --force`，避免引入破坏性依赖升级。
- 下一步：更新 README 与 PRD 验收矩阵，执行后端全量测试、前端构建测试、端到端 Demo 与浏览器页面检查。

### 2026-05-30 后端前端契约 API 补齐

- 改动摘要：新增 Workflow Graph 校验/发布/试运行 API、Source Skill 物化 API、Run Trace API、Badcase 筛选 API，并统一 API 错误响应格式。
- 变更文件：
  - `aegisqa/api/app.py`
  - `aegisqa/workflows/graph.py`
  - `aegisqa/workflows/models.py`
  - `tests/test_api_frontend_contract.py`
- 验证命令：
  - `python -m pytest tests\test_api_frontend_contract.py -q`
- 测试结果：
  - 3 passed。
  - 仍存在 Windows `.pytest_cache` 创建警告，不影响测试结果。
- 下一步：搭建 React/Vite/TypeScript 前端工程，接入 Ant Design、React Flow、TanStack Query、ECharts，并实现基础导航与页面骨架。

### 2026-05-30 项目状态机制初始化

- 改动摘要：新增项目状态同步硬规则，并创建项目状态文件。
- 变更文件：
  - `AGENTS.md`
  - `docs/PROJECT_STATUS.md`
- 验证命令：暂未执行，本批次仅涉及文档与项目记忆。
- 测试结果：暂未执行。
- 下一步：补齐前端需要的后端 API，并搭建 React/Vite/TypeScript 前端工程。
