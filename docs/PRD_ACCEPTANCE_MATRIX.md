# AegisQA PRD 验收覆盖矩阵

本文按 `AI_Automation_Eval_Workflow_PRD_final(1).md` 的功能编号记录当前实现状态。

## 当前验证命令

```powershell
python -m pytest -q
python -m pytest tests\test_sqlite_store_adapter.py -q
python -m aegisqa.examples.run_mvp_demo
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
Headless Chrome CDP 打开 http://127.0.0.1:5173 并点击核心页面按钮
```

最近一次验证结果：

- 单元/API/扩展测试：`python -m pytest -q` 已通过，覆盖 80 个后端测试点；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
- SQLite 轻量仓储：`python -m pytest tests\test_sqlite_store_adapter.py -q` 已通过，覆盖 SQLiteStore JSON/JSONL 读写、legacy JSON 回退、FastAPI Task 主链路和列表接口。
- 端到端 Demo：最新 Dataset `rag_qa_1000:v13`、Run `run-e46e560e1885`，1000 条 JSONL 样本状态 `completed`，队列消息字段仅 `item_id`，报告 `pass_rate=0.8`、`error_rate=0.0`、Badcase 200 条，Judge 审计输出 Accuracy / Precision / Recall / F1 / Cohen's Kappa / Confusion Matrix。
- 前端：`npm run typecheck`、`npm test`、`npm run build` 已通过；`npm test` 覆盖 54 个交互/API client/图模型/任务创建向导/Preflight/Run Attempts/Dataset Lineage/Trace Tree/Experiment/CI Gate/Annotation Queue/候选资产中心审批/拒绝/生成草稿/复跑对比/三方指标展示、报告评测结论/Repair Task 生成、工作台、动作闭环、复跑对比、上下文修复建议、二级修复任务、修复树进度、负责人指派、逾期提醒、Dataset 字段修复计划、Workflow 参数 diff/回滚计划、Prompt/Skill 版本对比、候选资产沉淀、Workflow 草稿创建/Judge 偏差趋势/治理边界测试；最近一次 Playwright 覆盖 8 条 E2E。
- 浏览器交互：Headless Chrome CDP 验证概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均能打开并展示关键入口。
- Playwright E2E：真实覆盖上传 JSONL 数据集、上传 zip Skill 插件包、运行合约测试、治理启用 Skill、发布 Workflow、创建并执行 Task、查看任务报告、导出报告、Badcase 加入 Golden；同时覆盖 CI Gate 创建配置和阻断评估、Annotation Queue 领取/审核/回流 Golden、批量审核和候选资产摘要，以及 Workflow 画布新增 Source/Skill/Join/Output/Aggregator、聚合策略、创建连线、删除节点、删除下游连线、删除后重连、节点工具栏、键盘删除、撤销/重做、保存草稿回放、试运行回填、校验、发布。
- 产品化增强：Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree、Task Preflight、Repair Task 工作台、动作闭环、复跑对比、上下文修复建议与二级修复任务已有后端 API 测试；首页已展示真实 Dashboard 和产品化增强入口。

## P0 功能覆盖

