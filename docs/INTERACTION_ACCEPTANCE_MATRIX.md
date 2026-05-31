# AegisQA 交互验收矩阵

## 验收规则

- 每个可见按钮必须具备真实结果：成功、失败、loading、禁用原因或“当前版本暂不支持”的明确提示。
- Workflow 画布以当前 nodes/edges 为唯一事实来源，校验、试运行、发布和保存草稿都不能继续使用静态 demo graph。
- 执行中心所有 Task 控制动作必须绑定后端 API，并在完成后刷新任务列表和详情。
- 页面空状态必须给出下一步入口，避免用户不知道怎么继续。

## 最近一次交互验证

- `npm test`：40 个前端交互/API client/图模型/任务创建向导/首页任务工作台/任务详情驾驶舱/Dataset Lineage/Trace Flow/Trace Tree/Workflow 字段映射/参数预览/报告质量决策/报告风险治理/Experiment/CI Gate/Annotation Queue/Judge 偏差趋势/治理边界测试通过。
- `npm run e2e`：8 个 Playwright E2E 通过，覆盖“上传数据 -> 上传并审批 Skill -> 发布 Workflow -> 创建任务 -> 执行 -> 查看任务详情驾驶舱 -> 查看任务报告 -> 纠错 Badcase -> 查看 Trace Flow 参数来源”主链路、CI Gate 创建配置与阻断评估、Annotation Queue 领取/审核/回流 Golden、批量审核与候选资产摘要，以及 Workflow 画布新增 Source/Skill/Join/Output/Aggregator、聚合策略、创建连线、删除节点、删除下游连线、键盘删除、保存草稿回放、试运行回填、校验、发布。
- 最终验收确认：生产适配状态已从治理页可见状态清单降级为文档边界提示，现有按钮矩阵仍覆盖全部用户可见主动作。
- Headless Chrome CDP：实际打开 `http://127.0.0.1:5173`，验证概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均能打开并展示关键入口。
- Headless Chrome CDP：概览页额外验证真实 Dashboard 指标，以及 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 产品化入口。
- 验证过程中发现 8000 端口曾运行旧 FastAPI 进程，导致 `/workflow-drafts` 返回 404；重启后端后，Workflow 保存草稿复测为“草稿已保存”。

## 页面矩阵

