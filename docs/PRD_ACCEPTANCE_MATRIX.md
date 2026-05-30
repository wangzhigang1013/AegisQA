# AegisQA PRD 验收覆盖矩阵

本文按 `AI_Automation_Eval_Workflow_PRD_final(1).md` 的功能编号记录当前实现状态。

## 当前验证命令

```powershell
python -m pytest -q
python -m aegisqa.examples.run_mvp_demo
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
Headless Chrome CDP 打开 http://127.0.0.1:5173 并点击核心页面按钮
```

最近一次验证结果：

- 单元/API/扩展测试：`36 passed`。
- 端到端 Demo：最新 Dataset `rag_qa_1000:v6`、Run `run-9311b164dd1f`，1000 条 JSONL 样本状态 `completed`，队列消息字段仅 `item_id`，报告 `pass_rate=0.8`、`error_rate=0.0`、Badcase 200 条，Judge 审计输出 Accuracy / Precision / Recall / F1 / Cohen's Kappa / Confusion Matrix。
- 前端：`npm run typecheck`、`npm test`、`npm run build`、`npm run e2e` 已通过；`npm test` 覆盖 25 个交互/API client/图模型/任务创建向导/Run Attempts 测试，Playwright 覆盖 6 条 E2E。
- 浏览器交互：Headless Chrome CDP 验证概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均能打开并展示关键入口。
- Playwright E2E：真实覆盖上传 JSONL 数据集、上传 zip Skill 插件包、运行合约测试、治理启用 Skill、发布 Workflow、创建并执行 Task、查看任务报告、导出报告、Badcase 加入 Golden；同时覆盖 Workflow 画布新增 Source/Skill/Join/Output/Aggregator、聚合策略、创建连线、删除节点、删除下游连线、节点工具栏、键盘删除、撤销/重做、保存草稿回放、试运行回填、校验、发布。
- 产品化增强：Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 已有后端 API 测试；首页已展示真实 Dashboard 和产品化增强入口。

## P0 功能覆盖

