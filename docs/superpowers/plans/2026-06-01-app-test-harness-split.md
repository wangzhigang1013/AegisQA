# App Test Harness 拆分计划

## 背景

`frontend/src/test/App.test.tsx` 同时包含 demo 数据、默认 fetch mock、渲染工具和 70 条页面级测试，文件超过 3000 行。这个结构让新增页面测试时很难快速定位上下文，也让 Vitest 无法对其中的业务域测试做文件级并行。

## 目标

- 把共享 demo 数据、默认 API mock 和 `renderWorkbench` 抽到独立 harness。
- 先迁移一组低耦合业务域测试，验证拆分方式可靠。
- 不改变测试覆盖范围和默认 mock 行为。
- 让后续继续拆分报告、Workflow、候选资产、CI Gate 等测试时有稳定模板。

## 实施步骤

1. 新增 `frontend/src/test/workbenchTestHarness.tsx`，导出 demo 数据、`jsonResponse`、`errorResponse`、`findComboboxByLabel`、`renderWorkbench` 和 `installDefaultWorkbenchMocks`。
2. 简化 `App.test.tsx`，只保留主工作台测试用例和必要 imports。
3. 新增 `frontend/src/test/RepairTasksPage.test.tsx`，迁移修复任务工作台 14 条测试。
4. 运行拆分后的目标测试和类型检查，确认导入、默认 mock 和测试行为不变。
5. 运行前端全量、构建、E2E、后端回归和空白检查。

## 验收标准

- `cd frontend && npm test -- src/test/App.test.tsx src/test/RepairTasksPage.test.tsx` 通过。
- 拆分后两个测试文件合计仍覆盖 70 条原工作台测试。
- `App.test.tsx` 行数显著下降，修复任务测试可单独运行。
- 全量验证通过。
