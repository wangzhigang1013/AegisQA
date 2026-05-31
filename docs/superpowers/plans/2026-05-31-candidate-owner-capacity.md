# 候选资产负责人容量限制计划

## 背景

候选资产中心已经支持批量指派、SLA 逾期升级、批量审批、复跑优先级和真实批量复跑，但批量指派仍可能把大量开放候选一次性压到同一个负责人身上。这个问题会让后续复跑、审批和晋升队列产生隐性拥塞。

## 目标

- `POST /prompt-skill-candidates/bulk-assign` 支持 `max_open_per_owner`。
- 批量指派时先统计负责人当前开放候选数量。
- 超出容量的候选不写入 owner / due_at，而是进入 `skipped` 明细。
- 响应返回 `capacity` 摘要，说明指派前后开放候选数量。
- 前端候选资产中心展示容量上限和容量跳过数量。
- 验收矩阵与项目状态同步记录本批次改动。

## 执行步骤

1. 后端先写失败测试，构造负责人已有开放候选、批量指派两个新候选、容量上限为 2 的场景。
2. 实现后端容量校验：非法容量返回结构化错误，达到容量时跳过候选并记录原因。
3. 前端先写失败测试，要求批量指派成功提示包含“容量跳过”。
4. 补齐前端类型、API client 入参和候选资产中心提示。
5. 更新 `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md`。
6. 执行后端、前端、构建、E2E 与 diff 检查后提交。

## 验收标准

- 后端目标测试覆盖 `assigned_count`、`skipped_count`、`capacity.open_before/open_after` 和 `workload.open_count`。
- 前端目标测试覆盖容量跳过提示。
- 全量后端测试、前端测试、构建、Playwright E2E 通过。
- `docs/PROJECT_STATUS.md` 记录本批次改动、文件、验证命令、测试结果和下一步。
