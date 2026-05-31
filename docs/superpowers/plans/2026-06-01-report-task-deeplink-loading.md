# Report Task Deeplink Loading 优化计划

## 背景

报告中心已经围绕 Task 展示报告，但任务选择器仍容易退回“读取全部任务再本地查找”的模式。随着 Task 历史增长，这会让报告深链 `/reports?task_id=...` 打开变慢，也会把无关任务加载到报告页。

## 目标

- 报告中心任务选择器只加载最近一页任务，用于普通选择。
- 当 URL 携带 `task_id` 且目标任务不在最近一页时，只调用 `GET /tasks/{task_id}` 精准加载单个任务。
- 深链目标任务加载完成前不回退展示最近列表第一条任务，避免短暂展示错误报告或误发起无关报告请求。
- 当前任务报告、Score Analytics、导出、Badcase 和 Trace 入口继续围绕选中 Task 工作。
- 用前端回归测试锁定：深链报告必须请求分页任务列表和单任务接口，不能依赖全量任务扫描。

## 实施步骤

1. 在前端 API client 增加 `api.task(taskId)`，封装 `GET /tasks/{task_id}`。
2. 报告中心任务选择器改为 `api.tasksPage({ page: 1, pageSize: 20 })`。
3. 报告中心根据 URL `task_id` 判断是否需要按需加载单任务，并把单任务合并进选择器选项。
4. Score Analytics 继续按当前 Task 的 Dataset + Workflow 作用域查询。
5. 新增报告深链测试，覆盖“最近任务列表没有目标任务时，页面仍能加载目标任务并请求单任务接口”，并确认不会请求最近列表第一条任务的报告。
6. 同步 `docs/PROJECT_STATUS.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md` 和 `docs/PRD_ACCEPTANCE_MATRIX.md`。

## 验证

- `cd frontend && npm test -- src/test/App.test.tsx -t "报告中心深链任务|报告中心 Score Analytics"`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`
- `git diff --check`