| 页面 | 关键动作 | 当前状态 | 后端/API 依赖 | 验收方式 |
| --- | --- | --- | --- | --- |
| 概览 | 开始一次评测 | 可用，跳转 Workflow 市场 | 前端路由 | `npm test` 覆盖导航入口 |
| 概览 | Dashboard 指标 | 可用，从后端读取真实数据 | `GET /dashboard/summary`、`GET /runs` | `npm test` 覆盖真实数值，CDP 验证页面渲染 |
| 概览 | 任务工作台 | 可用，展示最近任务、待审批 Skill、待审核样本、失败任务、CI Gate 阻断，并提供上传数据、选择 Workflow、创建任务、查看报告主流程入口 | `GET /tasks`、`GET /skills/packages`、`GET /annotation-queue`、`GET /ci-gates` | `npm test` 覆盖任务工作台入口 |
| 概览 | 产品化增强入口 | 可用，展示 Experiment、Assertion、CI Gate、Annotation、Trace Tree 状态 | `GET /experiments`、`GET /annotation-queue` | `npm test` 与 CDP 验证入口 |
| 数据集 | 上传 CSV/JSONL | 可用，弹窗选择文件、提交、成功后刷新数据集列表；已修复 Upload 真实文件归一化问题；空文件、坏 JSONL、空 CSV 会返回结构化错误 | `POST /datasets/upload`、`GET /datasets` | `npm test` 覆盖上传弹窗；`tests/test_p0_hardening.py` 覆盖异常；Playwright E2E 覆盖真实 JSONL 上传 |
| 数据集 | Source Skill 物化 | 可用，JSON rows 物化为 Dataset Version | `POST /datasets/source-materialize` | 人工验证和后端契约测试覆盖 |
| 数据集 | 字段预览 | 可用，优先展示真实 Dataset Version 字段 | `GET /datasets` | 前端类型检查覆盖字段契约 |
| 数据集 | 查看 Lineage | 可用，打开数据血缘抽屉，展示来源类型、来源参数、字段路径、预览和下游任务 | `GET /datasets/{dataset_id}/versions/{version}/lineage` | `tests/test_trustworthy_evaluation_enhancements.py` 和 `npm test` 覆盖 |
| Skill 市场 | 查看详情 | 可用，打开抽屉 | `GET /skills` | `npm test` 覆盖详情入口 |
| Skill 市场 | 搜索 Skill | 可用，支持按 Skill 名称、ID、标签过滤，避免历史数据过多时找不到新插件 | `GET /skills` | Playwright E2E 覆盖按新上传 Skill ID 搜索 |
| Skill 市场 | 上传 Skill 插件包 | 可用，打开上传向导；zip 上传后进入待审批；非法路径、缺 manifest、缺 handler 会返回业务错误码 | `POST /skills/packages/upload`、`GET /skills/packages` | `npm test` 覆盖上传入口；Playwright E2E 覆盖真实 zip 上传；后端测试覆盖成功、缺 manifest/handler、非法路径 |
| Skill 市场 | 运行合约测试 | 可用，调用后端并展示通过/失败；插件默认 5 秒超时，超时返回 `SKILL_CONTRACT_TIMEOUT`；stdout 超过安全上限返回 `SKILL_PACKAGE_OUTPUT_TOO_LARGE`；运行时 stdout/stderr 会截断并脱敏本地路径 | `POST /skills/{skill_id}/contract-test` | `npm test` 与 Playwright E2E 覆盖合约测试结果；P0 测试覆盖超时；`test_skill_package_security.py` 覆盖输出上限、日志截断和路径脱敏；full E2E 覆盖并发场景 |
| Skill 市场 | 审批状态展示 | 可用，列表展示待审批、合约已通过/未通过、审批人、审批时间 | `GET /skills`、`GET /skills/packages` | `npm test` 覆盖插件包审批状态、合约状态和审批信息 |
| Workflow 市场 | 新建 Workflow | 可用，创建草稿并进入画布 | `POST /workflow-drafts` | `npm test` 覆盖新建入口 |
| Workflow 市场 | 查看草稿/已发布版本/模板 | 可用，列表化展示流程资产 | `GET /workflow-drafts`、`GET /workflows`、`GET /workflow-templates` | `npm test` 覆盖市场页 |
| Workflow 市场 | 搜索 Workflow | 可用，支持按名称过滤草稿和已发布流程 | `GET /workflow-drafts`、`GET /workflows` | Playwright E2E 覆盖发布后按名称搜索 |
| Workflow 画布 | 选择流程 | 可用，支持草稿、已发布版本、模板入口 | `GET /workflow-drafts`、`GET /workflows`、`GET /workflow-templates` | `npm test` 覆盖选择器存在 |
| Workflow 画布 | 新增节点 | 可用，Skill 与结构节点分开新增 | `GET /skills` | `npm test` 覆盖新增 Join；Playwright E2E 覆盖 Source、Skill、Join、Output、Aggregator 新增 |
| Workflow 画布 | 连线 | 可用，React Flow `onConnect` 写入当前 edges；Inspector 同时提供“可连接目标”按钮，便于选择下游节点并创建依赖线 | 前端画布状态 | `npm test` 和 Playwright E2E 覆盖创建连线、删除下游连线 |
| Workflow 画布 | 删除节点/连线 | 可用，删除选中节点、Inspector 删除当前节点、键盘 Delete/Backspace 删除，或通过 Inspector 删除选中节点的下游连线，并同步画布状态 | 前端画布状态 | `npm test` 覆盖删除节点、键盘删除和删除下游连线；Playwright E2E 覆盖节点工具栏、键盘删除、删除选中节点和 `answer -> judge_a` 下游连线 |
| Workflow 画布 | 撤销/重做 | 可用，支持节点新增、删除、Inspector 编辑、自动布局、连线的历史回退与恢复 | 前端画布状态 | `npm test` 和 Playwright E2E 覆盖新增 Join 后撤销/重做 |
| Workflow 画布 | Inspector 编辑 | 可用，支持名称、类型、Skill、条件、字段映射表格、JSON 高级映射、配置和 Aggregator 聚合策略；字段路径可从 Dataset 和上游输出自动推导 | 前端画布状态、`GET /datasets` | `npm test` 覆盖 Aggregator 策略、字段路径推导和 Inspector 字段映射展示；类型检查覆盖 |
| Workflow 画布 | 参数预览 | 可用，Inspector 内选择 Dataset Version 后调用后端参数预览，展示解析后配置、参数来源、表达式路径和 Secret 脱敏状态 | `POST /workflow-graphs/parameter-preview`、`GET /datasets` | `npm test` 覆盖选择数据集、调用预览和展示 `workflow_config` 来源 |
| Workflow 画布 | 保存草稿 | 可用，新建或更新草稿，保存后回到 Workflow 市场，再打开仍保留名称与节点配置 | `POST/PUT /workflow-drafts` | 后端契约测试与 Playwright E2E 覆盖 |
| Workflow 画布 | 校验 | 可用，提交当前画布 graph；前端已抽出图模型转换，避免提交静态 demo graph | `POST /workflow-graphs/validate` | 前端图模型单测与 Playwright E2E 覆盖 |
| Workflow 画布 | 试运行 | 可用，要求先选择 Dataset Version，会回填 step trace 并提示队列消息只携带 `item_id` | `POST /workflow-graphs/dry-run` | 后端契约测试与 Playwright E2E 覆盖 |
| Workflow 画布 | 发布 | 可用，提交当前画布 graph；后端发布阻断错误会回填到 Console“错误与建议” | `POST /workflow-graphs/publish` | 后端发布阻断测试、前端发布失败测试与 Playwright E2E 覆盖 |
| 执行中心 | 创建任务 | 可用，独立向导选择 Dataset Version 和 Workflow Version；未选择时禁用创建；支持分片大小、并发、repeat、最大重试、重试退避、成本预算并保存到任务快照 | `POST /tasks`、`GET /workflows`、`GET /datasets` | `TaskCreateWizard` 单测覆盖必选校验和参数提交；后端测试覆盖 `execution_config` 落库；Playwright E2E 覆盖真实创建 |
| 执行中心 | 执行/暂停/恢复/取消/重试 | 可用，动作绑定任务并刷新列表；completed/running/canceled 等非法状态会被后端拒绝，前端按钮按状态禁用并显示原因 | `POST /tasks/{task_id}/execute|pause|resume|cancel|retry-failed` | `npm test` 覆盖执行状态刷新和完成态禁用；Playwright E2E 覆盖真实执行；P0 后端测试覆盖状态机 |
| 执行中心 | 任务详情驾驶舱 | 可用，按概览、样本、Trace、Badcase、Attempts、参数组织；参数页展示任务冻结参数、Skill 参数来源和 Secret 脱敏说明；已完成任务可新建 Attempt 且不覆盖旧报告 | `GET /tasks`、`GET /tasks/{task_id}/trace-tree`、`GET /tasks/{task_id}/trace-flow`、`GET /tasks/{task_id}/report`、`POST /tasks/{task_id}/attempts` | 后端测试覆盖历史报告保留；前端测试覆盖驾驶舱页签；Playwright 覆盖任务执行后查看驾驶舱 |
| Trace Flow | 样本级数据流 | 可用，从任务详情和报告页进入；展示 Dataset、Workflow、Attempt、队列消息形状、样本列表、Step Timeline、Row、Context、Metrics、Input、参数来源、Output、Error 和 Badcase 状态 | `GET /tasks/{task_id}/trace-flow` | `tests/test_trace_flow_api.py`、`npm test` 和 Playwright 主链路覆盖 |
| Trace Tree | 独立调用树页面 | 可用，从任务详情和报告页进入；按 Item 展开 Skill Step，展示输入、输出、耗时、缓存和错误 | `GET /tasks/{task_id}/trace-tree` | `npm test` 覆盖 `/tasks/:taskId/trace-tree` |
| 报告中心 | 任务报告详情 | 可用，围绕选中任务展示任务摘要、版本快照、指标、Step 分布、Judge 分数分布、Badcase 和导出入口 | `GET /tasks/{task_id}/report` | 后端测试覆盖结构化字段；`npm test` 覆盖报告中心展示 |
| 报告中心 | 分层分析与下一步建议 | 可用，按 scene、expected_label、model_version、prompt_version 展示样本数、通过率、Badcase，并给出加入 Annotation、生成 Golden 候选、生成 CI Gate 建议 | `GET /tasks/{task_id}/report` 中的 `segments`、`recommendations` | `tests/test_report_segment_analysis.py` 和 `npm test` 覆盖分层字段与建议展示 |
| 报告中心 | 质量决策中心 | 可用，把通过率、错误率、Badcase 和低分层汇总为 passed/warning/blocked 决策，并展示风险摘要和下一步动作 | `GET /tasks/{task_id}/report` 中的 `quality_decision` | `tests/test_trustworthy_evaluation_enhancements.py` 和 `npm test` 覆盖 |
| 报告中心 | 跨任务 Score Analytics | 可用，报告页展示跨任务任务数、平均通过率、Badcase 总数、退化任务、任务趋势表和退化告警 | `GET /score-analytics` | `tests/test_risk_analytics_hardening.py` 和 `npm test` 覆盖 |
| 报告中心 | 成本预算状态 | 可用，围绕当前 Task 展示预算、已用估算成本、剩余预算、ok/warning/exceeded 状态和修复建议 | `GET /tasks/{task_id}/report` 中的 `budget_status` | `tests/test_risk_analytics_hardening.py` 和 `npm test` 覆盖 |
| 报告中心 | 红队安全扫描 | 可用，点击“运行红队扫描”会扫描当前 Task，并展示风险类型、级别、字段、证据和下一步建议 | `POST /red-team/scans` | `tests/test_risk_analytics_hardening.py` 和 `npm test` 覆盖 |
| 报告中心 | 参数治理证据 | 可用，报告 API 返回 Skill/Prompt 版本、模型参数、任务覆盖和 Secret 脱敏策略；任务详情参数页继续展示来源追踪 | `GET /tasks/{task_id}/parameter-governance`，`GET /tasks/{task_id}/report` | `tests/test_trustworthy_evaluation_enhancements.py` 覆盖 |
| 报告中心 | 导出 HTML/CSV/JSON | 可用，围绕选中任务导出底层 Run 报告 | `GET /tasks/{task_id}/report`、`GET /runs/{run_id}/report/export` | 后端测试校验 HTML/CSV/JSON 内容；`npm test` 覆盖导出成功反馈 |
| 报告中心 | Badcase 状态流转 | 可用；支持单条加入 Golden、忽略、重开、加入 Annotation Queue，以及批量加入 Golden；聚合报告中的 Badcase 若尚未持久化，会先创建 Badcase 再纠错入 Golden | `POST /badcases`、`POST /badcases/{badcase_id}/correct`、`POST /badcases/{badcase_id}/reopen`、`POST /badcases/bulk-correct`、`POST /annotation-queue/seed-from-run` | Playwright E2E 覆盖真实 Golden 纠错链路；`npm test` 覆盖报告页按钮和忽略反馈；后端服务测试覆盖状态流转 |
| 实验中心 | 实验快照列表与 baseline 对比 | 可用，展示 Experiment 列表、当前实验、baseline、通过率变化、失败样本变化、成本变化 | `GET /experiments`、`GET /runs` | `npm test` 覆盖 `/experiments` 页面 |
| 实验中心 | Dataset/Workflow 过滤 | 可用，支持按 Dataset 和 Workflow 过滤实验快照，避免跨业务线对比混乱 | `GET /experiments?dataset_id=&workflow_id=` | `tests/test_productization_api.py` 覆盖后端过滤；`npm test` 覆盖过滤入口 |
| 实验中心 | A/B 对比面板 | 可用，展示通过率、Badcase、P95 耗时、成本和失败分布差异 | `GET /experiments` | `npm test` 覆盖 A/B 面板和失败分布 |
| 实验中心 | 从 Run 生成实验快照 | 可用，打开创建弹窗，必须选择 Run 和填写名称后才能提交 | `POST /experiments/from-run` | `npm test` 覆盖创建入口和禁用条件 |
| CI Gate | 创建质量门禁配置 | 可用，弹窗创建发布门槛，默认包含通过率、Badcase 和 P95 耗时规则；未填写名称时禁用保存 | `POST /ci-gates`、`GET /ci-gates` | `npm test` 覆盖创建入口和禁用条件；Playwright E2E 覆盖真实创建 |
| CI Gate | 对 Task/Run 执行评估 | 可用，可选择门禁配置和 Task/Run；后端自动抽取任务或 Run 指标，返回 blocking 状态、实际值和阈值 | `POST /ci-gates/evaluate`、`GET /tasks`、`GET /runs` | `tests/test_productization_api.py` 覆盖 Task/Run 评估；`npm test` 与 Playwright E2E 覆盖阻断原因 |
| CI Gate | 评估历史与趋势 | 可用，每次评估保存 history，页面展示历史评估、阻断次数、通过次数、目标和主要原因 | `GET /ci-gates/evaluations?config_id=&task_id=&run_id=` | `tests/test_productization_api.py` 覆盖保存和过滤；`npm test` 覆盖历史趋势展示 |
| Annotation Queue | 队列筛选 | 可用，支持状态、负责人、来源任务筛选；来源任务由后端根据 Run 回填 | `GET /annotation-queue?status=&assignee=&source_task_id=`、`GET /tasks` | `tests/test_productization_api.py` 覆盖来源任务筛选；`npm test` 覆盖筛选入口 |
| Annotation Queue | 领取/分派/审核 | 可用，支持领取为当前用户、分派给指定负责人、填写人工标签和说明，审核结果可回流 Golden Dataset | `POST /annotation-queue/{task_id}/assign`、`POST /annotation-queue/{task_id}/review` | `npm test` 覆盖领取和审核弹窗；Playwright E2E 覆盖真实领取、审核和回流 Golden |
| Annotation Queue | 批量审核 | 可用，支持多选待审核样本，批量设置人工标签、说明和是否回流 Golden，提交后刷新队列和候选资产 | `POST /annotation-queue/bulk-review` | `tests/test_productization_api.py` 覆盖批量审核生成候选资产；`npm test` 覆盖批量审核弹窗和成功反馈；Playwright E2E 覆盖真实批量审核 |
| Annotation Queue | 候选资产 | 可用，展示当前来源任务沉淀出的 Golden 候选和 Assertion 候选数量 | `GET /annotation-candidates?source_task_id=` | `npm test` 覆盖候选资产摘要展示 |
| Judge 审计 | 创建 Profile | 可用，弹窗保存 Profile | `POST /judge-profiles` | 人工验证和类型检查覆盖 |
| Judge 审计 | 创建审计 | 可用，弹窗提交审计标签 | `POST /judge-profiles/{profile_id}/audits` | `npm test` 覆盖审计表单 |
| Judge 审计 | 多 Judge 一致性 | 可用，弹窗输入人工标签和多个 Judge 输出，展示两两一致率和各 Judge 审计指标 | `POST /judge-cross-validation` | `tests/test_trustworthy_evaluation_enhancements.py` 和 `npm test` 覆盖 |
| Judge 审计 | 偏差趋势 | 可用，展示审计数、Profile 数、低一致性数量、Accuracy/Kappa 趋势图和低一致性 Profile 表 | `GET /judge-audits/trends` | `tests/test_risk_analytics_hardening.py` 和 `npm test` 覆盖 |
| 治理与审计 | 查看权限矩阵 | 可用，打开 RBAC 矩阵弹窗 | 前端静态矩阵 | `npm test` 覆盖矩阵弹窗 |
| 治理与审计 | Skill 搜索 | 可用，支持按 Skill ID 或名称过滤生命周期表 | `GET /skills` | Playwright E2E 覆盖上传后搜索并审批 |
| 治理与审计 | Skill 审批详情 | 可用，打开审批抽屉，展示 Manifest、输入/输出 Schema、测试日志；未通过合约测试时审批启用禁用并说明原因 | `GET /skills`、`GET /skills/packages`、`POST /skills/{skill_id}/approve` | `npm test` 覆盖审批抽屉和禁用原因 |
| 治理与审计 | Skill 启用/禁用/废弃 | 可用，调用治理 API 并刷新列表；插件未通过合约测试时前端禁用启用动作 | `POST /skills/{skill_id}/approve|disable|deprecate` | Playwright E2E 覆盖启用新上传 Skill；前端 mutation 与后端 API 覆盖 |
| 治理与审计 | 审计日志 | 可用，展示后端审计事件 | `GET /audit-events` | 类型检查覆盖 |
| 治理与审计 | 生产适配边界 | 可用，页面只提示生产适配说明已移至 `README.md` 和 `docs/PRD_ACCEPTANCE_MATRIX.md`，不再展示像开关一样的 MySQL/Redis/Celery 状态 | 文档 | `npm test` 覆盖治理页提示和移除状态清单 |

## 当前仍需增强

- Workflow 画布已通过 Playwright 覆盖进入画布、新增节点、聚合策略、创建连线、删除节点、删除下游连线、键盘删除、保存草稿回放、试运行与发布；字段映射表格和参数预览已进入 Vitest，后续需要进一步拆分组件并补真实浏览器中的字段映射编辑 E2E。
- Task 创建向导已加入必选校验、并发/重试/repeat 和成本预算，任务详情已升级为驾驶舱页签；后续需要继续接入 CI Gate、实验 baseline 对比和权限检查。
- 报告中心、Trace Flow、实验中心、CI Gate 和 Annotation Queue 已覆盖任务报告、样本级数据流、跨任务 Score Analytics、红队扫描、成本预算、Experiment baseline/A-B 对比、质量门禁阻断评估与历史趋势、人工审核回流和批量审核候选资产沉淀；后续需要增强真实成本账单接入和更复杂的趋势筛选。
- Judge 审计已补齐多 Judge 一致性和偏差趋势最小闭环；后续需要按业务标签、模型版本和时间窗口继续细分偏差归因。
