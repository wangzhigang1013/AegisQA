# Baseline 变更订阅提醒计划

## 背景

Experiment baseline 已经支持应用、影响分析、回滚和回滚前 CI Gate 复测。但团队协作里还有一个断点：baseline 切换以后，评测负责人、候选资产负责人和发布负责人没有一个可追踪的提醒记录，容易出现“报告基线已经变了，但任务负责人还按旧基线判断”的问题。

## 目标

- baseline apply 时自动生成变更提醒。
- baseline rollback 时自动生成回滚提醒，并带上回滚门禁状态。
- 提醒记录包含影响任务数、报告数、指标 delta、接收人、影响任务 ID。
- 提供提醒列表查询和确认已读接口。
- 前端候选资产中心展示最近 baseline 变更提醒，并允许确认已读。

## 后端设计

- `GET /baseline-change-notifications`
- `POST /baseline-change-notifications/{notification_id}/ack`
- apply/rollback 响应增加 `notifications`。
- 通知记录写入 `baseline_change_notifications`，字段包括：
  - `notification_id`
  - `baseline_id`
  - `suggestion_id`
  - `action`
  - `status`
  - `actor`
  - `scope`
  - `from_experiment_id`
  - `to_experiment_id`
  - `recipients`
  - `affected_task_ids`
  - `summary`
  - `message`

## 前端设计

- 候选资产中心新增“Baseline 变更提醒”卡片。
- 从 apply/rollback 响应和未读提醒接口合并提醒。
- 展示应用/回滚、未读/已确认、消息、接收人、影响任务数和回滚门禁状态。
- “确认已读”调用后端 ack 接口，并刷新提醒列表。

## 验收

- 后端测试覆盖 baseline apply 生成提醒、列表查询、确认已读、rollback 生成提醒。
- 前端测试覆盖应用 baseline 后展示提醒、确认已读反馈、回滚门禁提醒。
- 全量后端、前端、构建和 E2E 保持通过。
