# 2026-06-01 Annotation Queue 服务端分页优化计划

## 背景

Annotation Queue 是“报告发现问题 -> 人工审核 -> 回流 Golden / Assertion”的关键交接点。旧页面会一次性读取全部审核任务，再由 Ant Design 表格本地分页；真实任务量积压后，会增加首屏网络传输、JSON 解析和渲染压力，也会让筛选后的分页结果不够可控。

## 目标

- `GET /annotation-queue` 保持无分页参数时返回数组，兼容概览页和旧调用。
- `GET /annotation-queue?page=&page_size=` 返回 `{ items, pagination }`。
- 服务端分页必须先应用 `status`、`assignee`、`source_task_id` 筛选，再分页。
- React Annotation Queue 页面改为受控服务端分页。
- 切换状态、负责人、来源任务筛选时重置到第 1 页，并清空已选样本。
- 批量审核、领取、分派、审核回流 Golden 的既有动作保持可用。

## 执行步骤

1. 新增后端测试，构造 12 条审核任务，确认 legacy 数组响应不变。
2. 同一测试确认带 `page=2&page_size=5` 时返回第 2 页和分页元数据。
3. 同一测试确认 `status=assigned` 等筛选先于分页执行。
4. 为 `/annotation-queue` 增加可选分页 Query 参数和分页 helper。
5. 新增前端分页响应类型与 `api.annotationQueuePage`。
6. 修改 Annotation Queue 页面使用服务端分页，并在筛选变化时重置分页和选择。
7. 新增前端回归测试，点击第 2 页后断言请求包含 `page=2&page_size=8`。
8. 同步更新项目状态与验收矩阵。
9. 执行后端、前端、构建、E2E 与空白检查。

## 验收标准

- `python -m pytest tests/test_productization_api.py -q -k "annotation_queue_supports_server_side_pagination"` 先红后绿。
- `cd frontend && npm test -- src/test/App.test.tsx -t "Annotation Queue 审核队列使用服务端分页"` 先红后绿。
- `GET /annotation-queue` 无分页参数仍返回数组。
- Annotation Queue 页面翻页会重新请求后端。
- 既有领取、分派、审核、批量审核和候选资产摘要测试保持通过。
