# Repair Task Assignment/SLA Loop 优化计划

## 背景

修复任务已经支持从报告诊断生成、领取、完成、重开、发起人工审核、CI Gate 复测、复跑对比、生成修复建议、拆分二级任务和查看修复树进度。但“拆出来的子任务由谁负责、什么时候必须完成、哪些子任务已经逾期”仍然不清晰，用户在真实团队协作时会卡在分派与跟踪上。

## 本批目标

1. 后端新增修复任务指派 API，支持设置负责人和截止时间。
2. 修复树 summary 聚合逾期子任务数量和 ID。
3. 下一步动作、子任务明细和任务列表暴露负责人、截止时间和逾期状态。
4. 前端修复任务工作台提供“指派”弹窗，成功后刷新并保留后端返回的负责人信息。
5. 完成已逾期任务时清除 `overdue`，避免已完成任务仍被标为超时。

## 实施步骤

### RED

- 后端测试：在二级修复任务上调用 `POST /repair-tasks/{repair_task_id}/assign`，期望返回负责人、截止时间和逾期状态；最初失败为 404。
- 后端测试：完成已逾期修复任务后，期望返回 `overdue=false`；最初失败为 `overdue=true`。
- 前端测试：进入 `/repair-tasks` 后应能打开“指派修复任务”弹窗、提交负责人和截止时间，并在修复树中看到逾期子任务；最初失败为找不到“指派”入口。

### GREEN

- 在 `aegisqa/api/app.py` 增加 `RepairTaskAssignRequest`。
- 在 `aegisqa/api/routes/tasks.py` 增加 `assign_repair_task` 路由，记录 `owner`、`due_at`、`assigned_at`、`overdue` 和审计事件。
- 修复树 summary 增加 `overdue_children`、`overdue_task_ids`，下一步动作增加 `owner`、`due_at`、`overdue`。
- `resolve_repair_task` 设置 `overdue=false`。
- 前端 API client 增加 `assignRepairTask`。
- 前端类型增加 `due_at`、`assigned_at`、`overdue` 和修复树逾期字段。
- 修复任务工作台增加负责人列、指派弹窗、指派按钮、逾期展示和修复树逾期统计。

### 验证

- `python -m pytest tests\test_task_flow_optimization.py -q`
- `cd frontend && npm test -- src/test/App.test.tsx -t "修复任务工作台"`
- 后续全量验证继续执行：
  - `git diff --check`
  - `python -m pytest -q`
  - `cd frontend && npm run typecheck`
  - `cd frontend && npm test`
  - `cd frontend && npm run build`
  - `cd frontend && npm run e2e`

## 后续优化

- 增加负责人工作量视图，按 owner 聚合 open/in_progress/overdue。
- 增加逾期升级策略，例如超过 N 小时自动提醒或提升严重级别。
- 把二级任务进一步动作化到 Dataset 字段修复、Workflow 参数 diff/回滚和 Prompt/Skill 版本对比。

## 最终验证结果

- `git diff --check`：通过。
- `python -m pytest tests\test_task_flow_optimization.py -q`：9 passed。
- `python -m pytest -q`：74 passed，存在 Windows `.pytest_cache` 警告，不影响结果。
- `cd frontend && npm run typecheck`：通过。
- `cd frontend && npm test`：47 passed。
- `cd frontend && npm run build`：通过。
- `cd frontend && npm run e2e`：8 passed。
