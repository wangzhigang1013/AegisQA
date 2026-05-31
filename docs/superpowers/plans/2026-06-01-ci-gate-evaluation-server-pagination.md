# CI Gate 评估历史服务端分页计划

## 背景

CI Gate 评估历史会随着发布门禁运行不断增长。旧实现由 `GET /ci-gates/evaluations` 一次性返回全部记录，前端表格再本地分页；当历史记录变多时，页面首次打开会承担不必要的数据传输和渲染成本。同时，“历史趋势”卡片不能简单基于当前页计算，否则翻页后会误导用户。

## 目标

- 保持旧 API 兼容：无分页参数时继续返回数组。
- 新增分页响应：带 `page/page_size` 时返回 `{ items, pagination, summary }`。
- `summary` 基于筛选后的全量评估历史计算，而不是当前页。
- CI Gate 页面评估历史表改为服务端分页，翻页重新请求后端。
- 保留既有创建门禁、执行评估、历史趋势和阻断原因展示能力。

## 执行步骤

1. 后端先写失败测试，覆盖 legacy 数组响应、分页响应、筛选后分页和全量摘要。
2. 前端先写失败测试，确认点击第 2 页会请求 `page=2&page_size=6`。
3. 后端 `GET /ci-gates/evaluations` 增加分页参数和全量摘要。
4. 前端 API client 增加分页方法和类型。
5. CI Gate 页面用 TanStack Query 受控分页，历史趋势卡读取服务端 summary。
6. 更新验收矩阵和项目状态。
7. 执行定向验证和全量验证。

## 验收标准

- `GET /ci-gates/evaluations` 不带分页参数时仍返回数组。
- `GET /ci-gates/evaluations?page=2&page_size=5` 返回分页元数据和全量 summary。
- 页面点击第 2 页会重新请求后端，而不是本地切片。
- 历史趋势卡的总数、阻断数、通过数不受当前页影响。
- 后端、前端、构建、E2E 和 `git diff --check` 全部通过。
