# 2026-06-01 Trace Flow 样本分页优化计划

## 背景

Trace Flow 是解释“数据如何从 Dataset Row 流入 Skill、参数如何解析、输出如何形成 Badcase”的关键页面。当前样本列表直接渲染 `traceFlow.items`，当任务包含数百到上千条样本时，页面左侧列表会一次性生成大量 DOM，影响用户定位单条样本和查看参数证据。

## 目标

- Trace Flow 样本列表默认分页，每页 8 条。
- 保持默认选中第一条样本、点击样本切换详情的交互不变。
- 不改变 Trace Flow API 数据结构，先降低前端渲染压力。

## 执行步骤

1. 新增前端回归测试，构造 12 条 Trace Flow 样本，证明旧实现会一次性渲染第 9 条。
2. 为 Trace Flow `List` 增加每页 8 条分页，并关闭 page size 切换。
3. 同步更新 `docs/PROJECT_STATUS.md`。
4. 运行定向测试、前端全量、类型检查、构建、E2E 和后端回归。

## 验收标准

- `npm test -- src/test/App.test.tsx -t "Trace Flow 样本列表分页"` 先红后绿。
- 第 1 页展示 `trace-item-0` 到 `trace-item-7`，不渲染 `trace-item-8`。
- `npm test`、`npm run typecheck`、`npm run build`、`npm run e2e` 通过。
- `python -m pytest -q` 通过。
