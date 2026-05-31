# Task Create Wizard 生命周期告警治理计划

## 背景

执行中心“创建任务”链路虽然功能可用，但前端全量测试会输出 Ant Design `useForm` 未连接警告。这个警告说明任务创建弹窗在未真正挂载 Form 时已经创建或操作了 form 实例，容易掩盖后续真正的 UI 回归，也会让测试输出不够干净。

## 目标

- 执行中心创建任务主链路不再触发 `Instance created by useForm is not connected`。
- 任务创建向导在关闭状态不提前创建 Form 实例。
- 保留现有 Dataset / Workflow 选择、Preflight、确认创建、执行参数模板和风险确认能力。

## 实施步骤

1. 在执行中心主测试里增加 stderr 回归断言，先确认当前链路会触发 `useForm` 未连接警告。
2. 调整 `TaskCreateWizard` 生命周期：外层组件在 `open=false` 时返回 `null`，内部内容组件只在打开时创建 Ant Design form。
3. 移除关闭态 `resetFields` 和 `forceRender` 依赖，关闭时通过卸载自然清理表单状态。
4. 补充组件级测试，确认关闭弹窗不会触发未连接警告。
5. 运行定向测试、全量前端测试、类型检查、构建、E2E 和后端测试。

## 验收标准

- `cd frontend && npm test -- src/test/App.test.tsx -t "执行中心默认展示任务列表并可以创建任务"` 先 RED 后 GREEN。
- `cd frontend && npm test -- src/pages/task/TaskCreateWizard.test.tsx` 通过。
- 全量 `npm test` 输出不再包含 `Instance created by useForm is not connected`。
- 任务创建弹窗仍能完成 Preflight 和创建任务。
