# Repair Task Retest Loop Implementation Plan

## 目标

把 Repair Task 从“触发后续处理动作”继续推进到“修复后可以复跑并证明效果”。用户在完成修复后，不应该再手动跳到任务中心创建 Attempt、执行、打开报告、自己比较指标。

## 实现范围

- 后端 `POST /repair-tasks/{repair_task_id}/actions` 新增 `retest_and_compare`。
- `retest_and_compare` 基于来源任务创建新 Attempt，并立即执行该 Attempt。
- 后端对比来源 RunReport 与新 RunReport，返回：
  - `previous_run_id`
  - `new_run_id`
  - `current_attempt`
  - `comparison_status`
  - `comparison`
- `comparison_status` 使用 `improved / mixed / unchanged / regressed`，避免用户只看到数字不知道结论。
- 动作摘要写入 Repair Task 的 `action_history` 和 `last_action_result`。
- 前端修复任务工作台新增“复跑对比”按钮，成功后刷新任务列表和任务报告缓存。

## 验收标准

- 后端测试证明复跑动作会创建新 Attempt。
- 后端测试证明新 Attempt 会执行并保留前后报告。
- 后端测试证明动作历史能追踪复跑对比。
- 前端测试证明“复跑对比”按钮可点击并展示结果摘要。
- `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md` 同步记录本批次。

## 验证命令

```powershell
python -m pytest tests\test_task_flow_optimization.py -q
python -m pytest -q
cd frontend
npm test -- src/test/App.test.tsx -t "复跑"
npm test -- src/test/App.test.tsx -t "修复任务工作台"
npm run typecheck
npm test
npm run build
npm run e2e
```
