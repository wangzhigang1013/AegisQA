# AegisQA 交互验收矩阵

## 验收规则

- 每个可见按钮必须具备真实结果：成功、失败、loading、禁用原因或“当前版本暂不支持”的明确提示。
- Workflow 画布以当前 nodes/edges 为唯一事实来源，校验、试运行、发布和保存草稿都不能继续使用静态 demo graph。
- 执行中心所有 Task 控制动作必须绑定后端 API，并在完成后刷新任务列表和详情。
- 页面空状态必须给出下一步入口，避免用户不知道怎么继续。

## 最近一次交互验证

- `npm test`：25 个前端交互/API client/图模型/任务创建向导/Run Attempts 测试通过。
- `npm run e2e`：6 个 Playwright E2E 通过，覆盖“上传数据 -> 上传并审批 Skill -> 发布 Workflow -> 创建任务 -> 执行 -> 查看任务报告 -> 纠错 Badcase”主链路，以及 Workflow 画布新增 Source/Skill/Join/Output/Aggregator、聚合策略、创建连线、删除节点、删除下游连线、键盘删除、保存草稿回放、试运行回填、校验、发布。
- Headless Chrome CDP：实际打开 `http://127.0.0.1:5173`，验证概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均能打开并展示关键入口。
- Headless Chrome CDP：概览页额外验证真实 Dashboard 指标，以及 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 产品化入口。
- 验证过程中发现 8000 端口曾运行旧 FastAPI 进程，导致 `/workflow-drafts` 返回 404；重启后端后，Workflow 保存草稿复测为“草稿已保存”。

## 页面矩阵

