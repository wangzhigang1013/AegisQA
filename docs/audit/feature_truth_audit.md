# AegisQA Feature Truth Audit

生成日期：2026-06-03

本审计用于 reality-first rebuild：优先确认功能是否真实接入运行数据、持久化、阻断和测试。结论采用 `keep`、`rewrite`、`hide`、`delete`、`feature_flag`。

| Feature | Current UI | Current API | Persistence | Uses Real Runtime Data | Has Blocking Effect | Has Tests | Is Mock/Placeholder | Decision | Reason | Required Fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dataset | Yes | Yes | Yes | Yes | No | Yes | No | keep | CSV/JSONL、版本、字段推断、lineage 和 chunk 读取属于核心链路。 | 明确版本不可变，后续接 ArtifactStore/Object Storage。 |
| Skill Market / Skill Upload / Skill Approval | Yes | Yes | Yes | Partly | Yes | Yes | No | keep | 上传、合约测试、审批和子进程执行已经真实接入。 | 升级 Skill Package Spec v1、Prompt Registry、Sandbox Lite。 |
| Workflow Market / Workflow Designer / Workflow Publish | Yes | Yes | Yes | Yes | Yes | Yes | No | keep | 草稿、画布、校验、试运行、发布是核心链路。 | 发布版本锁定 Skill Version，继续强化 schema mapping。 |
| Task Center / Run / RunItem / Step | Yes | Yes | Yes | Yes | Yes | Yes | No | keep | Task/Run/RunItem/Step 是真实执行模型。 | Step 增加 resolved/raw/validated/prompt call trace 和 replay。 |
| Preflight | Yes | Yes | Yes | Yes | Yes | Yes | No | keep | Task 创建前已能阻断字段、Skill、参数和预算问题。 | 迁移到底层 GateEvaluator，避免独立门禁逻辑分叉。 |
| Trace Tree | Yes | Yes | Yes | Yes | No | Yes | No | keep | 已基于 RunItem/Step 展示执行轨迹。 | 展示 resolved_input、raw_output、validated_output、LLM calls。 |
| Trace Flow | Yes | Yes | Yes | Yes | No | Yes | No | keep | 已展示样本级数据流和参数来源。 | 接入 Prompt Call Trace 和 Gate Evaluation Trace。 |
| Report Center | Yes | Yes | Yes | Yes | No | Yes | Partly | rewrite | 报告使用真实 Run，但部分质量/成本/建议容易被误解为真实门禁。 | 没有 QualityCheckResult/LLM token usage 时显示 unavailable/skipped。 |
| Badcase | Yes | Yes | Yes | Yes | No | Yes | No | keep | Badcase 可从失败样本和报告明细进入人工处理。 | Badcase source 统一为 step/quality_check/gate_rule/annotation 并保存 evidence。 |
| Quality Detection / Quality Decision | Yes | Partly | Partly | Partly | Partly | Yes | Partly | rewrite | 当前质量结论更像报告总结，不是统一规则执行结果。 | 新增 QualityCheckResult，所有结论必须来自规则和 evidence。 |
| Quality Gate | Yes | Partly | Partly | Partly | Partly | Yes | Partly | rewrite | 质量门槛已参与 Preflight，但未统一成 GateEvaluator。 | 统一为 GateEvaluator(target_type=task_create/run_complete/workflow_publish)。 |
| CI Gate | Yes | Yes | Yes | Partly | Partly | Yes | Partly | feature_flag | 高级治理入口容易让用户认为生产阻断已完整。 | 默认隐藏；启用前必须接 GateEvaluator 并证明 blocking rule failed 会阻断。 |
| Experiment | Yes | Yes | Yes | Partly | No | Yes | Partly | feature_flag | 快照和 diff 基础存在，但统计检验和 changed cases 不完整。 | 默认隐藏；补 baseline/candidate diff、changed cases 和 regression 判定后再开放。 |
| Repair Task | Yes | Yes | Yes | Partly | No | Yes | Partly | feature_flag | 当前动作闭环较多，但并非每个动作都产生真实 artifact/patch。 | 默认隐藏；保留 Save badcase/Add to Golden 等真实动作。 |
| Candidate Assets | Yes | Yes | Yes | Partly | Partly | Yes | Partly | feature_flag | 候选治理复杂，第一阶段不应占主链路。 | 默认隐藏；恢复前要求真实 Skill/Prompt/Workflow 引用、回归和回滚。 |
| Annotation Queue | Yes | Yes | Yes | Yes | No | Yes | No | feature_flag | 真实队列能力存在，但属于高级治理，不放第一阶段主导航。 | 默认隐藏；可在 Governance/Experimental 中开启。 |
| Judge Audit | Yes | Yes | Yes | Yes | No | Yes | No | feature_flag | 指标计算真实，但依赖真实 Golden/Judge 数据，第一阶段降为实验能力。 | 默认隐藏；页面必须突出依赖 expected/predicted 明细。 |
| Assertion DSL | Partial | Yes | No | Yes | Yes | Yes | No | keep | 基础断言是真实规则能力，可作为 QualityCheck 规则来源。 | 接入 GateEvaluator 和持久化规则记录。 |
| Governance / Audit | Yes | Yes | Yes | Yes | Partly | Yes | Partly | rewrite | 审计真实存在，但复杂治理不应暗示企业审批已完成。 | 第一阶段只保留 Skill、Workflow、Model Alias、Prompt、Task、Report export 审计。 |
| Cost Budget | Yes | Partly | Yes | No | Partly | Yes | Partly | rewrite | 当前没有 LLM Gateway token usage，不能展示真实成本。 | 没有 token usage 时显示 unavailable；仅展示 rows/skill calls 估算。 |
| Red Team / Safety Scan | Yes | Yes | Yes | Yes | No | Yes | No | feature_flag | 规则扫描可复现，但属于安全高级能力。 | 默认不放主线；接入 QualityCheckResult 后再恢复入口。 |