| 编号 | 需求 | 当前状态 | 证据 |
|---|---|---|---|
| FR-SK-01 | 扫描/注册 Skill manifest 并展示市场 | 已实现 | `aegisqa/skills/registry.py`，`GET /skills`，React `Skill 市场` 页面，测试 `test_skill_registry_loads_example_manifests_and_contracts` |
| FR-SK-02 | config_schema 生成参数表单 | 已实现基础 | Skill manifest 暴露 `config_schema`；React Skill 详情抽屉展示 schema；动态复杂表单仍可增强 |
| FR-SK-03 | input/output schema 强校验 | 已实现 | `aegisqa/core/mapper.py`，`BaseSkill.execute`，TypeMismatch 测试 |
| FR-SK-04 | Skill 版本、作者、依赖、场景、标签 | 已实现 | `SkillManifest` |
| FR-SK-05 | Skill 合约测试入口 | 已实现 | `BaseSkill.contract_test()`，`POST /skills/{skill_id}/contract-test`，React Skill 详情按钮测试；插件包审批前也必须通过合约测试，插件包记录会保存 `last_contract_ok`、`last_contract_result`、`last_contract_at` |
| FR-SK-08 | Skill 插件包上传与审批门禁 | 已实现基础 | `POST /skills/packages/upload`、`GET /skills/packages`、`aegisqa/skills/packages.py`；zip 必须包含 `skill.yaml|skill.json` 和 `handler.py`，默认 `pending_review`，非法 zip 路径会拒绝，插件合约测试默认 5 秒超时并返回 `SKILL_CONTRACT_TIMEOUT`，stdout 超过安全上限返回 `SKILL_PACKAGE_OUTPUT_TOO_LARGE`，运行时 stdout/stderr 会截断并脱敏本地绝对路径，审批记录保存审批人、审批时间和审批备注；测试 `test_skill_package_upload_contract_and_approval_gate`、`test_skill_package_security.py` 和 `test_p0_hardening.py`；Playwright E2E 覆盖真实 zip 上传、合约测试和治理启用 |
| FR-WF-01 | 创建、编辑、复制、发布、归档 Workflow | 已实现基础 | `WorkflowService.publish/copy_workflow/archive`，`POST /workflow-graphs/publish`，`POST/PUT/DELETE /workflow-drafts`，`GET /workflow-drafts/{draft_id}` 单草稿深链加载，React `Workflow 市场` + `Workflow 画布`；市场进入画布会预写单草稿缓存，画布加载完成前显示加载态，避免后台刷新覆盖用户编辑 |
| FR-WF-02 | 线性步骤列表与图形化编排 | 已实现 | `WorkflowDraft` / `WorkflowStep`，`WorkflowGraph` 保留画布快照；前端图模型已独立测试，Inspector 支持节点工具栏、键盘删除、下游连线可视化、选择目标创建连线、删除连线、删除后重连和 Aggregator 聚合策略，Playwright 覆盖 Source/Skill/Join/Output/Aggregator 新增、创建连线、删除节点、删除下游连线、删除后重连、撤销、重做、保存草稿回放、校验、发布 |
| FR-WF-03 | 字段映射与强类型校验 | 已实现 | `resolve_input_mapping`，失败不调用 Skill |
| FR-WF-04 | 试运行 | 已实现基础 | `WorkflowRunner.dry_run` 支持 1-10 条样本，`POST /workflow-graphs/dry-run`，React Console 已接入按钮反馈，Playwright 覆盖选择数据集后试运行回填结果 |
| FR-DS-01 | CSV/JSONL 上传与流式解析 | 已实现 | `DatasetService.upload_dataset`，API `/datasets/upload` 与 `/datasets/from-path`，React 上传弹窗与禁用反馈已测试；空文件、坏 JSONL 行号、空 CSV 均有结构化错误 |
| FR-DS-02 | 数据集版本化 | 已实现 | 同名上传递增版本 |
| FR-DS-03 | 字段类型识别与人工修正 | 已实现基础 | 自动识别 + `DatasetService.correct_field_type` + API 字段修正 |
| FR-DS-04 | Source Skill 机制 | 已实现基础 | `source.csv@0.1.0`、`source.jsonl@0.1.0` manifest，`POST /datasets/source-materialize` |
| FR-DS-05 | Golden Dataset 与人工标签 | 已实现基础 | `golden`、`label_field`、Judge demo |
| FR-DS-06 | rows 按需读取 | 已实现 | `iter_rows` / `iter_row_chunks`，队列消息仅 `item_id` |
| FR-DS-09 | Dataset Lineage | 已实现基础 | `GET /datasets/{dataset_id}/versions/{version}/lineage` 返回来源类型、来源参数、字段路径、预览和下游 Task；React 数据集页提供“查看 Lineage”抽屉 |
| FR-EX-01 | 分片创建 Run Items 与轻量队列 | 已实现 | `WorkflowRunner.create_run`，1000 样本测试；Task API 将 Dataset/Workflow/Run 绑定为一次业务任务；Task 创建保存评测目标、质量门槛和 Preflight 快照；产品语义中 Task 是用户主对象，Run 是底层执行 Attempt |
| FR-EX-02 | 并发控制与外部 API 限速 | 已实现基础 | `InMemoryRateLimiter` 记录等待与限速次数；Redis/Celery 适配待生产化 |
| FR-EX-03 | 失败重试 | 已实现基础 | `retry_failed_items` |
| FR-EX-04 | 断点续跑 | 已实现基础 | 成功 item 不覆盖，失败 item 可重跑 |
| FR-EX-05 | Step 轨迹 | 已实现 | 输入/输出摘要、耗时、异常、指标、cache_hit、限速等待，`GET /runs/{run_id}/trace` |
| FR-RP-01 | Run 指标聚合 | 已实现 | `aggregate_run_report` |
| FR-RP-02 | Skill 输出指标入库 | 已实现 | Item metrics 与 report 聚合 |
| FR-RP-03 | Badcase 明细筛选 | 已实现 | `BadcaseService.filter_badcases`，`GET /badcases` 支持状态、问题类型、原因、Skill、关键词、得分区间 |
| FR-RP-04 | 单次任务报告 | 已实现基础 | API `/tasks/{task_id}/report` 包装任务摘要、版本快照、Step 分布、Judge 分数分布、RunReport、Badcase、导出链接和 Task Diagnostics；React 报告中心围绕 Task 展示“评测结论”第一屏、摘要、版本、指标、根因诊断、Step 分布和 Badcase，并可从诊断一键生成 Repair Task；Playwright E2E 覆盖任务报告查看、导出和 Badcase 加入 Golden |
| FR-ME-01 | Judge Profile 管理 | 已实现基础 | `JudgeProfileService.create_profile/get_profile`，API 已挂载 |
| FR-ME-02 | Golden Dataset 裁判评测 | 已实现 | `audit_judge_profile` 输出 Accuracy/Precision/Recall/F1/Kappa/混淆矩阵 |
| FR-ME-03 | 审计结果入库 | 已实现 | `JudgeProfileService.audit_and_store` |
| FR-HL-01 | Badcase 列表和详情 | 已实现基础 | Report badcases、BadcaseService |
| FR-HL-02 | 人工标签/说明/责任归类 | 已实现 | `correct_badcase`；报告中心支持加入 Golden、忽略、重开、加入 Annotation Queue |
| FR-HL-03 | 加入错题本/Golden 候选 | 已实现基础 | `golden_candidate` 与 `accepted_to_golden` |
| FR-HL-04 | 处理状态流转 | 已实现 | pending_review/corrected/accepted_to_golden/ignored/reopened；React Badcase 表格提供单条状态动作 |
| FR-AU-01 | 敏感配置脱敏 | 已实现 | `redact_secrets`，保留 tokens 成本指标 |
| FR-AU-02 | 运行快照 | 已实现 | Run snapshot 记录 Workflow、Skill、Dataset、Runtime |
| FR-AU-03 | 可信 Skill 来源限制 | 已实现基础 | 只扫描本地可信 manifest，不执行任意上传代码 |

