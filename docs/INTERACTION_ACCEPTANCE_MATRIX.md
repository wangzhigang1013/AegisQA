# AegisQA 交互验收矩阵

## 验收规则

- 每个可见按钮必须具备真实结果：成功、失败、loading、禁用原因或“当前版本暂不支持”的明确提示。
- Workflow 画布以当前 nodes/edges 为唯一事实来源，校验、试运行、发布和保存草稿都不能继续使用静态 demo graph。
- 执行中心所有 Task 控制动作必须绑定后端 API，并在完成后刷新任务列表和详情。
- 页面空状态必须给出下一步入口，避免用户不知道怎么继续。

## 最近一次交互验证

- `npm test`：12 个前端交互测试通过。
- Headless Chrome CDP：实际打开 `http://127.0.0.1:5173`，验证概览、Skill 市场、Workflow 市场、Workflow 画布、任务列表、任务报告均能打开并展示关键入口。
- Headless Chrome CDP：概览页额外验证真实 Dashboard 指标，以及 Experiment 快照、Assertion DSL、CI Gate、Annotation Queue、Trace Tree 产品化入口。
- 验证过程中发现 8000 端口曾运行旧 FastAPI 进程，导致 `/workflow-drafts` 返回 404；重启后端后，Workflow 保存草稿复测为“草稿已保存”。

## 页面矩阵

