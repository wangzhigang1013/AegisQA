# 2026-06-01 路由级懒加载优化计划

## 背景

当前 `frontend/src/App.tsx` 静态导入所有业务页面。报告中心和 Judge 审计页面依赖 ECharts，虽然 `vite.config.ts` 已经把图表库拆到 `charts` chunk，但静态页面导入仍会让首屏路由提前解析这些页面模块。

## 目标

- 打开概览页时不预加载报告中心和 Judge 审计等非当前路由页面模块。
- 保持现有导航、路由、测试和构建行为不变。
- 页面懒加载期间提供明确中文加载态，避免用户看到空白区域。

## 执行步骤

1. 新增 `lazyRoutes.test.tsx`，用模块 mock 证明概览路由不应该加载报告中心和 Judge 审计模块。
2. 将 `AppShell` 的页面导入改为 `React.lazy` 动态导入。
3. 用 `Suspense` 包裹业务路由，并增加统一加载态样式。
4. 运行定向测试、类型检查、前端全量测试、构建和 E2E。
5. 同步更新 `docs/PROJECT_STATUS.md`。

## 验收标准

- `npm test -- src/test/lazyRoutes.test.tsx` 先红后绿。
- `npm run typecheck` 通过。
- `npm test` 通过。
- `npm run build` 通过，并生成路由级页面 chunk。
- `npm run e2e` 通过。
