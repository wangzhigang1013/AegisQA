# Task 列表服务端分页计划

## 背景

Trace、Badcase、Annotation Queue、CI Gate、候选资产、Repair Task 和 Score Analytics 已逐步改成服务端分页，但执行中心主表仍直接使用 `GET /tasks` 拉取全量任务。任务是产品主对象，一旦历史任务变多，执行中心会成为用户进入全流程时最先卡住的页面。

## 目标

- `GET /tasks` 不带分页参数时保持旧数组响应。
- `GET /tasks?page=&page_size=` 返回 `{ items, pagination }`。
- 支持按 `status`、`dataset_id`、`workflow_id` 和 `q` 过滤后分页。
- React 执行中心主任务表使用服务端分页。
- 执行中心新增状态筛选，筛选变化回到第 1 页。
- 任务创建、执行、重试等动作仍通过 `queryKey: ['tasks']` 刷新任务相关缓存。

## TDD 步骤

1. 后端红灯：创建 6 个任务，其中 3 个执行完成，断言无分页参数仍返回数组；带 `status=queued&page=2&page_size=2` 返回分页对象。
2. 前端红灯：执行中心渲染 12 个任务的分页 mock，断言默认只展示第一页，点击第 2 页会请求后端；状态筛选会带 `status=completed&page=1`。
3. 后端实现：在 `/tasks` route 中加入可选筛选和分页，复用 `_paginate_records`。
4. 前端实现：新增 `TaskPageResult`、`api.tasksPage`，执行中心主表改为受控分页和状态筛选。
5. 文档同步：更新项目状态、PRD 验收矩阵、交互验收矩阵。
6. 验证：后端定向、前端定向、后端全量、前端 typecheck/test/build、Playwright E2E、`git diff --check`。

## 验收标准

- 旧调用 `GET /tasks` 仍返回数组。
- 执行中心不会一次性加载全部任务。
- 状态筛选发生变化时页码回到 1。
- 分页、筛选、任务动作刷新互不破坏。
