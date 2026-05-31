# Repair Task Prompt/Skill Version Compare Loop

## 背景

当前 Repair Task 已能处理 Dataset 字段修复和 Workflow 参数 diff/回滚，但 Prompt、Skill、模型版本变化仍停留在 Experiment 快照中。用户看到任务退化时，仍需要手工打开实验中心、翻 baseline、再判断当前 Workflow 是否偏离历史高质量配置。

## 目标

- 在 Repair Task 工作台新增 `compare_prompt_skill_versions` 动作。
- 后端基于来源 Task 的最新 Run 和同数据集 Experiment baseline 生成 Prompt/Skill 版本差异。
- 前端提供“版本对比”按钮，并在最近结果中直接展示 `step.field`、baseline 值、当前值和建议动作。
- 版本对比只生成计划和候选动作，不直接回滚或发布 Workflow，避免破坏评测可复现性。

## TDD 计划

1. RED：新增后端测试，先创建 baseline Experiment，再用不同 `prompt_version` 的 Workflow 创建 Task，调用 `compare_prompt_skill_versions` 应返回版本差异。
2. RED：新增前端测试，修复任务工作台应出现“版本对比”按钮，点击后展示 Prompt/Skill 差异。
3. GREEN：实现后端 action、版本清单、baseline 候选和推荐动作。
4. GREEN：实现前端按钮和结果摘要。
5. 全量验证后同步项目状态、PRD 验收矩阵和交互矩阵。

## 实现原则

- 同数据集 Experiment 才能作为 baseline 候选，避免跨业务线误比较。
- 对比字段先覆盖 `skill_ref`、`skill_version`、`prompt_version`、`model`、`model_params`。
- 历史 Run 引用已下线 Skill 时，版本清单返回 `unknown`，保证修复任务仍可解释。
- 推荐动作只返回候选，例如沉淀 Prompt/Skill 候选配置或从版本差异创建 Workflow 草稿。

## 验证命令

```powershell
python -m pytest tests\test_task_flow_optimization.py -q
cd frontend
npm test -- src/test/App.test.tsx -t "Prompt 和 Skill 版本对比"
npm test -- src/test/App.test.tsx -t "修复任务工作台"
```

最终还需要运行：

```powershell
git diff --check
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
```

## 验证结果

- 后端定向：12 passed。
- 后端全量：77 passed；Windows `.pytest_cache` 仍有缓存目录警告，不影响结果。
- 前端 Prompt/Skill 版本对比目标测试：1 passed。
- 前端修复任务工作台目标测试：10 passed。
- 前端全量：4 个测试文件、50 passed。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- Playwright E2E：8 passed。
- 过程中发现 Workflow 撤销/重做用例在全量负载下偶发触达 10 秒默认超时；单独复现通过，已把该已知重渲染重用例单独放宽到 20 秒，并重新跑前端全量通过。

## 后续优化

- 将 `create_prompt_skill_candidate` 接为真实候选资产落库。
- 将 `create_workflow_draft_from_version_diff` 接为一键生成 Workflow 草稿。
- 在 Experiment 页面增加从 Repair Task 深链进入的高亮 baseline 对比视图。
