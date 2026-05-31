# 2026-06-01 图表组件懒加载优化计划

## 背景

路由级懒加载已经避免概览首屏加载报告中心和 Judge 审计页面，但构建产物显示 `charts` chunk 仍超过 1MB。报告中心和 Judge 审计页面如果静态导入 `echarts-for-react`，进入页面时会同步解析图表库，不利于先展示页面框架、任务选择器和关键结论。

## 目标

- 导入报告中心页面模块时不立即加载 ECharts。
- 导入 Judge 审计页面模块时不立即加载 ECharts。
- 图表区域显示中文加载态，避免异步图表加载期间出现空白。
- 保持报告、Judge 审计、E2E 主链路和构建输出稳定。

## 执行步骤

1. 新增 `lazyCharts.test.tsx`，用 mock 证明页面模块不应同步加载 `echarts-for-react`。
2. 新增 `LazyECharts` 组件，内部使用 `React.lazy` 动态导入 `echarts-for-react`。
3. 报告中心和 Judge 审计页面改用 `LazyECharts`。
4. 增加 `.chart-loading` 图表加载态样式。
5. 运行图表懒加载定向测试、类型检查、全量前端测试、构建、E2E 和后端回归。

## 验收标准

- `npm test -- src/test/lazyCharts.test.tsx` 先红后绿。
- `npm run typecheck` 通过。
- `npm test` 通过。
- `npm run build` 输出独立 `LazyECharts` chunk，`charts` chunk 不被页面模块静态导入。
- `npm run e2e` 通过。
- `python -m pytest -q` 通过。
