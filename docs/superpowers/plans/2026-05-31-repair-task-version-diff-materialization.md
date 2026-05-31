# Repair Task Version Diff Materialization Loop

## 背景

上一批已经让 `compare_prompt_skill_versions` 能够把当前 Task 的最新 Run 与同数据集 Experiment baseline 做版本对比，找出 `skill_ref`、`skill_version`、`prompt_version`、`model`、`model_params` 的差异。但当时它仍停留在“给建议”的层面，用户看见候选动作后还需要手工去创建候选资产或复制 Workflow。

本批次目标是把版本对比继续推进为可执行修复流：先把差异沉淀为候选资产，再能一键生成可编辑 Workflow 草稿，最后通过正常发布和复跑流程验证效果。

## 已执行优化

1. 后端新增 `create_prompt_skill_candidate` Repair Task 动作。
   - 读取已保存的 `version_compare_plan`，没有则即时生成版本对比计划。
   - 将 baseline 实验、当前版本、版本 diff、推荐动作保存到 `prompt_skill_candidates`。
   - 重复执行时按 `source_repair_task_id + baseline_experiment_id` 复用候选资产，避免重复堆积。

2. 后端新增 `create_workflow_draft_from_version_diff` Repair Task 动作。
   - 从当前 Run 的 Workflow 图快照创建新草稿。
   - 将 baseline 的 `skill_ref`、`prompt_version`、`model`、`model_params` 回填到对应节点配置。
   - 对 `skill_version` 先写入节点 metadata，避免隐式改写不可控的 Skill 注册状态。
   - 草稿保持 `draft` 状态，不直接发布，必须经过画布检查和正常发布流程。

3. 前端修复任务工作台新增后续动作入口。
   - “版本对比”之后展示“沉淀候选”和“生成草稿”。
   - 动作结果进入历史记录和最近结果区。
   - 修复“沉淀候选后生成草稿按钮消失”的流程断点：前端会同时读取最近动作结果和持久化的 `version_compare_plan.candidate_actions`。

4. 补齐回归测试。
   - 后端覆盖候选资产落库和 Workflow 草稿创建。
   - 前端覆盖版本对比、沉淀候选、生成草稿，以及沉淀后继续生成草稿的连续操作。

## 验证记录

- RED：新增后端测试最初返回 400，确认两个候选动作未接入 Repair Task 动作分发。
- RED：新增前端连续操作测试最初找不到“生成草稿”按钮，确认 `last_action_result` 覆盖导致候选动作丢失。
- GREEN：`python -m pytest tests\test_task_flow_optimization.py -q`，13 passed。
- GREEN：`cd frontend && npm test -- src/test/App.test.tsx -t "版本对比|版本差异"`，3 passed。
- GREEN：`cd frontend && npm test -- src/test/App.test.tsx -t "修复任务工作台"`，13 passed。
- GREEN：`python -m pytest -q`，78 passed。
- GREEN：`cd frontend && npm run typecheck`，通过。
- GREEN：`cd frontend && npm test`，53 passed。
- GREEN：`cd frontend && npm run build`，通过。
- GREEN：`cd frontend && npm run e2e`，8 passed。

## 后续优化

- 增加 `prompt_skill_candidates` 独立资产页，支持按来源任务、Experiment baseline、状态筛选。
- 为候选资产增加审批、废弃、复跑、晋升为 Prompt/Skill 配置的状态机。
- 从候选 Workflow 草稿发布后自动创建同数据集复跑任务，并和 baseline/current 形成三方对比。
- 为版本差异加入成本、延迟、Badcase 类型变化，让用户知道回滚或采纳候选的收益与代价。
