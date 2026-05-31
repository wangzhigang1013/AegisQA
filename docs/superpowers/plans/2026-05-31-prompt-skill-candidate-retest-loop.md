# Prompt/Skill Candidate Retest Loop 执行计划

## 目标

把 Prompt/Skill 候选资产从“审批后生成 Workflow 草稿”推进到“发布候选草稿后，用来源任务的同一 Dataset Version 自动复跑，并和 baseline/current 做三方指标对比”。

## 用户价值

- 用户不需要手工记住候选版本应该拿哪批数据复测。
- 候选 Workflow 必须先发布，避免用未固定草稿产生不可复现结果。
- 报告直接展示 baseline、current、candidate 的通过率、Badcase、P95 等核心指标，帮助判断是否值得晋升。

## 后端步骤

1. 增加后端回归测试：
   - 候选资产生成 Workflow 草稿后，未发布草稿时调用复跑接口必须失败。
   - 发布候选草稿后，复跑接口必须复用来源 Task 的 Dataset Version 和执行配置。
   - 复跑成功后创建候选 Task、候选 Experiment，并返回 baseline/current/candidate 三方指标。
2. 新增 `POST /prompt-skill-candidates/{candidate_id}/retest`：
   - 校验候选资产存在。
   - 校验候选资产已关联 Workflow 草稿。
   - 校验 Workflow 草稿已发布且存在 `published_version_id`。
   - 复用来源 Task 的 Dataset Version、执行参数、评测目标、质量门槛和 Preflight 结果。
   - 创建候选 Task，立即执行底层 Run，并刷新任务状态。
   - 创建候选 Experiment 快照。
   - 聚合 baseline/current/candidate 的 RunReport 并生成对比差异。
   - 更新候选资产状态为 `retested`，记录复跑任务、候选 Run、候选 Experiment、指标卡和对比结果。
3. 支持幂等读取：
   - 候选资产已有 `retest_task_id` 时，不重复创建任务，直接返回已有复跑结果。

## 前端步骤

1. 扩展类型和 API client：
   - 新增 `PromptSkillCandidateRetestResult`、`PromptSkillCandidateScorecard`、`PromptSkillMetricCard`。
   - 新增 `api.retestPromptSkillCandidate(candidateId)`。
2. 扩展候选资产中心：
   - 在候选资产行操作中新增“复跑对比”。
   - 未生成 Workflow 草稿时禁用复跑按钮。
   - 复跑成功后提示候选任务 ID。
   - 页面展示“三方指标对比”卡片，包含 baseline/current/candidate 的通过率、Badcase、P95。
   - 展示 current_to_candidate 与 baseline_to_candidate 的核心 delta。
   - 提供“查看候选任务报告”入口。
3. 扩展前端交互测试：
   - 覆盖审批、生成草稿、复跑对比、三方指标展示。

## 验证命令

```powershell
python -m pytest tests\test_task_flow_optimization.py -q -k "candidate_retest"
python -m pytest tests\test_task_flow_optimization.py -q
cd frontend
npm test -- src/test/App.test.tsx -t "候选资产中心"
npm run typecheck
npm test
npm run build
npm run e2e
```

## 仍需后续增强

- 复跑结果达到门槛后，自动生成“推荐晋升为 Workflow 版本”的待审批动作。
- 候选资产批量审批、批量复跑和批量对比。
- 候选资产负责人、SLA、逾期升级和工作量视图。
- 三方指标增加成本、token、红队风险和分层退化对比。