| 编号 | 需求 | 当前状态 | 证据 |
|---|---|---|---|
| FR-SK-01 | 扫描/注册 Skill manifest 并展示市场 | 已实现 | `aegisqa/skills/registry.py`，`GET /skills`，React `Skill 市场` 页面，测试 `test_skill_registry_loads_example_manifests_and_contracts` |
| FR-SK-02 | config_schema 生成参数表单 | 已实现基础 | Skill manifest 暴露 `config_schema`；React Skill 详情抽屉展示 schema；动态复杂表单仍可增强 |
| FR-SK-03 | input/output schema 强校验 | 已实现 | `aegisqa/core/mapper.py`，`BaseSkill.execute`，TypeMismatch 测试 |
| FR-SK-04 | Skill 版本、作者、依赖、场景、标签 | 已实现 | `SkillManifest` |
| FR-SK-05 | Skill 合约测试入口 | 已实现 | `BaseSkill.contract_test()`，`POST /skills/{skill_id}/contract-test`，React Skill 详情按钮测试；插件包审批前也必须通过合约测试 |
| FR-SK-08 | Skill 插件包上传与审批门禁 | 已实现基础 | `POST /skills/packages/upload`、`GET /skills/packages`、`aegisqa/skills/packages.py`；zip 必须包含 `skill.yaml|skill.json` 和 `handler.py`，默认 `pending_review`，非法 zip 路径会拒绝，插件合约测试默认 5 秒超时并返回 `SKILL_CONTRACT_TIMEOUT`，测试 `test_skill_package_upload_contract_and_approval_gate` 和 `test_p0_hardening.py`；Playwright E2E 覆盖真实 zip 上传、合约测试和治理启用 |
| FR-WF-01 | 创建、编辑、复制、发布、归档 Workflow | 已实现基础 | `WorkflowService.publish/copy_workflow/archive`，`POST /workflow-graphs/publish`，`POST/PUT/DELETE /workflow-drafts`，React `Workflow 市场` + `Workflow 画布` |
| FR-WF-02 | 线性步骤列表与图形化编排 | 已实现 | `WorkflowDraft` / `WorkflowStep`，`WorkflowGraph` 保留画布快照；前端图模型已独立测试，Inspector 支持节点工具栏、键盘删除、下游连线可视化、选择目标创建连线、删除连线和 Aggregator 聚合策略，Playwright 覆盖 Source/Skill/Join/Output/Aggregator 新增、创建连线、删除节点、删除下游连线、撤销、重做、保存草稿回放、校验、发布 |
| FR-WF-03 | 字段映射与强类型校验 | 已实现 | `resolve_input_mapping`，失败不调用 Skill |
| FR-WF-04 | 试运行 | 已实现基础 | `WorkflowRunner.dry_run` 支持 1-10 条样本，`POST /workflow-graphs/dry-run`，React Console 已接入按钮反馈，Playwright 覆盖选择数据集后试运行回填结果 |
| FR-DS-01 | CSV/JSONL 上传与流式解析 | 已实现 | `DatasetService.upload_dataset`，API `/datasets/upload` 与 `/datasets/from-path`，React 上传弹窗与禁用反馈已测试；空文件、坏 JSONL 行号、空 CSV 均有结构化错误 |
| FR-DS-02 | 数据集版本化 | 已实现 | 同名上传递增版本 |
| FR-DS-03 | 字段类型识别与人工修正 | 已实现基础 | 自动识别 + `DatasetService.correct_field_type` + API 字段修正 |
| FR-DS-04 | Source Skill 机制 | 已实现基础 | `source.csv@0.1.0`、`source.jsonl@0.1.0` manifest，`POST /datasets/source-materialize` |
| FR-DS-05 | Golden Dataset 与人工标签 | 已实现基础 | `golden`、`label_field`、Judge demo |
| FR-DS-06 | rows 按需读取 | 已实现 | `iter_rows` / `iter_row_chunks`，队列消息仅 `item_id` |
| FR-EX-01 | 分片创建 Run Items 与轻量队列 | 已实现 | `WorkflowRunner.create_run`，1000 样本测试；Task API 将 Dataset/Workflow/Run 绑定为一次业务任务 |
| FR-EX-02 | 并发控制与外部 API 限速 | 已实现基础 | `InMemoryRateLimiter` 记录等待与限速次数；Redis/Celery 适配待生产化 |
| FR-EX-03 | 失败重试 | 已实现基础 | `retry_failed_items` |
| FR-EX-04 | 断点续跑 | 已实现基础 | 成功 item 不覆盖，失败 item 可重跑 |
| FR-EX-05 | Step 轨迹 | 已实现 | 输入/输出摘要、耗时、异常、指标、cache_hit、限速等待，`GET /runs/{run_id}/trace` |
| FR-RP-01 | Run 指标聚合 | 已实现 | `aggregate_run_report` |
| FR-RP-02 | Skill 输出指标入库 | 已实现 | Item metrics 与 report 聚合 |
| FR-RP-03 | Badcase 明细筛选 | 已实现 | `BadcaseService.filter_badcases`，`GET /badcases` 支持状态、问题类型、原因、Skill、关键词、得分区间 |
| FR-RP-04 | 单次任务报告 | 已实现基础 | API `/tasks/{task_id}/report` 包装任务摘要、版本快照、Step 分布、Judge 分数分布、RunReport、Badcase、导出链接；React 报告中心围绕 Task 展示摘要、版本、指标、Step 分布和 Badcase；Playwright E2E 覆盖任务报告查看、导出和 Badcase 加入 Golden |
| FR-ME-01 | Judge Profile 管理 | 已实现基础 | `JudgeProfileService.create_profile/get_profile`，API 已挂载 |
| FR-ME-02 | Golden Dataset 裁判评测 | 已实现 | `audit_judge_profile` 输出 Accuracy/Precision/Recall/F1/Kappa/混淆矩阵 |
| FR-ME-03 | 审计结果入库 | 已实现 | `JudgeProfileService.audit_and_store` |
| FR-HL-01 | Badcase 列表和详情 | 已实现基础 | Report badcases、BadcaseService |
| FR-HL-02 | 人工标签/说明/责任归类 | 已实现 | `correct_badcase` |
| FR-HL-03 | 加入错题本/Golden 候选 | 已实现基础 | `golden_candidate` 与 `accepted_to_golden` |
| FR-HL-04 | 处理状态流转 | 已实现 | pending_review/corrected/accepted_to_golden/ignored/reopened |
| FR-AU-01 | 敏感配置脱敏 | 已实现 | `redact_secrets`，保留 tokens 成本指标 |
| FR-AU-02 | 运行快照 | 已实现 | Run snapshot 记录 Workflow、Skill、Dataset、Runtime |
| FR-AU-03 | 可信 Skill 来源限制 | 已实现基础 | 只扫描本地可信 manifest，不执行任意上传代码 |

## P1/P2 功能覆盖