| 页面 | 关键动作 | 当前状态 | 后端/API 依赖 | 验收方式 |
| --- | --- | --- | --- | --- |
| 概览 | 开始一次评测 | 可用，跳转 Workflow 市场 | 前端路由 | `npm test` 覆盖导航入口 |
| 概览 | Dashboard 指标 | 可用，从后端读取真实数据 | `GET /dashboard/summary`、`GET /runs` | `npm test` 覆盖真实数值，CDP 验证页面渲染 |
| 概览 | 产品化增强入口 | 可用，展示 Experiment、Assertion、CI Gate、Annotation、Trace Tree 状态 | `GET /experiments`、`GET /annotation-queue` | `npm test` 与 CDP 验证入口 |
| 数据集 | 上传 CSV/JSONL | 可用，弹窗选择文件、提交、成功后刷新数据集列表；已修复 Upload 真实文件归一化问题；空文件、坏 JSONL、空 CSV 会返回结构化错误 | `POST /datasets/upload`、`GET /datasets` | `npm test` 覆盖上传弹窗；`tests/test_p0_hardening.py` 覆盖异常；Playwright E2E 覆盖真实 JSONL 上传 |
| 数据集 | Source Skill 物化 | 可用，JSON rows 物化为 Dataset Version | `POST /datasets/source-materialize` | 人工验证和后端契约测试覆盖 |
| 数据集 | 字段预览 | 可用，优先展示真实 Dataset Version 字段 | `GET /datasets` | 前端类型检查覆盖字段契约 |
| Skill 市场 | 查看详情 | 可用，打开抽屉 | `GET /skills` | `npm test` 覆盖详情入口 |
| Skill 市场 | 搜索 Skill | 可用，支持按 Skill 名称、ID、标签过滤，避免历史数据过多时找不到新插件 | `GET /skills` | Playwright E2E 覆盖按新上传 Skill ID 搜索 |
| Skill 市场 | 上传 Skill 插件包 | 可用，打开上传向导；zip 上传后进入待审批；非法路径、缺 manifest、缺 handler 会返回业务错误码 | `POST /skills/packages/upload`、`GET /skills/packages` | `npm test` 覆盖上传入口；Playwright E2E 覆盖真实 zip 上传；后端测试覆盖成功、缺 manifest/handler、非法路径 |
| Skill 市场 | 运行合约测试 | 可用，调用后端并展示通过/失败；插件默认 5 秒超时，超时返回 `SKILL_CONTRACT_TIMEOUT` | `POST /skills/{skill_id}/contract-test` | `npm test` 与 Playwright E2E 覆盖合约测试结果；P0 测试覆盖超时；full E2E 覆盖并发场景 |
| Workflow 市场 | 新建 Workflow | 可用，创建草稿并进入画布 | `POST /workflow-drafts` | `npm test` 覆盖新建入口 |
| Workflow 市场 | 查看草稿/已发布版本/模板 | 可用，列表化展示流程资产 | `GET /workflow-drafts`、`GET /workflows`、`GET /workflow-templates` | `npm test` 覆盖市场页 |
| Workflow 市场 | 搜索 Workflow | 可用，支持按名称过滤草稿和已发布流程 | `GET /workflow-drafts`、`GET /workflows` | Playwright E2E 覆盖发布后按名称搜索 |
| Workflow 画布 | 选择流程 | 可用，支持草稿、已发布版本、模板入口 | `GET /workflow-drafts`、`GET /workflows`、`GET /workflow-templates` | `npm test` 覆盖选择器存在 |
| Workflow 画布 | 新增节点 | 可用，Skill 与结构节点分开新增 | `GET /skills` | `npm test` 覆盖新增 Join；Playwright E2E 覆盖 Source、Skill、Join、Output、Aggregator 新增 |
| Workflow 画布 | 连线 | 可用，React Flow `onConnect` 写入当前 edges；Inspector 同时提供“可连接目标”按钮，便于选择下游节点并创建依赖线 | 前端画布状态 | `npm test` 和 Playwright E2E 覆盖创建连线、删除下游连线 |
| Workflow 画布 | 删除节点/连线 | 可用，删除选中节点、Inspector 删除当前节点、键盘 Delete/Backspace 删除，或通过 Inspector 删除选中节点的下游连线，并同步画布状态 | 前端画布状态 | `npm test` 覆盖删除节点、键盘删除和删除下游连线；Playwright E2E 覆盖节点工具栏、键盘删除、删除选中节点和 `answer -> judge_a` 下游连线 |
| Workflow 画布 | 撤销/重做 | 可用，支持节点新增、删除、Inspector 编辑、自动布局、连线的历史回退与恢复 | 前端画布状态 | `npm test` 和 Playwright E2E 覆盖新增 Join 后撤销/重做 |
| Workflow 画布 | Inspector 编辑 | 可用，支持名称、类型、Skill、条件、JSON 映射、配置和 Aggregator 聚合策略 | 前端画布状态 | `npm test` 覆盖 Aggregator 策略；类型检查覆盖 |
| Workflow 画布 | 保存草稿 | 可用，新建或更新草稿，保存后回到 Workflow 市场，再打开仍保留名称与节点配置 | `POST/PUT /workflow-drafts` | 后端契约测试与 Playwright E2E 覆盖 |
| Workflow 画布 | 校验 | 可用，提交当前画布 graph；前端已抽出图模型转换，避免提交静态 demo graph | `POST /workflow-graphs/validate` | 前端图模型单测与 Playwright E2E 覆盖 |
| Workflow 画布 | 试运行 | 可用，要求先选择 Dataset Version，会回填 step trace 并提示队列消息只携带 `item_id` | `POST /workflow-graphs/dry-run` | 后端契约测试与 Playwright E2E 覆盖 |
| Workflow 画布 | 发布 | 可用，提交当前画布 graph；后端发布阻断错误会回填到 Console“错误与建议” | `POST /workflow-graphs/publish` | 后端发布阻断测试、前端发布失败测试与 Playwright E2E 覆盖 |
| 执行中心 | 创建任务 | 可用，独立向导选择 Dataset Version 和 Workflow Version；未选择时禁用创建；支持分片大小、并发、repeat、最大重试、重试退避、成本预算并保存到任务快照 | `POST /tasks`、`GET /workflows`、`GET /datasets` | `TaskCreateWizard` 单测覆盖必选校验和参数提交；后端测试覆盖 `execution_config` 落库；Playwright E2E 覆盖真实创建 |
| 执行中心 | 执行/暂停/恢复/取消/重试 | 可用，动作绑定任务并刷新列表；completed/running/canceled 等非法状态会被后端拒绝，前端按钮按状态禁用并显示原因 | `POST /tasks/{task_id}/execute|pause|resume|cancel|retry-failed` | `npm test` 覆盖执行状态刷新和完成态禁用；Playwright E2E 覆盖真实执行；P0 后端测试覆盖状态机 |
| 执行中心 | 任务详情/Run Attempts/Trace Tree | 可用，按选中 Task 展示基础信息、当前 Attempt、历史 attempts、执行参数和 Trace Tree；已完成任务可新建 Attempt 且不覆盖旧报告 | `GET /tasks`、`POST /tasks/{task_id}/attempts`、`GET /tasks/{task_id}/trace-tree` | 后端测试覆盖历史报告保留；前端测试覆盖 Run Attempts 展示 |
| 报告中心 | 任务报告详情 | 可用，围绕选中任务展示任务摘要、版本快照、指标、Step 分布、Judge 分数分布、Badcase 和导出入口 | `GET /tasks/{task_id}/report` | 后端测试覆盖结构化字段；`npm test` 覆盖报告中心展示 |
| 报告中心 | 导出 HTML/CSV/JSON | 可用，围绕选中任务导出底层 Run 报告 | `GET /tasks/{task_id}/report`、`GET /runs/{run_id}/report/export` | 后端测试校验 HTML/CSV/JSON 内容；`npm test` 覆盖导出成功反馈 |
| 报告中心 | Badcase 状态流转 | 可用；支持单条加入 Golden、忽略、重开、加入 Annotation Queue，以及批量加入 Golden；聚合报告中的 Badcase 若尚未持久化，会先创建 Badcase 再纠错入 Golden | `POST /badcases`、`POST /badcases/{badcase_id}/correct`、`POST /badcases/{badcase_id}/reopen`、`POST /badcases/bulk-correct`、`POST /annotation-queue/seed-from-run` | Playwright E2E 覆盖真实 Golden 纠错链路；`npm test` 覆盖报告页按钮和忽略反馈；后端服务测试覆盖状态流转 |
| Judge 审计 | 创建 Profile | 可用，弹窗保存 Profile | `POST /judge-profiles` | 人工验证和类型检查覆盖 |
| Judge 审计 | 创建审计 | 可用，弹窗提交审计标签 | `POST /judge-profiles/{profile_id}/audits` | `npm test` 覆盖审计表单 |
| 治理与审计 | 查看权限矩阵 | 可用，打开 RBAC 矩阵弹窗 | 前端静态矩阵 | `npm test` 覆盖矩阵弹窗 |
| 治理与审计 | Skill 搜索 | 可用，支持按 Skill ID 或名称过滤生命周期表 | `GET /skills` | Playwright E2E 覆盖上传后搜索并审批 |
| 治理与审计 | Skill 启用/禁用/废弃 | 可用，调用治理 API 并刷新列表 | `POST /skills/{skill_id}/approve|disable|deprecate` | Playwright E2E 覆盖启用新上传 Skill；前端 mutation 与后端 API 覆盖 |
| 治理与审计 | 审计日志 | 可用，展示后端审计事件 | `GET /audit-events` | 类型检查覆盖 |

## 当前仍需增强

- Workflow 画布已通过 Playwright 覆盖进入画布、新增节点、聚合策略、创建连线、删除节点、删除下游连线、键盘删除、保存草稿回放、试运行与发布；后续需要进一步拆分组件，并补更复杂字段映射 UI。
- Task 创建向导已加入必选校验、并发/重试/repeat 和成本预算，任务详情已展示 Run Attempts；后续需要继续接入 CI Gate、实验 baseline 对比和权限检查。
- 报告中心需要把已实现的 Experiment/CI Gate/Annotation Queue/Trace Tree API 进一步做成独立可操作视图。
- Judge 审计需要增加多 Judge 一致性和红队安全扫描视图。
