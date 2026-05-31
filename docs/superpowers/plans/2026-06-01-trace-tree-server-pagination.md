# 2026-06-01 Trace Tree 服务端分页优化计划

## 背景

Trace Tree 用于查看 Item 到 Skill Step 的调用树，单个 item 会携带输入、输出、耗时、缓存命中、错误和指标。任务详情抽屉虽然只展示前 5 条，但旧接口仍可能返回全量调用树；独立 Trace Tree 页面也只是前端分页，无法减少网络传输和 JSON 解析成本。

## 目标

- `GET /runs/{run_id}/trace-tree` 和 `GET /tasks/{task_id}/trace-tree` 支持 `page/page_size`。
- API 返回 `pagination` 元数据。
- 后端只对当前页 item 构建 children 调用树。
- 独立 Trace Tree 页面翻页时请求后端对应页。
- 任务详情抽屉只请求前 5 条 Trace Tree 摘要，避免打开详情时拉取全量调用树。

## 执行步骤

1. 新增后端分页测试，分别覆盖 Run Trace Tree 和 Task Trace Tree。
2. 为 `_build_trace_tree` 增加分页参数、切片和 pagination 元数据。
3. 为 Run/Task Trace Tree 路由增加 Query 参数校验。
4. 新增前端分页测试，点击第 2 页后断言请求包含 `page=2&page_size=8`。
5. 扩展 API client、TraceTree 类型、独立页面分页状态和任务详情抽屉摘要请求。
6. 同步更新 `docs/PROJECT_STATUS.md`。
7. 执行后端、前端、类型检查、构建、E2E 和空白差异检查。

## 验收标准

- `python -m pytest tests/test_trace_tree_pagination.py -q` 先红后绿。
- `npm test -- src/test/App.test.tsx -t "Trace Tree 调用树使用服务端分页"` 先红后绿。
- Trace Tree 第 2 页会重新请求后端，且页面展示第 9 条起的调用树 item。
- 任务详情抽屉不会为了 Trace 摘要拉取全量调用树。
