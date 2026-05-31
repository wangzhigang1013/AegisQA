# Repair Task Workflow Parameter Diff Loop 优化计划

## 背景

Task Diagnostics 已经能识别 `task_override`、`runtime_expression`、`secret_ref` 等参数风险，Repair Task 也能跳到参数治理页。但在本批次之前，用户只能“去看参数治理”，不能直接知道哪个节点、哪个参数和 Workflow 默认配置不同，也没有明确的回滚或发布新版本建议。

## 本批目标

1. `plan_workflow_parameter_changes` 成为真实 Repair Task 动作。
2. 后端返回参数级 diff，而不是只返回参数治理页面链接。
3. diff 包含 step、skill、parameter、source、当前执行值、Workflow 默认值、task_override 值和推荐动作。
4. 回滚计划包含可移除的 task_override 项，以及需要复核的 runtime_expression 和 secret_ref。
5. 前端修复任务工作台展示“参数 diff/回滚”按钮，并在最近结果中直接展示参数差异。

## 设计原则

- 不自动修改 Workflow：参数变更会影响评测可复现性，必须先生成可审阅计划，再由用户决定重建 Task 或发布新 Workflow 版本。
- 以 Run 证据为准：最终参数来自 Run Step 的 `parameter_trace`，而不是只看任务创建时的表单输入。
- 保留参数安全边界：secret 只展示脱敏引用，回滚计划只提示复核 `secret_ref`，不输出明文。

## 实施步骤

### RED

- 后端测试：带 `skill_overrides.answer.model` 的任务生成 `parameter_risk` Repair Task 后，调用 `plan_workflow_parameter_changes` 应返回参数 diff 和回滚计划；最初失败为 400 unsupported。
- 前端测试：修复任务工作台应出现“参数 diff/回滚”按钮并展示 `answer.model`、当前值和建议；最初失败为找不到按钮。

### GREEN

- `aegisqa/api/routes/tasks.py`
  - 新增 `_repair_action_plan_workflow_parameter_changes`。
  - 新增 `_build_workflow_parameter_diffs`。
  - 将 `plan_workflow_parameter_changes` 加入 Repair Task 支持动作列表。
  - 参数风险 remediation recommendation 从单纯打开参数治理升级为生成参数 diff/回滚计划。
  - action summary 返回参数 diff 数量。
- `aegisqa/reports/diagnostics.py`
  - 参数风险 root cause 的 next actions 增加 `plan_workflow_parameter_changes`。
- `frontend/src/pages/RepairTasksPage.tsx`
  - 按 `next_actions/recommended_action/last_action_result` 展示“参数 diff/回滚”按钮。
  - 最近结果展示参数 diff、当前值、Workflow 默认值和建议。
- `frontend/src/test/App.test.tsx`
  - 增加参数 diff mock 和交互测试。

## 验证结果

- `python -m pytest tests\test_task_flow_optimization.py -q`：11 passed。
- `cd frontend && npm test -- src/test/App.test.tsx -t "Workflow 参数 diff"`：1 passed。
- `cd frontend && npm test -- src/test/App.test.tsx -t "修复任务工作台"`：9 passed。
- `git diff --check`：通过，仅有 Windows CRLF 提示。
- `python -m pytest -q`：76 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
- `cd frontend && npm run typecheck`：通过。
- `cd frontend && npm test`：4 个测试文件、49 tests passed。
- `cd frontend && npm run build`：通过。
- `cd frontend && npm run e2e`：8 passed。

## 后续优化

- 将 Prompt/Skill 版本类 Repair Task 动作化为版本对比和候选配置沉淀。
- 在 Workflow 市场提供“从参数 diff 创建新草稿”的入口。
- 为参数 diff 增加跨 Attempt 对比，标出本次复跑是否真正使用了修复后的配置。
