# AegisQA 评测数据流与产品体验升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AegisQA 从“功能可操作”升级为“评测过程可解释、参数可追溯、任务可运营、报告可决策”的专业评测平台。

**Architecture:** 以 Task 为唯一用户主线，Run 降级为 Task Attempt；后端新增 Skill 参数解析与冻结、Trace 数据流模型、质量闭环 API；前端新增 Trace 独立页、任务驾驶舱、参数预览、报告分层分析，并移除/降级不围绕 Task 的入口。所有改动保持 FastAPI + React/Vite/TypeScript + Ant Design + React Flow + TanStack Query 架构。

**Tech Stack:** FastAPI、Pydantic、React、TypeScript、Ant Design、React Flow、TanStack Query、ECharts、pytest、Vitest、Playwright。

---

## 执行总则

- 每批开始前写失败测试，确认失败原因正确，再写实现。
- 每批结束前必须更新 `docs/PROJECT_STATUS.md`。
- 每批至少运行：
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
- 涉及主链路或 UI 跳转的批次必须运行：
  - `cd frontend && npm run e2e`
- 每批单独提交，提交信息说明业务含义。

## 本轮需要移除或降级

- Streamlit 保留为 legacy demo，不作为 README 主启动路径和主功能说明。
- 前端继续把 Run 降级为 Task Attempt，主文案统一“任务 / 执行批次”，Run 只出现在技术详情。
- 报告中心不展示无上下文指标；所有报告入口必须绑定 Task 或 Experiment。
- 静态 demo 数据只允许出现在模板和空状态，不能作为主表格默认内容。
- 治理页里不可操作的“生产适配状态”移到 README/部署文档，不作为产品功能按钮。
- Skill 上传不能绕过合约测试和审批；所有直接启用未审批 Skill 的入口必须禁用或删除。

## 阶段 1：Skill 参数解析与冻结

**目标：** 明确 Skill 内参数如何处理，做到参数来源可解释、执行前可预览、Task 创建时可冻结。

**主要文件：**

- Create: `aegisqa/skills/parameters.py`
- Modify: `aegisqa/engine/runner.py`
- Modify: `aegisqa/api/routes/tasks.py`
- Modify: `aegisqa/api/routes/workflows.py`
- Test: `tests/test_skill_parameter_resolution.py`
- Docs: `docs/PROJECT_STATUS.md`

### Task 1.1：参数解析器

- [x] 新增测试：`config_schema` default 会进入最终参数。
- [x] 新增测试：Workflow 节点配置覆盖 schema default。
- [x] 新增测试：Task execution_config 的 `skill_overrides` 覆盖节点配置。
- [x] 新增测试：表达式参数 `{ "type": "expression", "path": "row.question" }` 能解析到当前样本。
- [x] 新增测试：Secret 参数只显示 `secret_ref`，Trace 中不落明文。
- [x] 实现 `SkillParameterResolver`，固定优先级：
  `schema_default < workflow_config < task_override < runtime_expression < secret_ref`。
- [x] 输出 `resolved_config` 与 `parameter_trace`，每个字段包含 `source`、`value_preview`、`redacted`。

### Task 1.2：Runner 接入参数解析

- [x] 新增测试：RunItemStep 记录 `config_snapshot` 与 `parameter_trace`。
- [x] 新增测试：Task 创建后的参数快照不会受后续 Workflow 修改影响。
- [x] 修改 `RunRequest`，增加 `task_config_snapshot`。
- [x] 修改 `RunItemStep`，增加 `config_snapshot`、`parameter_trace`。
- [x] `WorkflowRunner._execute_item` 调 Skill 前使用参数解析器，不再直接传 `workflow_step.config`。
- [x] `run.snapshot` 保存 workflow 参数、task overrides、skill config hash。

### Task 1.3：参数预览 API

- [x] 新增 API 测试：`POST /workflow-graphs/parameter-preview` 返回每个节点的最终参数。
- [x] 新增 API 测试：坏表达式返回结构化错误和修复建议。
- [x] 在 Workflow 路由中新增参数预览接口，输入 graph、dataset、sample_row、task_overrides。
- [x] 前端 API client 增加 `previewWorkflowParameters`。

