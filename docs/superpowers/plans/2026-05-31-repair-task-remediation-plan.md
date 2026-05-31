# Repair Task Remediation Plan Loop

## 目标

复跑对比已经能回答“修复有没有变好”，但如果结果是 `unchanged`、`mixed` 或 `regressed`，用户还需要知道下一步具体应该改哪里。本批次目标是把复跑结果、诊断根因、弱分层、数据质量和参数治理证据整理成可执行修复建议，并在修复任务工作台直接展示。

## 范围

- 后端 `POST /repair-tasks/{repair_task_id}/actions` 新增 `generate_remediation_plan`。
- 建议生成逻辑读取来源 Task、最新 Run、RunReport、Task Diagnostics、分层分析和参数治理。
- 建议至少覆盖：
  - `annotation`：低通过率分层进入人工审核和 Golden 沉淀。
  - `workflow_parameters`：检查 Prompt、模型参数、task_override、runtime_expression、secret_ref 是否进入当前 Attempt。
  - `dataset`：数据质量问题进入 Dataset Lineage 和字段修正。
  - `retest`：完成修复后再次复跑对比。
- 前端修复任务工作台新增“生成建议”按钮。
- 前端表格新增“最近结果”列，优先展示最近生成的建议标题；没有建议时展示动作摘要。

## 非目标

- 本批次不直接实现 Dataset 字段一键修复。
- 本批次不实现 Workflow 参数 diff/回滚。
- 本批次不实现 Prompt/Skill 配置版本对比页。
- 本批次不引入新的生产数据库迁移。

## 验收标准

- 调用 `generate_remediation_plan` 后返回 `status=completed`、`comparison_status` 和 `recommendations`。
- 对复跑后未改善的 Repair Task，建议中必须包含人工审核、参数治理和再次复跑方向。
- 建议项必须包含 `area`、`title`、`reason`、`target_url`、`action`、`priority` 和 `evidence`。
- 动作结果必须写回 `action_history` 和 `last_action_result`。
- 前端点击“生成建议”后必须有成功反馈，并在列表展示建议标题。
- `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md` 必须同步更新。

## 验证命令

```powershell
git diff --check
python -m pytest tests\test_task_flow_optimization.py -q
cd frontend
npm test -- src/test/App.test.tsx -t "修复任务工作台"
cd ..
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
```

## 后续优化

- 将建议项转为可点击的一键动作，例如创建 Dataset 字段修复任务、Workflow 参数审查任务或 Prompt 修复任务。
- 增加 Workflow 参数 diff/回滚，明确修复前后哪些配置真正进入当前 Attempt。
- 增加 Prompt/Skill 版本对比，判断复跑未改善是否由版本冻结或引用错误导致。
- 把修复建议沉淀为二级 Repair Task，形成多步骤修复树。
