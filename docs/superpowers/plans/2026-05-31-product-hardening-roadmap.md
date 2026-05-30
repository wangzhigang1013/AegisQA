# AegisQA 产品严谨化与全方位优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AegisQA 从“主链路可演示”推进到“真实团队可持续使用的评测任务平台”。

**Architecture:** 继续保留现有 FastAPI + JSON Store + React/Vite 主架构，按业务域逐步增强：先修 P0 稳定性，再强化 Workflow 画布、Task、Report、Skill 安全、Experiment/CI/Annotation，最后做工程拆分和生产化边界。每一阶段必须 TDD、更新状态文档、补验收矩阵、提交 Git commit。

**Tech Stack:** FastAPI、Pydantic、React、TypeScript、Ant Design、React Flow、TanStack Query、Playwright、Vitest、pytest。

---

## 执行总则

- 每个阶段开始前先写失败测试，确认失败原因正确，再写实现。
- 每次修改代码、文档、配置、测试后，必须同步 `docs/PROJECT_STATUS.md`。
- 每个阶段完成后至少运行：
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
- 涉及主链路的阶段必须运行：
  - `cd frontend && npm run e2e`
- 每个阶段单独提交，提交信息使用中文或清晰英文均可，但必须能说明业务含义。

## 阶段 1：P0 Bug 与稳定性修复

**目标：** 修复会导致数据不可信、按钮重复触发、插件上传不安全、任务状态错乱的问题。

**主要文件：**

- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/datasets/service.py`
- Modify: `aegisqa/skills/packages.py`
- Modify: `aegisqa/engine/runner.py`
- Modify: `frontend/src/pages/DatasetsPage.tsx`
- Modify: `frontend/src/pages/SkillsPage.tsx`
- Modify: `frontend/src/pages/RunsPage.tsx`
- Test: `tests/test_p0_hardening.py`
- Test: `frontend/src/test/App.test.tsx`
- Docs: `docs/PROJECT_STATUS.md`

### Task 1.1：数据集上传严谨校验

- [x] 新增后端失败测试：空文件上传返回结构化错误。
- [x] 新增后端失败测试：JSONL 某一行不是 JSON 时，错误包含行号。
- [x] 新增后端失败测试：CSV 只有表头没有数据时拒绝创建 Dataset Version。
- [x] 实现 `DatasetService.upload_dataset` 的空内容、空行、坏 JSON 行、空 CSV 校验。
- [x] 前端上传弹窗展示后端错误 message 和修复建议。
- [x] 运行 `python -m pytest tests/test_p0_hardening.py -q`。

### Task 1.2：Skill zip 安全校验

- [x] 新增后端失败测试：zip 内包含 `../evil.py` 时拒绝上传。
- [x] 新增后端失败测试：zip 内包含绝对路径时拒绝上传。
- [x] 新增后端失败测试：handler 超时返回 `SKILL_CONTRACT_TIMEOUT`。
- [x] 实现插件包路径规范化检查。
- [x] 为受控子进程增加 timeout、stdout/stderr 最大长度和结构化错误。
- [x] 前端 Skill 上传失败时展示错误 code、message、details。
- [x] 运行 `python -m pytest tests/test_p0_hardening.py -q`。

### Task 1.3：Task 状态机与重复动作保护

- [x] 新增后端失败测试：running Task 再次 execute 返回 `TASK_ALREADY_RUNNING`。
- [x] 新增后端失败测试：completed Task 再次 execute 生成新 attempt 或明确拒绝，本项目第一阶段选择明确拒绝并提示“请复制任务重新执行”。
- [x] 新增后端失败测试：cancelled Task 不能 pause/resume。
- [x] 实现 Task action 状态机校验。
- [x] 前端执行按钮根据状态禁用，并展示禁用原因 Tooltip。
- [x] 运行 `python -m pytest tests/test_p0_hardening.py -q` 和 `cd frontend && npm test`。

### Task 1.4：统一错误响应覆盖关键 API

- [x] 新增 API 测试：Dataset、Skill、Workflow、Task 的业务错误均返回 `{ code, message, details, trace_id }`。
- [x] 补齐异常转换，避免前端收到纯字符串错误。
- [x] 前端 API client 解析结构化错误，页面统一显示中文修复建议。
- [x] 运行后端与前端全量验证。

## 阶段 2：Workflow 画布精细化

**目标：** Workflow 画布成为真实可用的流程设计器，支持复杂 DAG、节点配置、保存、试运行、发布和自动化验收。

**主要文件：**

- Modify: `frontend/src/pages/WorkflowDesignerPage.tsx`
- Create: `frontend/src/pages/workflowDesigner/graphModel.ts`
- Create: `frontend/src/pages/workflowDesigner/WorkflowInspector.tsx`
- Create: `frontend/src/pages/workflowDesigner/WorkflowPalette.tsx`
- Create: `frontend/e2e/workflow-designer.spec.ts`
- Modify: `aegisqa/workflows/graph.py`
- Test: `tests/test_workflow_graph_hardening.py`

### Task 2.1：图模型转换独立化

- [x] 新增前端单元测试：nodes/edges 能转换为后端 `WorkflowGraph`。
- [x] 新增前端单元测试：空 Skill、坏 JSON mapping、缺 Branch 条件会产生前端校验错误。
- [x] 抽出 `graphModel.ts`，避免页面组件直接拼后端 payload。
- [x] 运行 `cd frontend && npm test`。

### Task 2.2：画布节点与连线操作补齐

- [x] 新增 Playwright 失败测试：点击添加 Source、Skill、Join、Output。
- [x] 新增 Playwright 失败测试：创建连线。
- [x] 新增 Playwright 失败测试：删除连线、删除节点。
- [x] 新增 Playwright E2E 第一批：进入画布、点击新增 Join、删除选中、校验、发布。
- [x] 实现撤销/重做栈，覆盖节点新增、删除、Inspector 编辑、自动布局、连线。
- [x] 实现 Inspector 下游连线管理区，支持查看并删除选中节点流出的连线。
- [x] 实现 Inspector 可连接目标区，支持选择目标节点并创建下游连线。
- [x] 实现节点工具栏和键盘删除。
- [x] 运行 `cd frontend && npm run e2e -- e2e/workflow-designer.spec.ts`。

### Task 2.3：Inspector 字段映射与发布前校验

- [x] 新增测试：未审批 Skill 不能发布。
- [x] 新增测试：多对一没有 Join/Aggregator 时发布失败。
- [x] 新增测试：Branch 没条件表达式发布失败。
- [x] 右侧 Inspector 支持节点名称、Skill、输入映射、输出路径、条件表达式、聚合策略。
- [x] 保存草稿后返回 Workflow 市场，再打开仍保留所有配置。
- [x] 运行 `python -m pytest tests/test_workflow_graph_hardening.py -q` 和 Workflow E2E。

## 阶段 3：Task 执行中心严谨化

**目标：** 执行中心变成可运维的任务控制台，避免任务状态不清、执行结果不清。

**主要文件：**

- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/engine/runner.py`
- Modify: `frontend/src/pages/RunsPage.tsx`
- Create: `frontend/src/pages/task/TaskCreateWizard.tsx`
- Create: `frontend/src/pages/task/TaskDetailDrawer.tsx`
- Test: `tests/test_task_state_machine.py`
- Test: `frontend/e2e/task-controls.spec.ts`

