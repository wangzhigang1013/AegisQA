# 2026-06-01 任务详情 Badcase 分页优化计划

## 背景

任务详情抽屉是执行中心最常用的复盘入口。报告中心的 Badcase 表已经分页，但任务详情抽屉内的 Badcase 表仍然一次性渲染 `report.badcases`。当任务产生几十到几百条坏例时，用户从任务列表点开详情会出现不必要的 DOM 压力，也会让“概览、Trace、Attempts、参数”这些关键入口被慢表格拖累。

## 目标

- 任务详情 Badcase 表默认只渲染当前页坏例。
- 保持现有 Task Report 数据结构和 Badcase 展示字段不变。
- 不影响报告中心的 Badcase 纠错、Golden 沉淀和导出流程。

## 执行步骤

1. 新增前端回归测试，构造 12 条 Badcase，证明旧实现会一次性渲染第 9 条。
2. 将任务详情抽屉 Badcase 表改为每页 8 条，并关闭 page size 切换，保持后台系统表格密度稳定。
3. 同步更新 `docs/PROJECT_STATUS.md`。
4. 运行前端定向测试、全量测试、类型检查、构建、E2E 和后端回归。

## 验收标准

- `npm test -- src/test/App.test.tsx -t "任务详情 Badcase 表分页"` 先红后绿。
- 打开任务详情 Badcase 页签时，第 1 页显示 `item-0` 到 `item-7`，不渲染 `item-8`。
- `npm test`、`npm run typecheck`、`npm run build`、`npm run e2e` 通过。
- `python -m pytest -q` 通过。
