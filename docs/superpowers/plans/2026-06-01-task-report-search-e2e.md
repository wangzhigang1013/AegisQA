# Task / Report Search E2E 覆盖计划

## 背景

执行中心任务搜索和报告中心任务选择器远程搜索已经有前端组件测试，但这两个入口都依赖 Ant Design 的真实输入、Select 弹层和 Vite `/api` 代理。如果只靠组件测试，仍可能漏掉真实浏览器中输入框不可填、Select 搜索不触发请求或请求参数不正确的问题。

## 目标

- 在 Playwright 主链路中覆盖执行中心任务搜索。
- 在 Playwright 主链路中覆盖报告中心任务选择器远程搜索。
- 断言浏览器真实发出 `GET /api/tasks?q=...` 请求，而不是只看到本地已有文本。
- 保持“上传数据 -> 审批 Skill -> 发布 Workflow -> 创建任务 -> 执行 -> 搜索任务 -> 搜索报告任务 -> 导出/纠错/Trace”主链路连续。

## 实施步骤

1. 在 `task-flow.spec.ts` 创建并执行任务后，进入执行中心，输入刚创建的任务名。
2. 用 `page.waitForRequest` 捕获 `/api/tasks?q={taskName}&page=1&page_size=8`。
3. 在报告中心打开“选择报告任务”下拉后，输入任务名。
4. 用 `page.waitForRequest` 捕获 `/api/tasks?q={taskName}&page_size=20`。
5. 保留原有报告导出、Badcase 加入 Golden 和 Trace Flow 验证。

## 验证

- `cd frontend && npm run e2e -- e2e/task-flow.spec.ts`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`
- `git diff --check`

