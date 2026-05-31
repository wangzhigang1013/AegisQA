# Repair Task Tree Progress 执行计划

## 目标

把已经拆分出来的二级 Repair Task 汇总成可视化修复树进度，让用户在修复任务工作台里直接看见父任务、子任务、完成率、阻塞项和下一步动作。

## 执行步骤

- [x] 审计当前 Repair Task API 和前端工作台，确认只有父子任务记录，没有修复树进度聚合。
- [x] 先写后端失败测试：`GET /repair-tasks/{repair_task_id}/tree` 必须返回父任务、子任务、完成率、阻塞子任务和下一步动作。
- [x] 先写前端失败测试：修复任务工作台必须有“查看进度”入口，并展示修复树进度抽屉。
- [x] 实现后端修复树接口和进度聚合逻辑。
- [x] 实现前端 API client、类型定义、查看进度按钮和抽屉。
- [x] 同步 `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md`。
- [x] 运行全量验证并提交。

## 验收标准

- 父 Repair Task 能看到所有直接子任务。
- 完成率由已完成子任务数除以总子任务数计算。
- 未完成子任务进入 `blocking_children` 和 `next_actions`。
- 用户在 `/repair-tasks` 点击“查看进度”后能看到父任务、整体状态、已完成数量、进度条、下一步动作和子任务明细。
