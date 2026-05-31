# Baseline 影响分析与回滚门禁计划

## 背景

上一批已经支持把 Workflow 晋升审批生成的 Experiment baseline 建议应用为当前 baseline，也支持回滚到原 baseline。但用户在执行应用或回滚时仍缺少两个关键证据：

- 应用前不知道会影响哪些同 Dataset/Workflow 的任务、报告和门禁。
- 回滚前没有重新确认旧 baseline 是否仍满足当前 CI Gate。

## 目标

- 为 `experiment_baseline_suggestions` 增加影响分析接口，返回作用域、影响任务、指标 delta、CI Gate 数量和下一步建议。
- 在 baseline 回滚前基于原 baseline 的 Run 重新执行 active/enabled CI Gate，并把结果随回滚响应返回。
- 候选资产中心增加“查看影响”和“回滚 baseline”动作，用户可以看到影响范围、`pass_rate_delta` 和回滚门禁状态。

## 后端设计

- 新增 `GET /experiment-baseline-suggestions/{suggestion_id}/impact`。
- 影响范围按 Dataset + Workflow 作用域筛选 Task。
- 指标变化优先用原 baseline Run 与候选 Run 的 `compare_reports` 结果，确保与复跑对比口径一致；缺少 Run 时退回 Experiment metrics 直接差分。
- 回滚前通过 `_build_baseline_rollback_guard` 读取原 baseline Run，并复用当前 active/enabled CI Gate 配置生成 `ci_gate_evaluations`。
- 如果回滚目标被 blocking 门禁阻断且请求未显式 `force=true`，返回结构化错误，避免把 baseline 回退到已不满足当前发布标准的旧版本。

## 前端设计

- `CandidateAssetsPage` 在 Baseline 替换建议卡片中新增“查看影响”和“回滚 baseline”按钮。
- 影响分析展示影响任务数、报告数、`pass_rate_delta` 和 `badcase_delta`。
- 回滚成功后展示当前 baseline 和 `回滚门禁：passed|blocked|pending_*`。
- API client 和类型定义补齐 `ExperimentBaselineImpact` 与回滚响应的 `rollback_guard`。

## 验收

- 后端目标测试：候选资产复跑主链路中，应用 baseline 后调用 impact 能返回 suggestion、scope、metric_delta、affected_tasks 和 recommendation。
- 后端目标测试：回滚 baseline 后响应包含 `rollback_guard`，其中 CI Gate evaluation 的 source 为 `experiment_baseline_rollback`。
- 前端目标测试：候选资产中心可点击“查看影响”和“回滚 baseline”，并展示影响任务数、指标变化和回滚门禁状态。
- 全量回归保持后端、前端、构建和 Playwright E2E 通过。
