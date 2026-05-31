# Repair Task Dataset Field Fix Loop 优化计划

## 背景

Task Diagnostics 已经能识别数据质量问题，例如 Workflow 必需字段缺失、字段覆盖不足和重复样本；Repair Task 也会把 `fix_dataset_fields` 放进 next actions。但在本批次之前，用户只能看到“修正数据字段”这类提示，点击 Repair Task 动作会返回不支持，无法知道应该修哪个字段、影响多少样本、应该回到哪个 Dataset Version。

## 本批目标

1. `fix_dataset_fields` 成为真实 Repair Task 动作。
2. 后端返回字段级修复计划，而不是直接静默改写样本。
3. 修复计划包含 Dataset Version、缺失必需字段、字段覆盖、重复样本数、字段级建议和数据集入口。
4. 前端修复任务工作台展示“字段修复计划”按钮。
5. 动作成功后在最近结果里直接展示字段名和修复建议。

## 设计原则

- 不自动改写用户数据：字段缺失往往需要重新导入、业务标注或 Workflow 映射调整，系统不能用猜测值覆盖事实数据。
- 让诊断可执行：用户看到的不再是“修正数据字段”，而是“reference 是 Workflow 必需字段，100 条缺失，需要补列或调整 input_mapping”。
- 沿用 Repair Task action_history：字段计划也是修复动作，必须进入 `action_history` 和 `last_action_result`，后续可追溯。

## 实施步骤

### RED

- 后端测试：数据集缺少 `reference` 时，数据质量 Repair Task 调用 `fix_dataset_fields` 应返回字段修复计划；最初失败为 400 unsupported。
- 前端测试：修复任务工作台应出现“字段修复计划”按钮并展示 `reference` 字段建议；最初失败为找不到按钮。

### GREEN

- `aegisqa/api/routes/tasks.py`
  - 新增 `_repair_action_fix_dataset_fields`。
  - 新增 `_build_dataset_field_fix_actions`。
  - 将 `fix_dataset_fields` 加入 Repair Task 支持动作列表。
  - 数据质量 remediation recommendation 的推荐动作从仅打开 Lineage 升级为 `fix_dataset_fields`。
  - action summary 返回字段修复建议数量。
- `frontend/src/pages/RepairTasksPage.tsx`
  - 按 `next_actions/recommended_action/last_action_result` 展示“字段修复计划”按钮。
  - 最近结果展示字段修复计划、字段名和建议。
- `frontend/src/test/App.test.tsx`
  - 增加字段修复计划 mock 和交互测试。

## 验证

- `python -m pytest tests\test_task_flow_optimization.py -q`
- `cd frontend && npm test -- src/test/App.test.tsx -t "Dataset 字段修复计划"`
- `git diff --check`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`

验证结果：

- 后端 RED：新增测试最初返回 400，确认 `fix_dataset_fields` 动作未接入。
- 前端 RED：新增测试最初找不到“字段修复计划”按钮。
- 后端定向：`tests\test_task_flow_optimization.py` 10 passed。
- 后端全量：75 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
- 前端目标测试：1 passed。
- 前端修复任务工作台：8 passed。
- 前端全量：4 个测试文件、48 tests passed。
- TypeScript、Vite build、Playwright E2E 均通过；Playwright 覆盖 8 条 E2E。

## 后续优化

- 在数据集页提供“从字段修复计划创建新 Dataset Version”的专用向导。
- 将 Workflow 参数类 Repair Task 动作化为参数 diff、回滚和复跑。
- 将 Prompt/Skill 版本类 Repair Task 动作化为版本对比和候选配置沉淀。
