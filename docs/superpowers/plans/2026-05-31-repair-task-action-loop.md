# Repair Task Action Loop Implementation Plan

## 目标

把 Repair Task 从“可领取、可完成”的工作项，继续升级为“能直接触发后续修复动作并留下证据”的闭环入口。

本批次聚焦两类高价值动作：

- 从修复任务发起 Annotation Queue，把低分、失败或风险样本交给人工复核。
- 从修复任务执行 CI Gate 复测，把质量门槛结果写成可追踪评估记录。

## 实现范围

- 后端新增 `POST /repair-tasks/{repair_task_id}/actions`。
- 新增 `RepairTaskActionRequest`，支持 `action`、`assignee`、`limit`。
- Repair Task 记录新增 `action_history` 与 `last_action_result`。
- 前端修复任务工作台新增动作按钮：
  - 发起人工审核
  - CI Gate 复测
  - 参数治理入口
- 工作台展示动作历史，避免用户不知道某个根因是否已经被处理过。

## 验收标准

- 后端测试证明修复任务动作能创建 Annotation 样本。
- 后端测试证明修复任务动作能创建 CI Gate evaluation。
- 前端测试证明动作按钮可点击并展示成功反馈。
- `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md` 同步记录本批次。

## 验证命令

```powershell
python -m pytest tests\test_task_flow_optimization.py -q
python -m pytest -q
cd frontend
npm run typecheck
npm test -- src/test/App.test.tsx -t "修复任务工作台"
npm test
npm run build
npm run e2e
```
