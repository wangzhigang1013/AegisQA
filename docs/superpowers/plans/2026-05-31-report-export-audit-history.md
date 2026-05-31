# Report Export Audit History 优化计划

## 背景

上一批已经让 Task Report 导出成功写入 `task.report.export` 审计事件，但用户在报告中心看不到导出历史，治理页 API 也只能按 actor/action 过滤，无法精确拉取某个任务的导出记录。这会让“生成报告 -> 外发/复盘 -> 审计追踪”的闭环断在后台日志里。

## 目标

- `/audit-events` 支持按 `target` 过滤，便于按 Task、Skill、Workflow 等对象追踪审计。
- 报告中心展示当前 Task 的报告导出历史。
- 导出成功后刷新当前 Task 的导出历史，用户不用离开页面确认导出记录。
- 保持现有治理页兼容，不改变未带过滤条件时的审计日志行为。

## 实施步骤

1. 后端 TDD：扩展 `tests/test_api.py`，先验证 `actor + action + target` 组合过滤会失败。
2. 前端 TDD：扩展报告中心测试，先验证页面缺少“报告导出历史”。
3. 后端实现：`AuditService.list_events` 与 `/audit-events` 增加 `target` 参数。
4. 前端实现：新增 `AuditEvent` 类型，API client 支持审计过滤参数，报告中心按当前 Task 查询导出历史并展示表格。
5. 导出后刷新：Task Report Export mutation 成功后 invalidate 当前 Task 的 `task.report.export` 审计查询。
6. 文档同步：更新 `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md`。

## 验证

- `python -m pytest tests\test_api.py -q -k audit_events`
- `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"`
- 收尾时继续执行全量后端、前端、构建和 E2E 验证。