| 编号 | 需求 | 当前状态 | 证据 |
|---|---|---|---|
| FR-SK-06 | Skill 启用/禁用/审批/废弃 | 已实现基础 | `SkillRegistry.disable/approve/deprecate`，`POST /skills/{skill_id}/approve|disable|deprecate`，React 治理页面已接入 |
| FR-SK-07 | Skill 安全策略声明 | 已实现基础 | `SkillManifest.permissions` |
| FR-WF-05 | 模板化 Workflow | 已实现基础 | `WorkflowTemplateService`，React Workflow 页面提供示例图 |
| FR-WF-06 | DAG/条件分支/并行节点 | 已实现基础 | `DAGWorkflow.execution_levels`、`DAGWorkflowExecutor` 支持条件 `exists/not exists` 和按层并行执行；`WorkflowGraphService` 支持画布 DAG 校验、点对多、多对一 Join/Aggregator 规则；发布前阻断测试覆盖未审批 Skill、多对一缺 Join/Aggregator、Branch 缺条件表达式 |
| FR-DS-07 | DBQuery/API/线上抽样 Source Skill | 已实现基础 | `DBQuerySkill` 支持 sqlite SQL，`APIPullSkill` 支持 file/http JSON rows，`OnlineSampleSkill` 支持抽样 |
| FR-DS-08 | 数据导出 | 已实现基础 | `DatasetService.export_rows` |
| FR-EX-06 | 取消、暂停、恢复 | 已实现基础 | `cancel_run/pause_run/resume_run`，`POST /runs/{run_id}/execute|pause|resume|cancel|retry-failed`，React 执行中心已接入；Task 层已增加 completed/running/canceled 状态机保护 |
| FR-EX-07 | sample_repeat_times | 已实现基础 | Run Item repeat_index 与测试 |
| FR-EX-08 | Step 级 Evaluation Cache | 已实现基础 | cache_key 与 cache_hit 记录 |
| FR-RP-05 | 跨 Run 趋势图 | 已实现基础 | `compare_reports` 输出趋势差值；Streamlit 可展示指标，复杂图表仍可增强 |
| FR-RP-06 | 多次运行聚合视图 | 已实现基础 | `aggregate_repeat_items` 输出多数投票、通过概率、方差、不稳定样本 |
| FR-RP-07 | 报告导出 | 已实现基础 | `export_report_csv`、`export_report_html`，`GET /runs/{run_id}/report/export?file_format=json|csv|html` |
| FR-ME-04 | 裁判偏差分析 | 已实现基础 | `JudgeProfileService.bias_analysis` |
| FR-ME-05 | 人工纠错反哺候选池 | 已实现基础 | `PromptCandidateService` 可从 Badcase 创建 Prompt 优化候选并评审 |
| FR-ME-06 | 多裁判交叉验证 | 已实现基础 | `JudgeProfileService.cross_validate` |
| FR-HL-05 | Badcase 聚类 | 已实现 | `cluster_badcases(method="rule")` 与 `cluster_badcases(method="embedding")` |
| FR-HL-06 | 批量处理与导出 | 已实现基础 | `bulk_correct`、`export_badcases`，`POST /badcases/bulk-correct`，`GET /badcases/export` |
| FR-AU-04 | 角色权限 | 已实现基础 | `AccessControl` |
| FR-AU-05 | 操作审计 | 已实现基础 | `AuditService` |

## 市场对标增强覆盖

| 对标能力 | 当前状态 | 证据 |
|---|---|---|
| Task 一等模型 | 已实现基础 | `GET/POST /tasks`、`POST /tasks/{task_id}/attempts`、`POST /tasks/{task_id}/execute|pause|resume|cancel|retry-failed`、`GET /tasks/{task_id}/report`、`GET /tasks/{task_id}/trace-tree`；Task 创建保存 `execution_config`，包含并发、repeat、重试和成本预算；Run Attempts 保留旧 Run 报告快照；前端执行中心默认展示任务列表并使用独立创建向导；Playwright E2E 覆盖创建和执行任务 |
| Experiment 快照与 baseline 对比 | 已实现最小 API | `POST /experiments/from-run`，`GET /experiments`，保存 Workflow/Dataset/Skill/Prompt/Runtime 快照与 baseline diff |
| Prompt / Skill 版本注册 | 已实现基础 | Run snapshot 与 Experiment snapshot 记录 `skill_versions`、`prompt_skill_versions`、模型参数 |
| Assertion DSL | 已实现最小 API | `POST /assertions/evaluate` 支持 contains、regex、json_schema、similarity、latency、cost、safety 的基础断言 |
| CI Gate | 已实现最小 API | `POST /ci-gates/evaluate` 支持按指标阈值 blocking 发布 |
| Annotation Queue | 已实现最小 API | `POST /annotation-queue/seed-from-run`、列表、分派、review，低分/失败样本可进入人工审核 |
| Trace Tree | 已实现最小 API | `GET /runs/{run_id}/trace-tree` 与 `GET /tasks/{task_id}/trace-tree` 展示 Run Item -> Skill Step 输入、输出、耗时、错误、缓存命中 |
| 产品化入口 | 已实现基础 | React 首页读取真实 Dashboard；Workflow 先进入市场，执行与报告围绕 Task 组织 |

## 生产化边界说明

- 本地默认运行仍使用 JSON 文件仓储和单进程 Runner，便于面试演示和无外部依赖验证。
- Skill 插件包执行默认走受控子进程，不在主 FastAPI 进程中直接 import 用户代码；当前已具备审批门禁和 5 秒默认超时，生产环境仍需补资源限额、依赖隔离和签名校验。
- 生产适配资产已提供：`docker-compose.yml`、`infra/mysql/schema.sql`、`infra/celery/README.md`、`aegisqa/workers/celery_app.py`、`aegisqa/infrastructure/manifest.py`。
- MySQL/Redis/Celery 生产服务需要在目标环境中安装依赖并启动容器后接入真实 Repository/Worker；当前测试验证了 schema、消息契约和 Worker 入口，而不是启动外部服务。
- DBQuery 当前真实执行 sqlite，MySQL 连接池是生产 Repository/Skill Adapter 的自然扩展点；API Pull 支持 file/http JSON rows，企业认证和分页策略可在 config 中继续扩展。
- DAG 执行器已支持条件和按层并行；React Flow 可视化画布已提供产品化入口。复杂表达式语言、企业级调度和真实分布式 Worker 仍属于后续生产增强。