| 页面 | 关键动作 | 当前状态 | 后端/API 依赖 | 验收方式 |
| --- | --- | --- | --- | --- |
| 概览 | 开始一次评测 | 可用，跳转 Workflow 市场 | 前端路由 | `npm test` 覆盖导航入口 |
| 概览 | Dashboard 指标 | 可用，从后端读取真实数据 | `GET /dashboard/summary`、`GET /runs` | `npm test` 覆盖真实数值，CDP 验证页面渲染 |
| 概览 | 产品化增强入口 | 可用，展示 Experiment、Assertion、CI Gate、Annotation、Trace Tree 状态 | `GET /experiments`、`GET /annotation-queue` | `npm test` 与 CDP 验证入口 |
| 数据集 | 上传 CSV/JSONL | 可用，弹窗选择文件、提交、成功后刷新数据集列表 | `POST /datasets/upload`、`GET /datasets` | `npm test` 覆盖上传弹窗 |
| 数据集 | Source Skill 物化 | 可用，JSON rows 物化为 Dataset Version | `POST /datasets/source-materialize` | 人工验证和后端契约测试覆盖 |
| 数据集 | 字段预览 | 可用，优先展示真实 Dataset Version 字段 | `GET /datasets` | 前端类型检查覆盖字段契约 |
| Skill 市场 | 查看详情 | 可用，打开抽屉 | `GET /skills` | `npm test` 覆盖详情入口 |
| Skill 市场 | 上传 Skill 插件包 | 可用，打开上传向导；zip 上传后进入待审批 | `POST /skills/packages/upload`、`GET /skills/packages` | `npm test` 覆盖上传入口；后端测试覆盖成功与缺 manifest/handler 失败 |
| Skill 市场 | 运行合约测试 | 可用，调用后端并展示通过/失败 | `POST /skills/{skill_id}/contract-test` | `npm test` 覆盖合约测试结果 |
| Workflow 市场 | 新建 Workflow | 可用，创建草稿并进入画布 | `POST /workflow-drafts` | `npm test` 覆盖新建入口 |
| Workflow 市场 | 查看草稿/已发布版本/模板 | 可用，列表化展示流程资产 | `GET /workflow-drafts`、`GET /workflows`、`GET /workflow-templates` | `npm test` 覆盖市场页 |
| Workflow 画布 | 选择流程 | 可用，支持草稿、已发布版本、模板入口 | `GET /workflow-drafts`、`GET /workflows`、`GET /workflow-templates` | `npm test` 覆盖选择器存在 |
| Workflow 画布 | 新增节点 | 可用，Skill 与结构节点分开新增 | `GET /skills` | `npm test` 覆盖新增 Join |
| Workflow 画布 | 连线 | 可用，React Flow `onConnect` 写入当前 edges | 前端画布状态 | 前端交互和类型检查覆盖 |
| Workflow 画布 | 删除节点/连线 | 可用，删除选中节点或连线并同步画布状态 | 前端画布状态 | `npm test` 覆盖删除入口 |
| Workflow 画布 | Inspector 编辑 | 可用，支持名称、类型、Skill、条件、JSON 映射和配置 | 前端画布状态 | 类型检查覆盖 |
| Workflow 画布 | 保存草稿 | 可用，新建或更新草稿，保存后回到 Workflow 市场 | `POST/PUT /workflow-drafts` | 后端契约测试覆盖 |
| Workflow 画布 | 校验 | 可用，提交当前画布 graph | `POST /workflow-graphs/validate` | 既有前后端契约测试覆盖 |
| Workflow 画布 | 试运行 | 可用，要求先选择 Dataset Version | `POST /workflow-graphs/dry-run` | 既有后端契约测试覆盖 |
| Workflow 画布 | 发布 | 可用，提交当前画布 graph | `POST /workflow-graphs/publish` | 既有后端契约测试覆盖 |
| 执行中心 | 创建任务 | 可用，弹窗选择 Workflow/Dataset | `POST /tasks`、`GET /workflows`、`GET /datasets` | `npm test` 覆盖创建向导 |
| 执行中心 | 执行/暂停/恢复/取消/重试 | 可用，动作绑定任务并刷新列表 | `POST /tasks/{task_id}/execute|pause|resume|cancel|retry-failed` | `npm test` 覆盖执行状态刷新，后端测试覆盖动作 |
| 执行中心 | 任务详情/Trace Tree | 可用，按选中 Task 展示基础信息和 Trace Tree | `GET /tasks`、`GET /tasks/{task_id}/trace-tree` | 类型检查和后端测试覆盖 |
| 报告中心 | 导出 HTML/CSV | 可用，围绕选中任务导出底层 Run 报告 | `GET /tasks/{task_id}/report`、`GET /runs/{run_id}/report/export` | `npm test` 覆盖导出成功反馈 |
| 报告中心 | Badcase 加入 Golden | 可用，调用纠错 API | `POST /badcases/{badcase_id}/correct` | 前端 mutation 与后端服务能力覆盖 |
| Judge 审计 | 创建 Profile | 可用，弹窗保存 Profile | `POST /judge-profiles` | 人工验证和类型检查覆盖 |
| Judge 审计 | 创建审计 | 可用，弹窗提交审计标签 | `POST /judge-profiles/{profile_id}/audits` | `npm test` 覆盖审计表单 |
| 治理与审计 | 查看权限矩阵 | 可用，打开 RBAC 矩阵弹窗 | 前端静态矩阵 | `npm test` 覆盖矩阵弹窗 |
| 治理与审计 | Skill 启用/禁用/废弃 | 可用，调用治理 API 并刷新列表 | `POST /skills/{skill_id}/approve|disable|deprecate` | 前端 mutation 与后端 API 覆盖 |
| 治理与审计 | 审计日志 | 可用，展示后端审计事件 | `GET /audit-events` | 类型检查覆盖 |

## 当前仍需增强

- Workflow 画布已通过 Headless Chrome CDP 做核心烟测；还需要正式 Playwright E2E 覆盖拖拽、连线、删除、保存草稿、试运行、发布完整链路。
- Task 创建向导需要进一步加入权限检查、成本预算、CI Gate 和实验 baseline 对比。
- 报告中心需要把已实现的 Experiment/CI Gate/Annotation Queue/Trace Tree API 进一步做成独立可操作视图。
- Judge 审计需要增加多 Judge 一致性和红队安全扫描视图。
