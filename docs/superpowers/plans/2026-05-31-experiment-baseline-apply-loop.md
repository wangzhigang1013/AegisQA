# Experiment Baseline 应用与回滚闭环计划

## 背景

上一批已经在 Workflow 晋升审批通过后生成 `experiment_baseline_suggestions`。但建议如果不能被正式应用，就仍然只是提示，无法成为后续 Experiment、CI Gate、候选资产复跑的可信基准。

## 实施范围

- 新增 `experiment_baselines` 轻量记录，按 Dataset + Workflow 维护当前 baseline。
- 新增 baseline 建议应用接口，把候选实验正式设为当前 baseline。
- 新增 baseline 建议回滚接口，把当前 baseline 回退到建议记录里的原 baseline。
- Baseline 每次 apply/rollback 都写入 `history`，保留 actor、note、from/to experiment。
- 候选资产中心在 Baseline 替换建议卡片里提供“应用 baseline”按钮，并展示当前 baseline。

## 接口

- `GET /experiment-baselines?dataset_id=&workflow_id=`
- `POST /experiment-baseline-suggestions/{suggestion_id}/apply`
- `POST /experiment-baseline-suggestions/{suggestion_id}/rollback`

## 验收

- 应用建议后 suggestion 状态变为 `applied`。
- 应用建议后 baseline 当前实验变为候选实验。
- Baseline history 记录 apply 动作。
- 回滚后 suggestion 状态变为 `rolled_back`。
- 回滚后 baseline 当前实验恢复为原 baseline。
- 前端点击“应用 baseline”后展示成功反馈和当前 baseline。

## 验证命令

- `python -m pytest tests\test_task_flow_optimization.py -q -k "candidate_retest"`
- `cd frontend && npm test -- src/test/App.test.tsx -t "候选资产中心"`
