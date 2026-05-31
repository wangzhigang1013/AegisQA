# Workflow 晋升发布资产闭环计划

## 背景

候选资产已经可以完成“复跑对比 -> 晋升建议 -> 创建 Workflow 晋升审批 -> 审批通过/拒绝”，但审批通过后仍缺少产品化发布治理资产：用户不知道候选实验是否应成为新 baseline，也不知道该 Workflow 版本是否已经经过 CI Gate 发布门禁评估。

## 实施范围

- 后端在 Workflow 晋升审批通过时自动生成 `experiment_baseline_suggestions`。
- 后端在 Workflow 晋升审批通过时自动生成 `workflow_release_records`。
- 如果已有 active/enabled CI Gate 配置，审批通过后立即用候选复跑 Task 指标生成 `ci_gate_evaluations`，并把结果挂到发布记录。
- 前端候选资产中心新增“通过晋升”动作，成功后展示 Baseline 替换建议与 CI Gate 发布记录。
- 文档和验收矩阵同步记录新增接口、状态和验证命令。

## 数据流

```text
Prompt/Skill Candidate
  -> candidate retest
  -> promotion recommendation
  -> workflow promotion review
  -> approve
  -> experiment_baseline_suggestion
  -> workflow_release_record
  -> ci_gate_evaluations
```

## 接口

- `GET /experiment-baseline-suggestions?candidate_id=&review_id=&status=`
- `GET /workflow-release-records?candidate_id=&review_id=&status=`
- `POST /workflow-promotion-reviews/{review_id}/approve`
  - 返回 `release_artifacts.baseline_suggestion`
  - 返回 `release_artifacts.release_record`
  - 返回 `release_artifacts.ci_gate_evaluations`

## 验收

- hold 候选仍不能创建晋升审批。
- promote/review 候选可创建审批，重复创建幂等返回同一审批。
- 审批通过后候选状态变为 `promoted`。
- 审批通过后生成 baseline 替换建议。
- 审批通过后生成 Workflow 发布记录。
- 存在 CI Gate 配置时自动生成评估历史。
- 前端可从候选资产中心创建晋升审批并通过晋升，页面展示新增资产。

## 验证命令

- `python -m pytest tests\test_task_flow_optimization.py -q -k "candidate_retest"`
- `python -m pytest tests\test_task_flow_optimization.py -q`
- `cd frontend && npm test -- src/test/App.test.tsx -t "候选资产中心"`
- `cd frontend && npm run typecheck`
