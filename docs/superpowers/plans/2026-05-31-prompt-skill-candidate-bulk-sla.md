# 候选资产批量治理与 SLA 计划

## 背景

候选资产中心已经能完成单条审批、生成草稿、复跑、晋升审批、baseline 应用和回滚。但团队使用时会遇到三个协作断点：

- 候选资产积累后只能逐条审批，处理效率低。
- 候选资产没有负责人和截止时间，无法判断谁在处理、是否逾期。
- 逾期候选没有升级动作，容易卡住修复和发布流程。

## 目标

- 增加候选资产批量审批接口，支持一次性通过或拒绝一批候选。
- 增加批量指派接口，写入负责人、截止时间、指派人和动作历史。
- 增加负责人工作量接口，按 owner 聚合待处理、逾期和已升级数量。
- 增加逾期升级接口，把超过 SLA 的候选标记为 `escalated` 并写入审计。
- 前端候选资产中心展示负责人工作量，并提供“指派当前列表”“批量审批当前列表”“升级逾期候选”动作。

## 后端设计

- `GET /prompt-skill-candidates/workload`
- `POST /prompt-skill-candidates/bulk-assign`
- `POST /prompt-skill-candidates/bulk-review`
- `POST /prompt-skill-candidates/escalate-overdue`

候选资产新增轻量字段：

- `owner`
- `due_at`
- `assigned_by`
- `assigned_at`
- `overdue`
- `escalation_status`
- `escalated_by`
- `escalated_at`
- `action_history`

## 前端设计

- 候选资产中心顶部新增“负责人工作量”卡片。
- 工作量卡片展示候选数、待处理数、逾期数、已升级数，以及 owner 分布。
- 当前列表可以批量指派给 `qa_owner`，也可以批量审批。
- “升级逾期候选”调用后端扫描当前逾期候选，升级后刷新工作量和候选列表。
- 表格新增“负责人/SLA”列，展示 owner、截止时间、逾期和已升级标签。

## 验收

- 后端测试覆盖批量指派、逾期判断、工作量聚合、逾期升级、批量审批和 review history。
- 前端测试覆盖负责人工作量展示、批量指派、逾期升级和批量审批当前列表。
- 全量后端、前端、构建和 E2E 保持通过。
