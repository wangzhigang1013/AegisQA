# Task Report Export Preflight Evidence 实施计划

## 背景

Task Report 已经能展示创建前 Preflight 证据，但报告中心导出按钮仍调用 Run 级导出接口。Run 级导出只知道底层执行结果，不知道 Task、Preflight、Badcase 和业务摘要，用户离线复盘时会丢失“创建任务前到底看过哪次预检”的审计证据。

## 目标

- 新增 Task 级报告导出接口，作为报告中心主导出入口。
- JSON、CSV、HTML 三种格式都必须包含 `preflight_id`。
- HTML 导出必须转义任务名和 JSON 内容，避免报告被浏览器打开时出现脚本注入风险。
- 前端报告中心导出按钮必须调用 `/tasks/{task_id}/report/export`。
- 保留 Run 级导出接口，避免破坏已有兼容能力。

## 实施步骤

1. 后端先写失败测试，断言 `GET /tasks/{task_id}/report/export` 的 JSON/CSV/HTML 都包含创建前 Preflight 证据。
2. 前端先写失败测试，断言报告中心点击导出按钮会调用 Task 级导出接口，而不是 Run 级导出接口。
3. 抽出 `_build_task_report_payload`，让在线报告和导出共用同一个 Task Report 事实源。
4. 新增 `GET /tasks/{task_id}/report/export`，按 `json|csv|html` 返回结构化导出内容。
5. 为 HTML 导出增加转义测试，确认任务名中的脚本片段不会原样出现在导出内容中。
6. 前端 API client 新增 `exportTaskReport`，报告中心导出 mutation 改为按 `selectedTask.task_id` 导出。
7. 同步 `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md` 和 `docs/INTERACTION_ACCEPTANCE_MATRIX.md`。
8. 执行目标测试和全量验证。

## 验收标准

- 后端目标测试经历 RED -> GREEN。
- 前端目标测试经历 RED -> GREEN。
- `python -m pytest -q` 通过。
- `cd frontend && npm run typecheck` 通过。
- `cd frontend && npm test` 通过。
- `cd frontend && npm run build` 通过。
- `cd frontend && npm run e2e` 通过。
- `git diff --check` 通过。

## 后续优化

- 报告导出从“后端返回 content”升级为浏览器真实下载文件。
- CSV 导出增加 Badcase 明细、分层指标和参数治理明细。
- HTML 导出增加目录、样式、质量决策、根因诊断和修复任务链接。