## P1/P2 功能覆盖

| 编号 | 需求 | 当前状态 | 证据 |
|---|---|---|---|
| FR-SK-06 | Skill 启用/禁用/审批/废弃 | 已实现基础 | `SkillRegistry.disable/approve/deprecate`，`POST /skills/{skill_id}/approve|disable|deprecate`，React Skill 市场展示待审批、合约状态、审批人和审批时间；治理页新增审批抽屉展示 Manifest、Schema、测试日志，未通过合约测试的插件不能在前端直接启用 |
| FR-SK-07 | Skill 安全策略声明 | 已实现基础 | `SkillManifest.permissions` |
| FR-WF-05 | 模板化 Workflow | 已实现基础 | `WorkflowTemplateService`，React Workflow 页面提供示例图 |
| FR-WF-06 | DAG/条件分支/并行节点 | 已实现基础 | `DAGWorkflow.execution_levels`、`DAGWorkflowExecutor` 支持条件 `exists/not exists` 和按层并行执行；`WorkflowGraphService` 支持画布 DAG 校验、点对多、多对一 Join/Aggregator 规则；发布前阻断测试覆盖未审批 Skill、多对一缺 Join/Aggregator、Branch 缺条件表达式 |
| FR-DS-07 | DBQuery/API/线上抽样 Source Skill | 已实现基础 | `DBQuerySkill` 支持 sqlite SQL，`APIPullSkill` 支持 file/http JSON rows，`OnlineSampleSkill` 支持抽样 |
| FR-DS-08 | 数据导出 | 已实现基础 | `DatasetService.export_rows` |
| FR-EX-06 | 取消、暂停、恢复 | 已实现基础 | `cancel_run/pause_run/resume_run`，`POST /runs/{run_id}/execute|pause|resume|cancel|retry-failed`，React 执行中心已接入；Task 层已增加 completed/running/canceled 状态机保护 |
| FR-EX-07 | sample_repeat_times | 已实现基础 | Run Item repeat_index 与测试 |
| FR-EX-08 | Step 级 Evaluation Cache | 已实现基础 | cache_key 与 cache_hit 记录 |
| FR-RP-05 | 跨 Run/Task 趋势图 | 已实现基础 | `compare_reports` 输出趋势差值；新增 `GET /score-analytics` 按 Task 聚合通过率、错误率、Badcase、P95 耗时、估算成本和退化任务；React 报告中心展示“跨任务 Score Analytics”；Experiment 页面继续提供 A/B 对比入口 |
| FR-RP-06 | 多次运行聚合视图 | 已实现基础 | `aggregate_repeat_items` 输出多数投票、通过概率、方差、不稳定样本 |
| FR-RP-07 | 报告导出 | 已实现基础 | `export_report_csv`、`export_report_html`，`GET /runs/{run_id}/report/export?file_format=json|csv|html` |
| FR-ME-04 | 裁判偏差分析 | 已实现基础 | `JudgeProfileService.bias_analysis`；新增 `GET /judge-audits/trends` 按 Judge Profile 聚合 Accuracy/Kappa 趋势和低一致性告警；React Judge 审计页展示“Judge 偏差趋势” |
| FR-ME-05 | 人工纠错反哺候选池 | 已实现基础 | `PromptCandidateService` 可从 Badcase 创建 Prompt 优化候选并评审 |
| FR-ME-06 | 多裁判交叉验证 | 已实现基础页面 | `JudgeProfileService.cross_validate`，`POST /judge-cross-validation`，React Judge 审计页提供“多 Judge 一致性”弹窗并展示两两一致率 |
| FR-HL-05 | Badcase 聚类 | 已实现 | `cluster_badcases(method="rule")` 与 `cluster_badcases(method="embedding")` |
| FR-HL-06 | 批量处理与导出 | 已实现基础 | `bulk_correct`、`export_badcases`，`POST /badcases/bulk-correct`，`GET /badcases/export`；报告中心支持勾选多条后批量加入 Golden |
| FR-AU-04 | 角色权限 | 已实现基础 | `AccessControl` |
| FR-AU-05 | 操作审计 | 已实现基础 | `AuditService` |