### Task 3.1：任务创建向导

- [x] 新增前端测试：必须选择 Dataset Version 和 Workflow Version 才能创建。
- [x] 新增前端测试：创建参数包含并发、重试、repeat、成本预算。
- [x] 抽出 `TaskCreateWizard.tsx`。
- [x] 列表页只负责展示和打开详情。
- [x] 运行 `cd frontend && npm test`。

### Task 3.2：任务详情与 Run Attempt

- [x] 后端新增 Run Attempt 模型或轻量字段，保留历史执行记录。
- [x] 新增测试：重新执行不会覆盖旧报告。
- [x] 任务详情展示 attempts、当前 attempt、失败原因、Trace Tree。
- [x] 运行 `python -m pytest tests/test_task_center_api.py -q`。

## 阶段 4：任务报告与 Badcase 工作流

**目标：** 报告解释“为什么好/坏”，Badcase 能进入人工处理和 Golden 沉淀。

**主要文件：**

- Modify: `frontend/src/pages/ReportsPage.tsx`
- Create: `frontend/src/pages/report/ReportSummary.tsx`
- Create: `frontend/src/pages/report/BadcaseTable.tsx`
- Modify: `aegisqa/reports/service.py`
- Modify: `aegisqa/badcases/service.py`
- Test: `tests/test_report_badcase_workflow.py`
- Test: `frontend/e2e/report-badcase.spec.ts`

### Task 4.1：任务报告详情结构化

- [ ] 新增测试：报告返回 Task 摘要、版本快照、指标、Step 分布、Badcase。
- [ ] 前端报告详情拆成摘要、指标、耗时、分数、Badcase、Trace Tree。
- [ ] 导出 HTML/CSV/JSON 按真实文件内容校验。
- [ ] 运行报告相关测试。