## 阶段 2：Trace 数据流模型与独立页面

**目标：** 让用户能看到一条样本从 Dataset Row 到 Skill Input/Output、Metric、Badcase 的完整流转。

**主要文件：**

- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/api/routes/reports.py`
- Modify: `aegisqa/api/routes/tasks.py`
- Create: `aegisqa/reports/trace_flow.py`
- Create: `frontend/src/pages/TraceFlowPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts`
- Test: `tests/test_trace_flow_api.py`
- Test: `frontend/src/test/App.test.tsx`
- Test: `frontend/e2e/task-flow.spec.ts`

### Task 2.1：Trace Flow API

- [x] 新增测试：`GET /tasks/{task_id}/trace-flow` 返回 dataset、workflow、attempt、items、steps、data_edges。
- [x] 新增测试：单条 item trace 包含 row、input、resolved_config、output、metrics、error、badcase 状态。
- [x] 实现 `build_task_trace_flow(task, run)`。
- [x] 在 Task 路由挂载 `GET /tasks/{task_id}/trace-flow`。

### Task 2.2：Trace 独立页面

- [x] 前端测试：导航进入 `/tasks/:task_id/trace` 后展示样本列表和 Step 流转。
- [x] 新增 `TraceFlowPage`，左侧样本列表，中间 Step Timeline，右侧数据详情。
- [x] 数据详情分 Tab：Row、Input、参数、Output、Metrics、Error。
- [x] Task 详情和报告页增加“查看 Trace”入口。
- [x] Playwright 覆盖任务执行后进入 Trace 页并查看参数来源。

## 阶段 3：UI 信息架构与任务驾驶舱

**目标：** 用户进入系统后清楚知道“下一步做什么”，任务详情成为执行运营入口。

**主要文件：**

- Modify: `frontend/src/pages/OverviewPage.tsx`
- Modify: `frontend/src/pages/RunsPage.tsx`
- Create: `frontend/src/pages/task/TaskOperationsDrawer.tsx`
- Create: `frontend/src/pages/task/TaskSnapshotPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/test/App.test.tsx`
- Test: `frontend/e2e/task-flow.spec.ts`

### Task 3.1：首页工作台

- [x] 首页改为评测工作台：最近任务、待审批 Skill、待审核 Annotation、失败任务、CI Gate 阻断。
- [x] 所有入口围绕“上传数据 -> 选择 Workflow -> 创建任务 -> 查看报告”。
- [x] 移除不围绕 Task 的大段说明文本。

### Task 3.2：任务详情驾驶舱

- [x] 任务详情改为 Tab：概览、样本、Trace、Badcase、Attempts、参数。
- [x] 参数 Tab 展示 Task 冻结参数、Skill 参数来源和 Secret 脱敏。
- [x] Attempts Tab 明确 Run 是底层执行批次。
- [x] 执行动作展示影响范围：重跑多少条、是否产生新 Attempt、是否覆盖报告。

## 阶段 4：Workflow 设计器字段映射升级

**目标：** 减少手写 JSON，改成可选择上游输出路径和参数预览的专业设计器。

**主要文件：**

- Modify: `frontend/src/pages/WorkflowDesignerPage.tsx`
- Create: `frontend/src/pages/workflowDesigner/FieldMappingEditor.tsx`
- Create: `frontend/src/pages/workflowDesigner/ParameterPreviewPanel.tsx`
- Modify: `frontend/src/pages/workflowDesigner/graphModel.ts`
- Test: `frontend/src/pages/workflowDesigner/graphModel.test.ts`
- Test: `frontend/src/test/App.test.tsx`
- Test: `frontend/e2e/workflow-designer.spec.ts`

### Task 4.1：字段路径选择器

- [x] 从 Dataset field_paths、上游 output_mapping、metrics、context 生成可选路径。
- [x] Inspector 字段映射从 JSON 文本升级为表格编辑。
- [x] 坏映射保留 JSON 高级模式，并显示校验错误。

### Task 4.2：参数预览

- [x] Inspector 增加“参数预览”Tab。
- [x] 选择样本后调用 `/workflow-graphs/parameter-preview`。
- [x] 显示 default、workflow_config、task_override、expression、secret_ref 的来源。

## 阶段 5：报告分层分析与闭环动作

**目标：** 报告回答“整体怎么样、哪里不好、下一步做什么”。

**主要文件：**

- Modify: `aegisqa/reports/aggregator.py`
- Modify: `aegisqa/api/routes/reports.py`
- Modify: `frontend/src/pages/ReportsPage.tsx`
- Create: `frontend/src/pages/report/ReportSegmentAnalysis.tsx`
- Test: `tests/test_report_segment_analysis.py`
- Test: `frontend/src/test/App.test.tsx`

### Task 5.1：分层分析 API

- [ ] 按 `scene`、`expected_label`、`model_version`、`prompt_version` 统计通过率、失败率、样本数、Badcase 数。
- [ ] API 返回 `segments`，字段包含 segment_key、segment_value、sample_count、pass_rate、badcase_count。

### Task 5.2：报告 UI

- [ ] 报告详情增加分层分析表和图表。
- [ ] 增加“下一步建议”：低通过率分组加入 Annotation、生成 Golden 候选、生成 CI Gate 建议。

## 阶段 6：Annotation / Golden 批量闭环

**目标：** 人工审核结果可批量回流 Golden、Prompt 候选和 Assertion 候选。

**主要文件：**

- Modify: `aegisqa/api/routes/productization.py`
- Modify: `frontend/src/pages/AnnotationQueuePage.tsx`
- Test: `tests/test_productization_api.py`
- Test: `frontend/e2e/productization.spec.ts`

### Task 6.1：批量审核

- [ ] API 增加 `POST /annotation-queue/bulk-review`。
- [ ] 前端支持多选任务、批量设置标签、说明和回流 Golden。
- [ ] 审核结果保留 reviewer、reviewed_at、source_task_id。

### Task 6.2：候选资产

- [ ] Badcase/Annotation 审核后生成 Golden 候选和 Assertion 候选记录。
- [ ] 前端显示候选资产数量和来源任务。

## 阶段 7：Experiment 与 CI Gate 历史

**目标：** 支持持续质量发布，而不是只看一次评估。

**主要文件：**

- Modify: `aegisqa/api/routes/productization.py`
- Modify: `frontend/src/pages/ExperimentsPage.tsx`
- Modify: `frontend/src/pages/CIGatesPage.tsx`
- Test: `tests/test_productization_api.py`
- Test: `frontend/e2e/productization.spec.ts`

### Task 7.1：CI Gate 历史

- [ ] `POST /ci-gates/evaluate` 保存 evaluation record。
- [ ] `GET /ci-gates/evaluations` 支持按 config、task、run 筛选。
- [ ] CI Gate 页面展示历史、阻断原因和趋势。

### Task 7.2：Experiment 对比增强

- [ ] Experiment 页面增加按 Dataset/Workflow 过滤。
- [ ] 增加 A/B 对比面板：通过率、Badcase、耗时、成本、失败分布。

## 阶段 8：生产化边界与移除整理

**目标：** 移除误导入口，明确 demo 与生产边界。

**主要文件：**

- Modify: `README.md`
- Modify: `frontend/src/pages/GovernancePage.tsx`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- Modify: `docs/PROJECT_STATUS.md`

### Task 8.1：降级 legacy 和不可操作状态

- [ ] README 主启动路径不再强调 Streamlit，只保留 legacy 段落。
- [ ] 治理页不可操作生产适配状态移到文档链接。
- [ ] 文档明确 Run 是底层 Attempt，不是用户主对象。

### Task 8.2：最终验收

- [ ] `python -m pytest -q`
- [ ] `python -m aegisqa.examples.run_mvp_demo`
- [ ] `cd frontend && npm run typecheck`
- [ ] `cd frontend && npm test`
- [ ] `cd frontend && npm run build`
- [ ] `cd frontend && npm run e2e`
- [ ] 更新 `docs/PROJECT_STATUS.md`
- [ ] 更新 `docs/PRD_ACCEPTANCE_MATRIX.md`
- [ ] 更新 `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