## 市场对标增强覆盖

| 对标能力 | 当前状态 | 证据 |
|---|---|---|
| Task 一等模型 | 已实现基础 | `GET/POST /tasks`、`POST /tasks/preflight`、`POST /tasks/{task_id}/attempts`、`POST /tasks/{task_id}/execute|pause|resume|cancel|retry-failed`、`GET /tasks/{task_id}/report`、`GET /tasks/{task_id}/trace-tree`；Task 创建保存 `evaluation_goal`、`quality_gate`、`preflight_result` 和 `execution_config`，包含并发、repeat、重试和成本预算；Run Attempts 保留旧 Run 报告快照；前端执行中心默认展示任务列表并使用带 Preflight 的独立创建向导；Playwright E2E 覆盖创建和执行任务 |
| Experiment 快照与 baseline 对比 | 已实现基础页面 | `POST /experiments/from-run`，`GET /experiments?dataset_id=&workflow_id=`，保存 Workflow/Dataset/Skill/Prompt/Runtime 快照与 baseline diff；React `/experiments` 页面展示实验快照列表、Dataset/Workflow 过滤、baseline 选择、A/B 对比面板、通过率、Badcase、P95 耗时、成本和失败分布变化，并支持从 Run 生成实验快照 |
| Prompt / Skill 版本注册 | 已实现基础 | Run snapshot 与 Experiment snapshot 记录 `skill_versions`、`prompt_skill_versions`、模型参数 |
| Assertion DSL | 已实现最小 API | `POST /assertions/evaluate` 支持 contains、regex、json_schema、similarity、latency、cost、safety 的基础断言 |
| CI Gate | 已实现基础页面 | `GET/POST /ci-gates` 支持质量门禁配置保存和列表；`POST /ci-gates/evaluate` 支持按配置和指标阈值 blocking 发布，也支持直接对 Task/Run 抽取指标评估，并保存 `gateeval-*` 历史；`GET /ci-gates/evaluations` 支持按 config、task、run 过滤；React `/ci-gates` 页面支持创建门禁配置、选择 Task/Run 执行评估，并展示阻断原因、实际值、阈值、历史趋势和评估历史；Playwright 覆盖真实创建和阻断评估 |
| Annotation Queue | 已实现基础页面 | `POST /annotation-queue/seed-from-run`、`GET /annotation-queue`、分派、review、`POST /annotation-queue/bulk-review`、`GET /annotation-candidates`；队列记录回填来源 Task，支持状态/负责人/来源任务筛选；React `/annotation-queue` 页面支持领取、分派、审核、批量审核、回流 Golden Dataset 和候选资产摘要；Playwright 覆盖真实领取、审核、批量审核和回流 |
| Prompt/Skill 候选资产治理 | 已实现基础页面 | `GET /prompt-skill-candidates` 支持来源任务、状态、baseline 实验筛选；`POST /prompt-skill-candidates/{candidate_id}/review` 支持 approved/rejected 审批并保留 review_history；`POST /prompt-skill-candidates/{candidate_id}/workflow-draft` 要求候选审批通过后才能创建 Workflow 草稿，未审批返回 `PROMPT_SKILL_CANDIDATE_NOT_APPROVED`；`POST /prompt-skill-candidates/{candidate_id}/retest` 要求候选草稿已发布，随后复用来源 Task 的 Dataset Version 和执行配置创建候选 Task、自动执行、生成候选 Experiment，并返回 baseline/current/candidate 三方指标与 current_to_candidate、baseline_to_candidate delta；React `/candidate-assets` 页面展示候选列表、版本差异、状态筛选、审批通过、拒绝、生成草稿、复跑对比、三方指标卡和候选任务报告入口 |
| Trace Tree | 已实现独立页面 | `GET /runs/{run_id}/trace-tree` 与 `GET /tasks/{task_id}/trace-tree` 展示 Run Item -> Skill Step 输入、输出、耗时、错误、缓存命中；React `/tasks/:taskId/trace-tree` 独立页面展示 Item 调用树 |
| Task 参数治理 | 已实现基础 | `GET /tasks/{task_id}/parameter-governance` 和 Task Report `parameter_governance` 展示 Skill/Prompt 版本、模型参数、任务覆盖和脱敏 Secret 策略 |
| Task Preflight | 已实现基础 | `POST /tasks/preflight` 在创建任务前检查数据集非空、Workflow 字段映射、Golden 覆盖、Skill 审批状态、质量门槛和成本预算；React 任务创建向导支持评测目的、质量门槛和 Preflight 检查表 |
| 质量决策中心 | 已实现基础 | Task Report `quality_decision` 把通过率、错误率、Badcase 和低分层转为 passed/warning/blocked 决策、风险摘要和下一步动作；React 报告中心新增“评测结论”第一屏，先回答“能否发布 / 为什么 / 影响多大 / 下一步” |
| Task Diagnostics 根因诊断 | 已实现基础 | `GET /tasks/{task_id}/diagnostics` 与 Task Report `diagnostics` 汇总运行时错误、低通过率分层、字段缺失/重复、Step 健康度和参数风险；React 报告中心展示主要根因、证据数、根因表、数据质量和修复动作，且 next_actions 已按钮化，可直接进入 Trace Flow、数据血缘、Judge 审计，或调用 Annotation Queue、CI Gate、失败项重试 |
| Repair Task 修复闭环 | 已实现基础 | `POST /tasks/{task_id}/repair-tasks/from-diagnostics` 可把诊断 root cause 沉淀为可追踪修复任务；`GET /repair-tasks?source_task_id=` 支持按来源任务查询；`GET /repair-tasks/{repair_task_id}/tree` 返回父任务、子任务、完成率、阻塞子任务、逾期子任务和下一步动作；`POST /repair-tasks/{repair_task_id}/assign` 支持设置负责人、截止时间、`assigned_at` 和 `overdue`；`POST /repair-tasks/{repair_task_id}/start|resolve|reopen` 支持领取、完成、重开并记录审计，完成任务会清除逾期标记；`POST /repair-tasks/{repair_task_id}/actions` 支持从修复任务发起 Annotation Queue、CI Gate 复测、`retest_and_compare` 复跑对比、`generate_remediation_plan` 上下文修复建议、`create_followup_repair_tasks` 二级修复任务、`fix_dataset_fields` 字段修复计划、`plan_workflow_parameter_changes` 参数 diff/回滚计划、`compare_prompt_skill_versions` Prompt/Skill 版本对比计划、`create_prompt_skill_candidate` 候选资产沉淀和 `create_workflow_draft_from_version_diff` Workflow 草稿创建，并写入 `action_history` 与 `last_action_result`；字段修复计划会返回 Dataset Version、缺失 Workflow 必需字段、字段覆盖率、重复样本数、字段级建议和数据集入口；参数 diff/回滚计划会返回 Workflow 默认值、当前执行值、task_override 移除项、runtime_expression/secret_ref 复核项和参数治理入口；Prompt/Skill 版本对比计划会基于同数据集 Experiment baseline 返回 `skill_ref`、`skill_version`、`prompt_version`、`model`、`model_params` 差异、baseline 候选和候选修复动作；候选资产动作会把 baseline、当前版本和 diff 写入 `prompt_skill_candidates`；Workflow 草稿动作会把 baseline Prompt/模型/Skill 配置回填到新草稿图中但不直接发布；复跑动作会创建新 Attempt、自动执行、对比前后 RunReport，并返回 improved / mixed / unchanged / regressed；修复建议会结合复跑状态、诊断根因、弱分层、数据质量、参数治理风险和版本变化风险，输出 annotation、dataset、workflow_parameters、prompt_skill_versions、retest 等下一步动作；二级任务会保留父任务、推荐动作、目标入口、负责人、截止时间和逾期状态，并重复点击复用已有任务；React 报告中心可一键生成修复任务，`/repair-tasks` 工作台支持筛选、查看证据、指派负责人、查看逾期、领取、完成、重开、发起人工审核、CI Gate 复测、复跑对比、生成修复建议、拆分子任务、字段修复计划、参数 diff/回滚计划、Prompt/Skill 版本对比、沉淀候选、生成 Workflow 草稿、沉淀后继续生成草稿、查看修复树进度、查看动作历史、最近建议和推荐动作入口，并跳回来源报告、Trace、参数治理和数据集页 |
| 成本预算状态 | 已实现基础 | Task Report 新增 `budget_status`，基于报告 cost 或 token 估算成本，输出 ok/warning/exceeded/not_set、预算、已用、剩余和修复建议；React 报告中心展示“成本预算” |
| 红队安全扫描 | 已实现基础 | `POST /red-team/scans` 支持按 Task/Run 做规则化扫描，识别 prompt injection、PII、unsafe content、secret exposure，保存扫描记录并生成下一步建议；React 报告中心提供“运行红队扫描”入口 |
| 产品化入口 | 已实现基础 | React 首页读取真实 Dashboard；Workflow 先进入市场，执行与报告围绕 Task 组织 |

