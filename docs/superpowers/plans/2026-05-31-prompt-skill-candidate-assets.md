# Prompt/Skill Candidate Assets Governance

## 背景

Repair Task 已经可以从 Prompt/Skill 版本差异生成 `prompt_skill_candidates`，但候选资产还没有独立入口。用户如果离开修复任务工作台，就无法集中查看候选、审批候选、拒绝候选，或从候选继续生成 Workflow 草稿。

本批次补齐“候选资产治理”层，让版本差异不只是一次动作结果，而是可以被团队审查和沉淀的资产。

## 已执行优化

1. 后端新增候选资产 API。
   - `GET /prompt-skill-candidates` 支持按 `source_task_id`、`status`、`baseline_experiment_id` 筛选。
   - `POST /prompt-skill-candidates/{candidate_id}/review` 支持 `approved` / `rejected` 审批结论，并保留 reviewer、note、reviewed_at 和 review_history。
   - `POST /prompt-skill-candidates/{candidate_id}/workflow-draft` 要求候选先审批通过，再从候选版本 diff 创建 Workflow 草稿。

2. 后端收紧候选状态机。
   - 未审批候选创建草稿会返回 `PROMPT_SKILL_CANDIDATE_NOT_APPROVED`。
   - 草稿创建后候选状态进入 `draft_created`，并记录 `workflow_draft_id`。
   - 重复创建草稿时返回已有草稿，避免资产重复。

3. 前端新增候选资产中心。
   - 新增导航和路由 `/candidate-assets`。
   - 页面展示 Prompt/Skill 候选配置、状态、来源任务、baseline experiment、版本差异。
   - 支持状态筛选、审批通过、拒绝和生成 Workflow 草稿。

## 验证记录

- RED：后端新增测试最初访问 `GET /prompt-skill-candidates` 返回非列表，确认 API 缺失。
- RED：前端新增测试最初 `/candidate-assets` 无路由，页面找不到“候选资产中心”。
- GREEN：`python -m pytest tests\test_task_flow_optimization.py -q`，14 passed。
- GREEN：`cd frontend && npm test -- src/test/App.test.tsx -t "候选资产中心|修复任务工作台"`，14 passed。
- GREEN：`cd frontend && npm run typecheck`，通过。

## 后续优化

- 为候选资产增加“复跑任务”向导：从草稿发布后的 Workflow Version 自动创建同 Dataset 对比任务。
- 在候选资产中心展示 baseline/current/候选三方指标对比。
- 为 Prompt/Skill 候选增加负责人、审批 SLA、批量审批和过期归档。
