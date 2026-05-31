# Task Execution Templates 执行计划

## 背景

执行中心已经围绕 Task 串起 Dataset、Workflow、Run、Report 和 Badcase，但创建任务时仍需要每次手动填写评测目的、质量门槛、并发、repeat、重试和成本预算。对 release gate、Prompt 实验、稳定性复跑这类重复任务来说，手填参数容易造成同类任务不可比，也不利于复现。

## 目标

- 新增任务执行参数模板 API，提供内置模板和自定义模板。
- 创建任务时可携带 `execution_template_id`，并写入 Task/Run 执行快照。
- 前端创建任务向导支持选择模板，并自动填充评测目的、质量门槛、并发、repeat、重试和成本预算。
- 模板能力必须不破坏 Preflight 创建门禁。

## 实施顺序

1. 后端失败测试：`GET /task-execution-templates` 必须返回内置模板；`POST /task-execution-templates` 可创建自定义模板；创建 Task 后快照保留模板 ID。
2. 前端失败测试：选择执行参数模板后，表单必须填充质量门槛和执行参数。
3. 后端新增 `TaskExecutionTemplateCreateRequest`、模板列表/创建接口、内置模板和配置标准化。
4. 前端新增 `TaskExecutionTemplate` 类型、API client、执行中心查询和向导下拉。
5. 同步 `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md`。

## 验证

- `python -m pytest tests\test_task_center_api.py -q`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`
