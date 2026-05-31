# Task Preflight Gate 执行计划

## 背景

任务创建向导已经提供 Preflight，但创建按钮和后端 `POST /tasks` 仍允许在 Preflight 阻断时继续创建任务。这样用户可能把缺字段、未审批 Skill 或其他硬阻断问题带入执行阶段，后续报告、Trace 和修复任务都会建立在一个本应先修复的任务上。

## 目标

- 后端把 `preflight_result.status=blocked` 作为任务创建门禁。
- 前端必须先运行与当前 Dataset Version、Workflow Version 匹配的 Preflight，才能创建任务。
- Preflight 阻断时默认禁止创建；如果确需创建，必须显式勾选风险确认，并把 `allow_blocked_preflight=true` 写入任务执行快照。
- 仍保留字段修复类测试场景的强制创建能力，确保故意制造坏数据的诊断流程可继续执行。

## 实施顺序

1. 先新增后端失败测试：缺字段数据创建任务应返回 `TASK_PREFLIGHT_BLOCKED`，显式 `allow_blocked_preflight` 才能创建。
2. 先新增前端失败测试：只选 Dataset/Workflow 不能创建；阻断 Preflight 必须确认风险后才能创建。
3. 后端 `TaskCreateRequest` 增加 `allow_blocked_preflight`，并在 `create_task` 中阻断 blocked Preflight。
4. 前端 `TaskCreateWizard` 增加 Preflight 匹配校验、过期提示、阻断风险确认框和创建按钮门禁。
5. 更新执行中心请求体、API client、类型定义和 Playwright 主链路。
6. 更新状态文档和验收矩阵。

## 验证

- `python -m pytest tests\test_task_center_api.py -q -k preflight`
- `cd frontend && npm test -- src/pages/task/TaskCreateWizard.test.tsx`
- `cd frontend && npm test -- src/test/App.test.tsx -t "执行中心默认展示任务列表并可以创建任务"`
- `cd frontend && npm run e2e -- e2e/task-flow.spec.ts`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`
