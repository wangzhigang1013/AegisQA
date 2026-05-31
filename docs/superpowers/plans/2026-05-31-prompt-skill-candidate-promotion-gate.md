# Prompt/Skill Candidate Promotion Gate 执行计划

## 目标

在候选资产复跑之后，自动给出“是否建议晋升为 Workflow 版本”的解释性判断，避免用户只看到 baseline/current/candidate 指标却不知道下一步该做什么。

## 设计

后端在 `POST /prompt-skill-candidates/{candidate_id}/retest` 响应中新增 `promotion_recommendation`：

- `decision`：`promote`、`review`、`hold`。
- `summary`：一句话解释是否建议晋升。
- `thresholds`：来源 Task 的质量门槛，例如通过率和 Badcase 上限。
- `checks`：逐条检查通过率门槛、Badcase 门槛、相对当前版本改善、相对 baseline 是否退化。
- `next_actions`：下一步动作，例如创建 Workflow 晋升审批、查看候选任务报告、继续修复。

前端候选资产中心在三方指标对比下方展示“晋升建议”：

- 明确展示建议晋升、建议复核或暂不晋升。
- 展示每条门禁检查的中文解释。
- 展示推荐下一步动作。

## TDD 验收

1. 后端先新增失败测试：
   - 复跑返回 `promotion_recommendation`。
   - 当前测试数据没有改善且未达门槛，决策应为 `hold`。
   - 检查项包含通过率失败、当前版本改善不足、下一步动作。
   - 候选资产记录持久化该建议。
   - 再次复跑同一候选资产时，幂等返回同一建议。
2. 前端先新增失败测试：
   - 复跑对比成功后页面展示“晋升建议”。
   - 展示建议晋升摘要和下一步动作。
3. 实现后跑目标测试、全量后端、前端 typecheck/test/build/E2E。

## 后续增强

- 把 `create_promotion_review` 从建议动作接成真实审批/治理任务。
- 支持批量候选资产复跑后自动排序推荐。
- 将成本、红队风险、分层退化纳入晋升门禁。
