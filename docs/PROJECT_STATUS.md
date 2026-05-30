# AegisQA 项目状态

## 当前阶段

产品严谨化阶段 2（Workflow 画布精细化）继续推进中；本批已补齐 Inspector 下游连线删除入口，并把 Source/Skill/Join/Output 新增节点纳入 Playwright，下一步继续做创建连线、键盘删除、保存草稿回放与发布前校验深化。

## 当前已完成

- 后端 MVP 与 PRD 主链路已实现。
- Skill 注册、Dataset、Workflow、DAG、Run、Report、Badcase、Judge 审计、RBAC、审计日志、生产适配资产已具备基础能力。
- Streamlit 工作台可访问，但 UI 粗糙、使用路径不清晰，不作为产品化主前端继续扩展。
- 已新增项目状态同步规则：每次执行代码、文档、配置、测试、脚手架、UI 等改动后，都必须同步更新本文件。
- React 主前端已从静态样板推进到任务中心化交互闭环：数据集上传弹窗、Source Skill 物化、Skill 插件包上传、Workflow 市场、Workflow 画布、任务列表、任务控制、任务报告、Badcase 纠错、Judge 审计、治理动作均已有明确 API 或禁用/失败反馈。
- Skill 市场已支持 zip 插件包上传，后端校验 `skill.yaml|skill.json` 与 `handler.py`，上传后进入 `pending_review`，合约测试通过后才能审批启用。
- 新增 Task 一等模型，Task 绑定 Dataset Version、Workflow Version 和底层 Run，执行中心与报告中心都围绕任务组织。
- 已建立 `docs/INTERACTION_ACCEPTANCE_MATRIX.md`，逐页记录可见按钮的可用状态、依赖 API 和验收方式。
- 已新增正式 Playwright E2E，自动覆盖“上传数据 -> 上传并审批 Skill -> 创建 Workflow -> 发布 -> 创建 Task -> 执行 -> 查看任务报告 -> 纠错 Badcase”主链路。
- 已新增全量优化执行计划 `docs/superpowers/plans/2026-05-31-product-hardening-roadmap.md`，阶段顺序为 P0 稳定性、Workflow 画布、Task、Report/Badcase、Skill 安全、Experiment/CI/Annotation、工程结构。
- 已完成 P0 稳定性第一批：数据集上传空文件/坏 JSONL/空 CSV 拒绝；Skill zip 非法路径拒绝；插件合约测试超时返回结构化 code；Task completed/running/canceled 状态禁止非法动作；前端任务动作按钮按状态禁用；API client 保留后端 code/details/trace_id。
- Workflow 画布图模型已从页面抽离为 `frontend/src/pages/workflowDesigner/graphModel.ts`，新增独立单元测试；Playwright 已新增画布 E2E，覆盖进入画布、新增 Join、删除选中、校验、发布。
- Workflow 画布已新增撤销/重做历史栈，节点新增、删除、自动布局、Inspector 编辑、连线会进入历史；组件测试和 Playwright 已覆盖新增 Join 后撤销/重做。
- Workflow Inspector 已支持查看选中节点的下游连线，并可单条删除连线；组件测试和 Playwright 已覆盖 `answer -> judge_a` 删除路径。
- Workflow Palette 的 Source、Skill、Join、Output 新增路径已进入 Playwright 自动化，避免后续回归成“按钮能看不能用”。

## 最近验证

- `python -m pytest -q`：30 passed。
- `python -m aegisqa.examples.run_mvp_demo`：1000 条样本端到端完成，最新 Dataset `rag_qa_1000:v6`，Run `run-9311b164dd1f` completed，队列消息仅 `item_id`，`pass_rate=0.8`，`error_rate=0.0`，Badcase 200 条，Judge 审计 Accuracy/Precision/Recall/F1/Kappa 均为 1.0。
- `cd frontend && npm run typecheck`：通过。
- `cd frontend && npm test`：3 个测试文件、18 个测试通过。
- `cd frontend && npm run build`：通过。
- `cd frontend && npm run e2e`：3 个 Playwright E2E 测试通过，覆盖任务主链路与 Workflow 画布 Source/Skill/Join/Output 新增、删除下游连线、删除节点、校验、发布。
- `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`：1 个 Playwright E2E 测试通过，覆盖 Workflow 画布删除下游连线、新增 Join、撤销/重做、删除节点、校验、发布。
- `http://127.0.0.1:8000/health`：FastAPI 页面健康检查通过。
- `http://127.0.0.1:5173`：React 前端可访问。
- 无头 Chrome 页面验证：`/`、`/skills`、`/workflows`、`/workflows/designer/draft-test`、`/runs`、`/reports` 均能打开并展示关键入口。
- Headless Chrome CDP 交互验证：概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均返回明确结果。
- Headless Chrome CDP 产品化概览验证：首页包含真实 Dashboard 指标和 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 入口。

## 当前问题

- Workflow 画布的 Source/Skill/Join/Output 新增、删除节点、删除下游连线、撤销/重做、校验、发布已进入 Playwright；仍需把真实拖拽创建连线、键盘删除、保存草稿回放、试运行和更严格发布前校验纳入浏览器自动化。
- Task 已成为前端主线，完整端到端 UI 流程已由 Playwright 覆盖；后续需要继续增强任务成本预算、CI Gate、baseline 对比和权限检查。
- Skill 插件包已采用受控子进程执行，后续还需补资源限额、依赖隔离、签名校验和更完整的审批页。
- Experiment 快照、CI Gate、Annotation Queue、Trace Tree 已有后端最小闭环；仍需做成完整独立页面、加入成本预算和 baseline 可视化对比。
- 报告、Badcase、Judge 审计已经接入基础数据与动作，人工审阅队列已有后端最小闭环；仍需补齐多 Judge 一致性视图、红队安全扫描和跨任务 Score Analytics。
- 本地服务曾出现旧 FastAPI 进程未重启导致新增路由 404 的问题；已重启后端并完成浏览器复测。后续修改后端 API 时必须确认 8000 端口加载的是最新代码。

## 下一阶段目标

- 扩展 Playwright E2E：把 Workflow 画布的拖拽创建连线、键盘删除、保存草稿回放、试运行、发布前阻断校验全部纳入浏览器自动化。
- 把 Experiment、Prompt/Skill 版本注册、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 从最小 API 能力继续扩展为完整页面与端到端操作流。
- 把当前 JSON 文件仓储继续保留为本地 demo，同时规划 MySQL/Redis/Celery 的真实生产接入与部署验收。

## 最近改动

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
