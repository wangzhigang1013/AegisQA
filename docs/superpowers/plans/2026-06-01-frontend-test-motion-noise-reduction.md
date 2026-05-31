# Frontend Test Motion 降噪计划

## 背景

前端主集成测试 `App.test.tsx` 已覆盖 70 条核心页面交互，但单文件耗时接近 90 秒以上。很多页面使用 Ant Design Modal、Drawer、Tabs、Button loading 等组件，在 jsdom 中不会产生真实动画效果，却仍会注册 motion 相关计时器和异步状态更新。

## 目标

- 仅在 Vitest 环境下降低 Ant Design motion 噪声，不改变生产和 E2E 环境的真实交互动效。
- 保持 `App.test.tsx`、类型检查和生产构建通过。
- 为后续进一步拆分 `App.test.tsx` 留出更干净的测试基线。

## 实施步骤

1. 在 `AppShell` 的 Ant Design theme token 中按 `import.meta.env.MODE === 'test'` 设置 `motion: false`。
2. 保留生产环境默认 motion，不影响用户浏览器中的动效。
3. 运行类型检查和 `App.test.tsx`，对比耗时与输出。
4. 运行全量前端测试、构建、E2E 和空白检查。

## 验收标准

- `cd frontend && npm run typecheck` 通过。
- `cd frontend && npm test -- src/test/App.test.tsx` 通过。
- `cd frontend && npm test` 通过。
- `cd frontend && npm run build` 通过。
- `cd frontend && npm run e2e` 通过。
- 生产构建中 `MODE` 非 `test` 时保持默认 motion。
