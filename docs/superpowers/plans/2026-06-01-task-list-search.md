# Task List Search 优化计划

## 背景

执行中心主表已经使用 `GET /tasks?page=&page_size=&status=` 服务端分页和状态筛选，但后端已有的 `q` 搜索能力还没有接入前端。任务数量增长后，用户需要靠翻页查找历史任务，主流程“找任务 -> 查看详情 -> 看报告/Trace/修复”不够顺。

## 目标

- 执行中心任务列表增加搜索框。
- 输入任务名、数据源或 Workflow 关键词后，请求 `GET /tasks?q=...&page=1&page_size=8`。
- 搜索时自动回到第 1 页，避免在第 2 页输入关键词后看不到结果。
- 搜索可与状态筛选组合使用。
- 保持创建任务、执行控制、任务详情驾驶舱和报告入口不回归。

## 实施步骤

1. 为 `RunsPage` 增加 `taskSearch` 状态和 `normalizedTaskSearch`。
2. `tasksQuery` query key 增加搜索词，调用 `api.tasksPage({ q, status, page, pageSize })`。
3. 在任务列表工具栏增加 `Input.Search`，搜索和输入变化都重置页码到第 1 页。
4. 更新执行中心交互测试，覆盖从第 2 页搜索并请求 `q=...&page=1&page_size=8`。
5. 同步项目状态与验收矩阵。

## 验证

- `cd frontend && npm test -- src/test/App.test.tsx -t "执行中心任务列表使用服务端分页"`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`
- `git diff --check`

