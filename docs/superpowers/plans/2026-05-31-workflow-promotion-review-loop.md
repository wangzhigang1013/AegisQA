# Workflow Promotion Review Loop 执行计划

## 目标

把候选资产的 `create_promotion_review` 从“下一步动作标签”接成真实治理闭环：复跑结果建议晋升后，用户可以创建 Workflow 晋升审批，审批通过后候选资产进入 `promoted` 状态，并记录被晋升的 Workflow Version。

## 后端设计

- `GET /workflow-promotion-reviews`：按候选资产或状态查询晋升审批。
- `POST /prompt-skill-candidates/{candidate_id}/promotion-review`：
  - 候选资产必须已复跑并拥有 `promotion_recommendation`。
  - `decision=hold` 时阻止创建，返回 `PROMPT_SKILL_CANDIDATE_PROMOTION_NOT_RECOMMENDED`。
  - `decision=promote|review` 时创建 `workflow_promotion_reviews` 记录。
  - 审批记录包含 candidate、来源 Task、候选 Run、候选 Experiment、候选 Workflow Version、当前 Workflow Version、三方指标、对比结果、晋升建议和目标 URL。
  - 重复调用同一候选资产时幂等返回已有审批。
- `POST /workflow-promotion-reviews/{review_id}/approve|reject`：
  - 审批通过后候选资产状态改为 `promoted`，写入 `promoted_workflow_version_id`。
  - 拒绝后候选资产状态改为 `promotion_rejected`。
  - 所有动作写入审计日志。

## 前端设计

- 候选资产中心在“晋升建议”中把 `create_promotion_review` 渲染成真实按钮。
- 点击后调用后端 API，成功后展示“晋升审批已创建”。
- 页面展示最近晋升审批卡片：审批单号、状态、候选版本、当前版本和 Workflow 市场入口。

## TDD 验收

- 后端 RED：候选资产复跑后调用 `/promotion-review` 先返回 404。
- 后端 GREEN：hold 阻止创建，promote 创建审批，列表可查，重复创建幂等，审批通过后候选资产变为 `promoted`。
- 前端 RED：页面找不到可点击的“创建 Workflow 晋升审批”按钮。
- 前端 GREEN：按钮可点击，成功反馈和审批卡片出现。

## 后续增强

- 将 Workflow 市场按 `workflow_version_id` 高亮定位到被晋升版本。
- 增加批量晋升审批与负责人 SLA。
- 晋升通过后自动生成 Experiment baseline 替换建议和 CI Gate 发布记录。