### Task 4.2：Badcase 状态流转

- [ ] 新增测试：加入 Golden、加入 Annotation Queue、标记误判、忽略、重开。
- [ ] 前端 Badcase 表格支持单条和批量动作。
- [ ] 所有动作成功后刷新 Task Report。
- [ ] 运行 `cd frontend && npm run e2e -- e2e/report-badcase.spec.ts`。

## 阶段 5：Skill 平台安全与审批

**目标：** Skill 市场从上传入口升级为插件审批与生命周期平台。

**主要文件：**

- Modify: `frontend/src/pages/SkillsPage.tsx`
- Modify: `frontend/src/pages/GovernancePage.tsx`
- Create: `frontend/src/pages/skills/SkillApprovalDrawer.tsx`
- Modify: `aegisqa/skills/packages.py`
- Test: `tests/test_skill_package_security.py`
- Test: `frontend/e2e/skill-approval.spec.ts`

### Task 5.1：审批体验

- [ ] Skill 市场展示待审批、合约测试状态、审批人、审批时间。
- [ ] 治理页支持审批抽屉，展示 manifest、schema、测试日志。
- [ ] 未通过合约测试不能启用。
- [ ] 运行 Skill 审批测试。

### Task 5.2：安全执行边界

- [ ] handler 返回体过大时失败。
- [ ] handler stdout/stderr 过大时截断。
- [ ] handler 异常保留错误摘要但不泄露本地绝对路径。
- [ ] 运行后端安全测试。

## 阶段 6：Experiment、CI Gate、Annotation 独立产品页

**目标：** 把已有最小 API 变成用户可以操作的产品功能。

**主要文件：**

- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/pages/ExperimentsPage.tsx`
- Create: `frontend/src/pages/CIGatesPage.tsx`
- Create: `frontend/src/pages/AnnotationQueuePage.tsx`
- Modify: `frontend/src/api/client.ts`
- Test: `tests/test_productization_api.py`
- Test: `frontend/e2e/productization.spec.ts`

### Task 6.1：Experiment 页面

- [ ] 展示实验快照列表。
- [ ] 支持选择 baseline 对比。
- [ ] 展示指标变化、失败样本变化、成本变化。
- [ ] 运行前端测试。

### Task 6.2：CI Gate 页面

- [ ] 支持创建质量门禁配置。
- [ ] 支持对 Task/Run 执行 gate 评估。
- [ ] gate fail 展示阻断原因。
- [ ] 运行 API 与 E2E 测试。

### Task 6.3：Annotation Queue 页面

- [ ] 队列列表支持状态、负责人、来源 Task 筛选。
- [ ] 支持领取、分派、审核、回流 Golden。
- [ ] 运行 Annotation E2E。

## 阶段 7：工程结构与生产化边界

**目标：** 降低后续维护成本，为 MySQL/Redis/Celery 生产适配做清晰边界。

**主要文件：**

- Split: `aegisqa/api/app.py`
- Create: `aegisqa/api/routes/datasets.py`
- Create: `aegisqa/api/routes/skills.py`
- Create: `aegisqa/api/routes/workflows.py`
- Create: `aegisqa/api/routes/tasks.py`
- Create: `aegisqa/api/routes/reports.py`
- Create: `aegisqa/api/routes/judge.py`
- Create: `aegisqa/api/routes/governance.py`
- Create: `aegisqa/storage/file_lock.py`
- Modify: `README.md`

### Task 7.1：API 路由拆分

- [ ] 先跑全量后端测试作为基线。
- [ ] 按 domain 拆分 routes。
- [ ] 保持 `create_app()` 对外不变。
- [ ] 全量测试通过后提交。

### Task 7.2：JSON Store 文件锁

- [ ] 新增并发写入测试。
- [ ] 实现跨平台文件锁或进程内锁保护本地 demo store。
- [ ] 文档说明 JSON Store 只适合 demo，生产使用 MySQL/Redis/Celery。

## 最终验收

- [ ] `python -m pytest -q` 通过。
- [ ] `python -m aegisqa.examples.run_mvp_demo` 通过。
- [ ] `cd frontend && npm run typecheck` 通过。
- [ ] `cd frontend && npm test` 通过。
- [ ] `cd frontend && npm run build` 通过。
- [ ] `cd frontend && npm run e2e` 通过。
- [ ] `docs/PROJECT_STATUS.md` 已记录每个阶段。
- [ ] `docs/PRD_ACCEPTANCE_MATRIX.md` 已更新覆盖状态。
- [ ] `docs/INTERACTION_ACCEPTANCE_MATRIX.md` 已更新按钮验收状态。
