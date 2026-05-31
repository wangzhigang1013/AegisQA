# 2026-06-01 Trace Flow 服务端分页优化计划

## 背景

上一批已经让 Trace Flow 左侧样本列表前端分页，但接口仍会一次性返回全部 `items`。每个 item 都包含 Dataset Row、Context、Metrics、Step 输入输出和参数来源，数据量比普通任务列表大得多。大任务打开 Trace Flow 时，主要风险已经从 DOM 渲染扩展到网络传输、JSON 解析和首屏等待。

## 目标

- `GET /tasks/{task_id}/trace-flow` 支持 `page` 和 `page_size` 查询参数。
- API 返回 `pagination` 元数据：当前页、每页数量、总样本数、总页数。
- 后端先切片再构建 item flow，避免序列化全量样本明细。
- 前端翻页时请求对应页，而不是只在浏览器本地切换。
- 保持 Trace Flow 页面原有“默认选中当前页第一条样本、点击样本查看详情”的使用方式。

## 执行步骤

1. 新增后端测试，构造 12 条样本，请求第 2 页且每页 5 条，断言只返回 row_index 5 到 9。
2. 为 Trace Flow 构建器增加分页参数和 pagination 元数据。
3. 为 FastAPI 路由增加 `page/page_size` Query 校验，限制 `page_size <= 100`。
4. 新增前端测试，点击 Trace Flow 第 2 页后断言请求包含 `page=2&page_size=8`。
5. 扩展前端 API client、类型和页面状态，让列表分页由服务端 total 驱动。
6. 同步更新 `docs/PROJECT_STATUS.md`。
7. 运行后端、前端、类型检查、构建、E2E 和空白差异检查。

## 验收标准

- `python -m pytest tests/test_trace_flow_api.py -q` 先红后绿。
- `npm test -- src/test/App.test.tsx -t "Trace Flow 样本列表使用服务端分页"` 先红后绿。
- Trace Flow 第 1 页只拿前 8 条，第 2 页会重新请求后端并展示第 9 条起的样本。
- 全量后端、前端、构建和 E2E 验证通过。
