# Report Page Test 拆分跟进计划

## 背景

上一批已经抽出工作台测试 harness，并把修复任务工作台迁移到独立测试文件。`App.test.tsx` 仍包含报告中心这一组较重的任务报告、导出、审批、Badcase、Score Analytics 和远程搜索测试，继续留在主文件会拖慢主工作台测试反馈。

## 目标

- 把报告中心 10 条测试迁移到 `ReportsPage.test.tsx`。
- 继续复用 `workbenchTestHarness.tsx`，不复制默认 mock。
- 让 `App.test.tsx` 聚焦通用工作台和剩余页面入口。
- 保持全量前端测试总覆盖不变。

## 实施步骤

1. 从 `App.test.tsx` 中定位 `报告中心` 用例块。
2. 新增 `frontend/src/test/ReportsPage.test.tsx`，导入报告测试所需 fixture 和 helper。
3. 从主测试文件移除报告中心块。
4. 运行 `App.test.tsx + ReportsPage.test.tsx` 定向验证。
5. 运行全量验证并同步状态。

## 验收标准

- `cd frontend && npm test -- src/test/App.test.tsx src/test/ReportsPage.test.tsx` 通过。
- `ReportsPage.test.tsx` 覆盖 10 条报告中心测试。
- `App.test.tsx` 行数继续下降，报告中心可独立运行。
- 全量验证通过。
