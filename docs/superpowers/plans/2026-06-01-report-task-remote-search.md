# Report Task Remote Search 优化计划

## 背景

报告中心已经支持最近任务分页和深链单任务加载，但普通用户在报告页选择历史任务时，如果目标任务不在最近 20 条内，仍然缺少直接搜索入口。

## 目标

- 报告中心任务选择器支持远程搜索。
- 输入任务名、任务关键词后，请求 `GET /tasks?q=...&page=1&page_size=20`。
- 搜索结果仍保持服务端分页语义，不在前端本地扫描历史任务。
- 选择任务后清空搜索词，回到正常任务选择状态。
- 保持深链单任务加载、Score Analytics 当前任务作用域和报告导出逻辑不回归。

## 实施步骤

1. 为报告中心任务选择器增加 `taskSearch` 状态。
2. `tasksQuery` query key 增加搜索词，并通过 `api.tasksPage({ q, page: 1, pageSize: 20 })` 请求后端。
3. Ant Design Select 开启 `showSearch`，关闭本地 `filterOption`，使用 `onSearch` 触发远程查询。
4. 切换任务后清空搜索词，避免下一次选择停留在旧过滤条件。
5. 新增前端回归测试，确认输入“历史任务”后请求后端 `q=历史任务`。
6. 同步项目状态与验收矩阵。

## 验证

- `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心任务选择器支持远程搜索|报告中心深链任务|报告中心 Score Analytics"`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`
- `git diff --check`

