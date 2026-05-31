# Candidate Bulk Retest Execution Plan

## 背景

候选资产中心已经能展示复跑优先级，但用户仍需要逐个点击 ready 候选。候选数量一多，优先级计划只能“告诉用户该做什么”，还不能“帮用户执行可自动执行的部分”。下一步应把复跑计划变成可执行批处理：只自动复跑已经具备条件的候选，其他候选保留跳过原因和下一步入口。

## 目标

- 后端新增 `POST /prompt-skill-candidates/bulk-retest`。
- 请求可指定候选 ID 列表、执行上限和操作者。
- 只复跑 `next_action=retest_candidate` 的候选。
- 对待发布、待建草稿、已复跑或错误候选返回 skipped 明细。
- 复跑记录写入候选资产 `action_history`。
- 前端候选资产中心新增“批量复跑可执行候选”按钮，点击后展示复跑数和跳过数，并刷新候选、任务、实验和复跑计划缓存。

## 实施步骤

1. 后端 RED：
   - 准备一个已发布草稿候选和一个未发布草稿候选。
   - 调用 `POST /prompt-skill-candidates/bulk-retest`。
   - 断言 ready 候选被复跑，未发布候选被跳过。
2. 后端 GREEN：
   - 新增请求模型 `PromptSkillCandidateBulkRetestRequest`。
   - 新增接口 `POST /prompt-skill-candidates/bulk-retest`。
   - 抽出单条复跑公共函数，供单条复跑和批量复跑复用。
   - 写入 audit 和候选 `action_history`。
3. 前端 RED：
   - 候选资产中心应展示“批量复跑可执行候选”按钮。
   - 点击后应展示复跑完成提示。
4. 前端 GREEN：
   - 新增批量复跑返回类型。
   - API client 接入 `bulkRetestPromptSkillCandidates`。
   - 候选资产中心按钮调用接口，成功后刷新缓存并展示反馈。
5. 文档同步与全量验证。

## 验收标准

- 后端目标测试从失败转为通过。
- 前端目标测试从失败转为通过。
- 全量后端、前端、构建、E2E、diff 检查通过。
- `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md` 同步本批状态。
