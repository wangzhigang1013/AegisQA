# Report Export Approval Lifecycle 优化计划

## 背景

上一批已经让 Viewer 可以申请报告导出审批，并在 Admin 批准后携带 `approval_request_id` 导出。但真实治理场景里，审批不能只有“通过”一种终态；敏感报告外发还需要拒绝、撤销和过期，避免审批单长期悬挂或误用。

## 目标

- 待审批导出申请可以被 Admin 拒绝，并记录拒绝原因。
- 待审批或已批准的申请可以由原申请角色撤销。
- 导出申请默认 24 小时过期，也支持创建时指定 `expires_at`。
- 过期申请不能再被批准，已过期批准也不能继续用于导出。
- 前端报告中心在审批请求表中展示过期时间，并提供 Admin 拒绝、申请人撤销入口。
- 所有状态变化都进入审计事件，便于追踪报告外发治理过程。

## 实施步骤

1. 后端 TDD：新增拒绝、撤销、过期生命周期测试，先观察 `/reject`、`/revoke` 缺失导致失败。
2. 后端实现：新增 `ReportExportRevokeRequest`、`expires_at` 字段、拒绝/撤销 API、过期状态刷新和审计事件。
3. 前端 TDD：报告中心测试覆盖 Admin 拒绝、重新申请、Admin 审批、审批后导出、申请人撤销。
4. 前端实现：API client 增加 reject/revoke；审批请求表增加过期时间、拒绝、撤销按钮。
5. 文档同步：更新项目状态、PRD 验收矩阵和交互验收矩阵。
6. 收尾验证：运行后端、前端、构建、E2E 和 `git diff --check`。

## 验证

- `python -m pytest tests\test_task_center_api.py -q -k "report_export_request_lifecycle_reject_revoke_and_expire or viewer_can_export_task_report_after_admin_approval"`
- `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"`
- 收尾时执行全量后端、前端、构建和 E2E。