## 生产化边界说明

- 本地默认运行仍使用 JSON 文件仓储和单进程 Runner，便于面试演示和无外部依赖验证；JSON Store 已增加锁文件与原子写入，降低本地多线程/多进程测试时的文件损坏风险，但不提供事务、索引、权限隔离、分布式一致性或高可用能力。
- 已新增 SQLite 轻量元数据仓储，可通过 `create_app(..., storage_backend="sqlite")` 或 `AEGISQA_STORAGE_BACKEND=sqlite` 启用；Task、Run、Workflow、Judge、审计等 JSON 文档进入 SQLite，Dataset rows、上传文件和 Skill 插件包仍保留本地文件路径，适合单机长期试用和小团队验证。
- 产品主线以 Task 为中心；Run 是底层执行 Attempt，用于承载 Run Item、Step Trace、队列消息和报告快照。前端执行中心、报告中心、Annotation 和 CI Gate 都应优先通过 Task 入口组织用户流程。
- Skill 插件包执行默认走受控子进程，不在主 FastAPI 进程中直接 import 用户代码；当前已具备审批门禁、5 秒默认超时、stdout 输出上限、日志截断和本地路径脱敏，生产环境仍需补进程级 CPU/内存限额、依赖隔离和签名校验。
- 生产适配资产已提供：`docker-compose.yml`、`infra/mysql/schema.sql`、`infra/celery/README.md`、`aegisqa/workers/celery_app.py`、`aegisqa/infrastructure/manifest.py`。
- MySQL/Redis/Celery 生产服务需要在目标环境中安装依赖并启动容器后接入真实 Repository/Worker；当前测试验证了 schema、消息契约和 Worker 入口，而不是启动外部服务。
- DBQuery 当前真实执行 sqlite，MySQL 连接池是生产 Repository/Skill Adapter 的自然扩展点；API Pull 支持 file/http JSON rows，企业认证和分页策略可在 config 中继续扩展。
- DAG 执行器已支持条件和按层并行；React Flow 可视化画布已提供产品化入口。复杂表达式语言、企业级调度和真实分布式 Worker 仍属于后续生产增强。
