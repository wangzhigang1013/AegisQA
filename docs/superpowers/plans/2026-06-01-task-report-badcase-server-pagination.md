# 2026-06-01 Task Report Badcase 服务端分页优化计划

## 背景

报告中心是任务复盘、导出、纠错和 Golden 沉淀的主入口。旧接口会在 `GET /tasks/{task_id}/report` 中返回全部 Badcase 明细，前端再本地分页。大任务产生大量坏例时，报告首屏会承担过多网络传输和 JSON 解析成本；但导出报告又必须保留完整坏例，不能因为页面分页而丢失离线复盘数据。

## 目标

- `GET /tasks/{task_id}/report` 支持 `badcase_page/badcase_page_size`。
- 页面报告返回当前页 Badcase 和 `badcase_pagination` 元数据。
- `report.badcases` 与顶层 `badcases` 保持一致，都是当前页明细。
- 报告导出继续包含完整 Badcase 明细，不被页面分页截断。
- 报告中心 Badcase 表由服务端 total 驱动，翻页时重新请求对应页。
- 任务详情抽屉只请求前 8 条 Badcase 摘要。

## 执行步骤

1. 新增后端测试，构造 12 条 Badcase，请求第 2 页且每页 5 条，断言页面报告只返回 5 条。
2. 同一测试验证 JSON 导出仍返回完整 12 条 Badcase。
3. 为 `_build_task_report_payload` 增加 Badcase 分页参数和 `include_all_badcases` 导出开关。
4. 为报告 API 增加 Query 参数校验。
5. 扩展前端 API client、TaskReport 类型、BadcaseTable 分页属性和报告页分页状态。
6. 新增前端测试，点击 Badcase 第 2 页后断言请求包含 `badcase_page=2&badcase_page_size=5`。
7. 同步更新 `docs/PROJECT_STATUS.md`。
8. 执行完整回归验证。

## 验收标准

- `python -m pytest tests/test_task_report_badcase_pagination.py -q` 先红后绿。
- `npm test -- src/test/App.test.tsx -t "报告中心 Badcase 明细使用服务端分页"` 先红后绿。
- 报告页 Badcase 翻页会重新请求后端。
- JSON/CSV/HTML 导出仍使用完整 Badcase 明细。
