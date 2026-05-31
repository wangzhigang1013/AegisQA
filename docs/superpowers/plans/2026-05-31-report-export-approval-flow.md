# Report Export Approval Flow 优化计划

## 背景

报告导出已经具备 `report:export` 权限门禁，但企业真实使用里，“只读角色不能导出”不应该是死路。用户需要把敏感评测报告外发给业务或审计方时，应当走可追踪审批：申请、审批、按审批导出、审计留痕。

## 目标

- Viewer 直接导出 Task Report 继续被 `REPORT_EXPORT_FORBIDDEN` 阻断。
- Viewer 可以为当前 Task 和指定格式创建导出审批请求。
- 只有具备 `report:export:approve` 的角色可以审批；当前本地 RBAC 由 Admin 通过。
- 审批通过后，Viewer 可携带 `approval_request_id` 导出同一 Task、同一格式的报告。
- 报告中心展示导出审批请求列表，并提供申请与 Admin 审批入口。

## 实施步骤

1. 后端 TDD：新增 Viewer 申请导出审批、Reviewer 审批失败、Admin 审批成功、带审批 ID 导出成功的测试。
2. 后端实现：新增 `ReportExportRequestCreate`、`ReportExportApprovalRequest`，补齐 `POST /tasks/{task_id}/report/export-requests`、`GET /report-export-requests`、`POST /report-export-requests/{request_id}/approve`。
3. 后端实现：Task Report Export 增加 `approval_request_id`，无 `report:export` 权限时校验审批记录的 task、format、role、status。
4. 前端 TDD：报告中心测试覆盖 Viewer 申请 HTML 导出审批、Admin 审批、审批后带 ID 导出。
5. 前端实现：API client、ReportExportRequest 类型、报告页审批请求表、申请按钮和审批按钮。
6. 文档同步：更新项目状态、PRD 验收矩阵、交互验收矩阵。

## 验证

- `python -m pytest tests\test_task_center_api.py -q -k viewer_can_export_task_report_after_admin_approval`
- `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"`
- 收尾时执行全量后端、前端、构建和 E2E。
