# 候选资产批量指派控件优化计划

## 背景

候选资产中心已经支持负责人容量限制，但前端仍固定使用 `qa_owner` 和容量 5。实际使用时，不同团队会有不同负责人、值班人和处理容量，固定值会让页面继续带有 demo 感，也容易造成错误指派。

## 目标

- 候选资产中心提供“批量指派负责人”输入框。
- 候选资产中心提供“负责人开放候选容量”输入框。
- 批量指派按钮使用当前输入值生成文案和请求体。
- 负责人为空时禁用批量指派，避免提交无效 owner。
- 前端测试覆盖输入值进入 `POST /prompt-skill-candidates/bulk-assign` 请求体。

## 执行步骤

1. 先写前端失败测试，要求页面存在负责人和容量控件，并验证请求体带上输入值。
2. 在 `CandidateAssetsPage` 增加 `batchAssignOwner` 与 `batchAssignCapacity` 状态。
3. 用 Ant Design `Input` / `InputNumber` 组织为规则化工具栏控件。
4. 修改批量指派 mutation，发送用户输入的 `owner` 与 `max_open_per_owner`。
5. 同步项目状态和验收矩阵。
6. 执行前端目标测试、typecheck、全量测试、构建和 diff 检查后提交。

## 验收标准

- 目标测试先 RED 后 GREEN。
- 用户能在页面修改负责人和容量。
- 请求体包含用户输入的 `owner` 与 `max_open_per_owner`。
- 项目状态文件记录本次改动、验证命令、测试结果和下一步。
