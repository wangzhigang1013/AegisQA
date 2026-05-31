# Score Analytics 作用域过滤与趋势分页计划

## 背景

报告中心已经围绕 Task 展示质量结论、Badcase、导出和诊断动作，但“跨任务 Score Analytics”仍然读取全量任务趋势。这样会把不同数据集、不同 Workflow 的通过率和 Badcase 混在一起，用户在复盘某一次任务时容易误判当前 Workflow 的真实退化情况。

## 目标

- `GET /score-analytics` 支持 `dataset_id`、`workflow_id`、`status` 过滤。
- `GET /score-analytics` 支持 `page/page_size` 服务端分页。
- 不带分页参数时保持旧响应结构，兼容既有调用。
- `summary` 始终基于过滤后的全量趋势，`trend` 只返回当前页。
- 报告中心按当前选中 Task 的 Dataset 和 Workflow 请求趋势。
- 报告中心趋势表改为受控分页，翻页请求后端。

## TDD 步骤

1. 后端红灯：新增测试创建同一 Dataset + Workflow 下 6 个完成任务，请求 `/score-analytics?dataset_id=&workflow_id=&status=completed&page=2&page_size=2`，期望返回分页元数据和当前页趋势。
2. 前端红灯：报告中心打开 `task-demo` 时，断言请求包含 `dataset_id=dataset-demo`、`workflow_id=wf-demo`、`page=1`、`page_size=4`。
3. 后端实现：先筛选任务，再构建趋势，带分页参数时裁剪 `trend` 并返回 `pagination`。
4. 前端实现：`api.scoreAnalytics` 增加筛选参数；报告页根据当前任务作用域和 `scorePage` 请求；表格分页变为受控分页。
5. 文档同步：更新 PRD 矩阵、交互矩阵和项目状态。
6. 验证：后端定向、前端定向、全量后端、前端 typecheck/test/build、Playwright E2E、`git diff --check`。

## 验收标准

- 当前任务报告中的趋势只包含同 Dataset + Workflow 的历史任务。
- 大量历史任务不会一次性传到浏览器。
- 旧的 `/score-analytics` 调用仍然返回 `{ summary, trend, regressions }`。
- 分页响应额外返回 `{ pagination }`，且 summary 不被当前页截断。
