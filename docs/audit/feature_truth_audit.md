# AegisQA Feature Truth Audit

## 审计结论

当前 AegisQA 已具备真实主链路：Dataset、Skill、Workflow、Task、Trace、Report、Badcase、Gate、Governance 和 Overview 工作台都能使用运行时数据完成本地试用闭环。项目仍不是生产完成状态：MySQL、Redis、Celery 和真实模型 Provider 有代码与配置资产，但尚缺少真实环境级 smoke 证明。

本文件用于约束后续口径：没有真实运行时数据、没有真实阻断效果、没有可复现验证证据的能力，不能写成生产完成；只能标记为 `unavailable`、`skipped`、`disabled` 或发布候选边界。

## 模块事实表

| 模块 | UI | API | 持久化 | 使用真实 Runtime 数据 | 阻断效果 | 测试覆盖 | Mock/Shell 状态 | 处理决策 | Required Fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dataset | 已接入 Dataset 页面和上传入口 | `/datasets/*` | JSON/SQLite/MySQL adapter | 是，Task/Report 使用真实 Dataset Version | Task 创建前可被 Preflight 阻断 | 后端、前端、E2E | 内置示例只用于本地演示 | 保留主流程 | 生产 smoke 中验证 MySQL 下 Dataset rows 与 metadata 一致 |
| Skill | Skill 市场、审批、合约测试 | `/skills/*`、Agent Skill 包路由 | package record、uploaded package | 是，Workflow/Task 使用已审批 Skill | 未审批/未启用 Skill 可阻断 Workflow/Task | 后端、前端、E2E | 示例 Skill 和 mock model 可用于离线验证 | 保留主流程 | 增加真实包上传的安全回归和依赖隔离验证 |
| Workflow | Workflow 市场和设计器 | `/workflow-*` | Workflow draft/version | 是，Task 运行引用发布版本 | Graph invalid、mapping invalid 可阻断发布/Preflight | 后端、前端、E2E | 模板是演示资产，不应冒充用户流程 | 保留主流程 | 继续减少模板/demo 对空态的影响 |
| Task | 执行中心和 Task 抽屉 | `/tasks/*` | Task/Run/Attempt | 是，状态来自真实 Run | Task 创建和执行前有 Preflight/Gate 阻断 | 后端、前端、E2E | 本地同步执行和线程池是真实本地路径 | 保留主流程 | 在 Celery worker 下验证异步执行、暂停、取消 |
| Preflight | Task 创建向导和详情证据 | `/tasks/preflight` | Task snapshot | 是，读取 Dataset/Workflow/Skill 状态 | 是，阻断 Task 创建或要求显式放行 | 后端、前端 | 无假通过 | 保留主流程 | 增加生产 smoke 中 blocking preflight 场景 |
| Trace | Trace Tree/Flow、Step 详情与调试抽屉 | `/tasks/{task_id}/trace-*`、`/runs/{run_id}/items/{item_id}/steps/{step_id}/replay|prompt-debug|repro-bundle` | Run item/step | 是，来自 RunItemStep | 不直接阻断，用于定位和 Replay | 后端、前端、E2E | 旧 Run 缺字段时降级展示；Replay 默认不隐式调用外部模型 | 保留主流程 | 扩展异常态、权限态和 override input 的调试覆盖 |
| Report | Report 页面、导出、推荐动作 | `/tasks/{task_id}/report` | Report 聚合与导出 | 是，来自 Run/Step/Quality/Gate | Gate failed 可形成阻断证据 | 后端、前端、E2E | cost/token 缺失时显示 unavailable | 保留主流程 | 真实 provider usage/cost smoke |
| Badcase | Report Badcase 明细和修复入口 | Report/Repair/Productization 路由 | Badcase/Repair task | 是，来自 Step/Quality/Gate evidence | 可进入修复任务，不直接阻断执行 | 后端、前端、E2E | 聚类向量仍为轻量本地规则 | 保留主流程 | 用真实 evidence 强约束 source_id/source 类型 |
| Quality | Report 与 Gate 关联展示 | quality/gate 相关聚合 | Run/Report/Gate payload | 部分，真实规则已接入，缺数据返回 skipped | 部分，Gate 失败可阻断 | 后端 | 禁止假分数和假建议 | 保留但继续硬化 | 增加规则覆盖矩阵和 skipped reason 测试 |
| Gate | Preflight、Quality Gate、CI Gate | Gate/Productization 路由 | Gate config/result | 是，读取 Task/Report 指标 | 是，CI Gate 可阻断低通过率任务 | 后端、前端、E2E | 无真实数据时 skipped | 保留主流程和治理入口 | 统一更多历史 gate payload 到 GateEvaluator |
| CI Gate | feature flag/治理入口，默认隐藏 | Productization CI Gate API | Gate configs/history | 是，基于任务指标 | 是，已验证低通过率阻断 | 后端、前端、E2E | 高级治理能力，默认受 flag 控制 | 保留但不夸大生产 | 生产 smoke 中加入失败阻断样例 |
| Experiment | 高级页面，默认隐藏 | Productization API | Experiment snapshots | 部分，依赖来源任务 | 不作为主阻断 | 后端、前端 | 试用级能力 | 保留为高级模块 | 补来源任务为空和权限态测试 |
| Repair Task | 修复任务工作台 | `/repair-tasks/*` | Repair task tree | 是，来自 Badcase/Report evidence | 不阻断执行，支撑闭环 | 后端、前端 | 规则建议为本地可解释逻辑 | 保留为闭环能力 | 增加从 Repro Bundle 创建修复任务 |
| Candidate Assets | 高级页面，默认隐藏 | Productization API | Candidate records | 部分，依赖候选来源 | 可受 CI Gate 阻断 | 后端、前端 | 试用级能力 | 默认不进主流程 | 继续保持 flag/disabled 口径并补晋升异常态 |
| Annotation | Annotation Queue，默认隐藏 | Productization API | Annotation tasks | 是，来自任务样本 | 不阻断执行 | 后端、前端、E2E | 人审回流是试用级闭环 | 保留为高级模块 | 增加审核结果回流 Golden 的审计证据 |
| Judge | Judge Audit 页面，默认隐藏 | Judge/Profile API | Judge audit/trends | 部分，真实数据可接入，趋势可计算 | 不直接阻断主任务 | 后端、前端 | mock provider 可用于离线 | 保留为治理能力 | 真实 provider 下验证 judge prompt trace |
| Assertion | 断言规则 | Task/Report/Gate 聚合 | Run/Report | 是，规则透明可复现 | 可影响 Gate | 后端 | 无黑盒假判断 | 保留 | 增加更多断言错误码和 UI evidence |
| Governance | Governance 页面 | `/governance/runtime-status`、audit | Audit events/config | 是，展示当前运行边界 | 权限与审批可阻断部分操作 | 后端、前端 | runtime-status 明确 not_connected | 保留主导航 | 生产 smoke 验证 MySQL/Redis/Celery 状态 |
| Cost | Report usage/cost | 模型网关与 Report 聚合 | Run metrics | 部分，仅 provider 返回 usage/cost 时真实 | 可影响预算 Gate | 后端、前端 | 缺失时 unavailable，不伪造 | 保留但降噪 | 真实 provider cost source 验证 |
| Red Team | Report 安全扫描入口 | Productization/Report 规则 | Report payload | 部分，本地透明规则 | 不直接阻断，除非 Gate 引用 | 后端、前端 | 本地规则，不是模型红队 | 保留为试用能力 | 明确规则来源和边界 |

## 当前必须避免的错误口径

- 不说“已完成生产化平台”。
- 不把 mock provider 的 token/cost 写成真实成本。
- 不把 MySQL/Redis/Celery 的代码资产写成已通过生产环境。
- 不把高级治理模块写成主流程必备能力。
- 不把缺失 evidence 的 root cause/recommendation 展示成确定结论。

## 下一轮优先修复

1. 使用 `scripts/smoke_production_like.ps1 -StartCompose` 验证 MySQL、Redis、Celery 和 API/Worker 主链路。
2. 使用真实 `openai_compatible` provider 验证 secret_ref、token usage、cost source 和 Prompt/Trace 输出。
3. 扩展 Replay、Prompt Debug、Repro Bundle 的异常态、权限态和 override input 覆盖。
4. 持续回归 feature flag、disabled 页面和主导航收口规则，避免高级模块重新进入默认主流程。
