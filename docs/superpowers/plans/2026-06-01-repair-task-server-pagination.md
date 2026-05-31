# Repair Task 工作台服务端分页计划

## 背景

Repair Task 是报告诊断之后的主要修复入口，会持续积累人工审核、CI Gate 复测、复跑、参数修复、候选资产沉淀等工作项。旧实现由 `GET /repair-tasks` 返回筛选后的全量数组，前端再按状态过滤和本地分页；当修复任务增多时，工作台首次打开和状态切换都会变慢。

## 目标

- 保持旧 API 兼容：无分页参数时继续返回数组。
- 新增后端 `status` 过滤，避免前端拉全量后本地筛选。
- 带 `page/page_size` 时返回 `{ items, pagination }`。
- React `/repair-tasks` 页面主表改为服务端分页。
- 状态筛选、来源任务筛选变化时回到第 1 页。
- 保留领取、完成、重开、指派、修复树和后续动作闭环。

## 执行步骤

1. 后端先写失败测试，覆盖 legacy 数组响应、分页响应和状态筛选后分页。
2. 前端先写失败测试，确认翻页和状态筛选会请求后端。
3. 后端 `GET /repair-tasks` 增加 `status/page/page_size` 参数。
4. 前端 API client 增加分页方法和类型。
5. Repair Task 页面改为 TanStack Query 受控分页。
6. 更新验收矩阵和项目状态。
7. 执行定向验证和全量验证。

## 验收标准

- `/repair-tasks?source_task_id=...` 仍返回 legacy 数组。
- `/repair-tasks?source_task_id=...&page=2&page_size=5` 返回分页结果。
- `/repair-tasks?status=open&page=1&page_size=5` 先按状态过滤再分页。
- 页面点击第 2 页会请求 `page=2&page_size=8`。
- 页面选择状态会请求 `status=...&page=1`。
- 修复任务既有动作回归通过。
