# Report Export Permission Gate 优化计划

## 背景

报告导出已经具备下载、内容深度和导出历史，但外发权限仍不严谨：只要能调用接口就可以导出报告。对于评测结论、Badcase、Preflight 证据和模型参数快照这类可外发资产，必须明确“谁能看”和“谁能导出”不是同一个权限。

## 目标

- RBAC 增加 `report:export` 权限。
- Task Report Export 在服务端校验导出角色，Viewer 只能 `report:read`，不能 `report:export`。
- 无权限导出返回结构化错误 `REPORT_EXPORT_FORBIDDEN`，并记录拒绝审计。
- 报告中心显式展示“报告导出角色”，只读角色下禁用导出按钮并说明原因。

## 实施步骤

1. 后端 TDD：扩展 Task Report Export 测试，先确认 Viewer 仍能导出并失败。
2. 前端 TDD：扩展报告中心测试，先确认页面缺少导出角色门禁。
3. 后端实现：`AccessControl` 增加 `report:export`，Task Report Export 增加 `role` 参数和 403 阻断。
4. 前端实现：API client 导出请求携带角色；报告中心新增角色选择器，Viewer 下禁用导出按钮并展示只读提示。
5. 文档同步：更新项目状态、PRD 验收矩阵和交互验收矩阵。

## 验证

- `python -m pytest tests\test_task_center_api.py -q -k preflight_is_persisted`
- `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"`
- `cd frontend && npm run e2e -- e2e/task-flow.spec.ts`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`

结果：

- 后端目标用例完成 RED -> GREEN：Viewer 导出从 200 修正为 403，并返回 `REPORT_EXPORT_FORBIDDEN`。
- 前端目标用例完成 RED -> GREEN：报告中心展示导出角色，Viewer 只读时禁用导出按钮。
- Playwright 主链路曾因 E2E 依赖 `.ant-select.first()` 误打开“报告导出角色”下拉而超时；任务选择器补 `aria-label="选择报告任务"` 后，主链路 1 passed。
- 全量验证通过：后端 92 passed，前端 62 passed，构建通过，Playwright 8 passed。
