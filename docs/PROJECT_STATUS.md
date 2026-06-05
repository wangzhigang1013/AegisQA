# AegisQA 项目状态

## 当前阶段

AegisQA 当前处于“工程化 MVP 已成型，发布候选硬化中”。核心主链路已经具备真实 Dataset、Skill、Workflow、Task、Trace、Report、Badcase、Gate、治理审计和体验工作台；本轮继续把系统从“功能可用”推进到“可交付试用、可定位问题、可回放主链路”的状态。

当前最新批次已经完成：

- Feature flags 启动时会合并后端 `/features` 返回值，后端开启的高级模块可进入前端导航；默认关闭仍保持隐藏。
- CI Gate 缺少真实指标时返回 `skipped`，不再把缺失 cost/error 等指标当作 0 生成假 passed。
- Step Replay live 模式在 output schema invalid 时保留 raw output、清空 validated output，并返回 `OUTPUT_SCHEMA_INVALID`。
- Step Replay、Prompt Debug、Repro Bundle 均有 Viewer 权限拒绝回归；Repro Bundle GET 已补权限门禁和审计。
- 新增 `ArtifactStore` / `LocalArtifactStore`，提供本地产物写入、读取、元数据、大小限制和路径安全检查，并挂载到 `app.state.artifact_store`。
- Step Repro Bundle 已写入 ArtifactStore 的 `repro_bundles` 命名空间，并在 API 响应中返回 artifact metadata，导出产物不再只是瞬时 JSON。
- Skill Package 上传原始 zip 已写入 ArtifactStore 的 `skill_packages` 命名空间，上传响应和包记录会返回 artifact metadata，后续可按 sha256 与 artifact_id 追溯原始包。
- Task Report JSON/CSV/HTML 导出已写入 ArtifactStore 的 `reports` 命名空间，导出响应和审计事件会带 artifact metadata / artifact_id。
- 模型网关 provider HTTP/network 错误详情会统一脱敏，避免外部服务回显 Authorization 或 API key 时泄漏。
- Skill Package 上传会记录可执行/二进制文件、直接模型 SDK 调用和疑似硬编码 API key 的结构化 warning。
- Trace Flow、Trace Tree 和 Report 页面加载失败时显示结构化错误码和 `trace_id`，便于定位后端请求。
- production-like smoke 脚本在 `-StartCompose` 时先检查 Docker CLI/Compose 可用性；本机当前未安装或未暴露 `docker`，真实 MySQL/Redis/Celery smoke 未通过。
- Overview 工作台使用真实 `/overview/workbench` 聚合数据，不再拉取完整 Run 列表，也不使用 demo 兜底。
- Task 详情、Trace Step、Report 推荐动作统一围绕真实证据和下一步动作展示。
- 后端动作对象已统一为 `id/action/label/enabled/disabled/target_url/target/payload/evidence` 兼容契约。
- 前端新增统一动作类型和 `actionRouter`，报告推荐动作不再各自解析字符串。
- API 响应新增 `X-AegisQA-Request-ID`，错误 payload 的 `trace_id` 与请求头一致，便于前后端联动定位。
- 本地 runtime smoke 脚本已可自动避开被旧服务占用的 8000 端口，并验证 Dataset -> Workflow -> Task -> Trace -> Report -> Workbench 主链路。
- 新增浏览器级体验 E2E，覆盖 Overview、Task 抽屉、Trace Step 详情、Report 推荐动作和 Badcase 批量修复入口。
- 前端 Vitest 已限制为 2 个 worker，避免多个完整 AppShell 与 Ant Design 重页面并发渲染导致懒加载等待超时。
- 旧的超长状态日志已归档到 `docs/status_archive/2026-06-05-project-status-archive.md`。
- `docs/audit/feature_truth_audit.md` 与 `docs/audit/rebuild_completion_audit.md` 已恢复，状态文档不再引用不存在的审计文件。
- 新增分层发布验证脚本，默认走 docs/targeted 轻量验证，只有发布候选前才跑 full release 回归。
- 新增 production-like smoke 脚本骨架，显式 `-StartCompose` 时才启动 Docker 验证 MySQL、Redis、Celery 和 API/Worker。
- 新增真实模型 Provider smoke 脚本，默认只验证连接别名和密钥不回显，显式 `-LiveCall` 时才发真实模型请求。
- 新增 Step Replay、Prompt Debug 和 Repro Bundle 后端 API，Trace Flow 动作入口不再只是空链接。
- Trace Flow Step 调试抽屉已接入 Replay、Prompt Debug、Repro Bundle 调用，前端可直接查看接口返回证据，并已有浏览器级 E2E 覆盖。
- 新增统一 feature flag 机制，高级模块默认从主导航隐藏，直达路由显示 Experimental / Disabled 状态。
- `docker-compose.yml` 已补 MySQL/Redis healthcheck，并确保 API 容器安装 Celery 后再启用 Celery executor。
- 历史 `tmp-report-debug*` 与 `tmp-report-gate-debug/` 调试目录已加入忽略规则，避免污染 `git status`。

## 最近改动

### 2026-06-05 Task Report ArtifactStore 接入

- 改动摘要：继续补齐 ArtifactStore 主资产接入，把 Task Report 导出从一次性响应提升为可追溯、可校验、可读回的报告产物。
- 主要变更：
  - `GET /tasks/{task_id}/report/export` 在生成 JSON/CSV/HTML 内容后写入 ArtifactStore 的 `reports` 命名空间。
  - 导出响应新增 `artifact` 元数据，包含 `kind`、`artifact_id`、`size_bytes`、`sha256`、`content_type`、`storage_path`、业务 metadata 和 `created_at`。
  - `task.report.export` 审计 detail 新增 `artifact_id`，支持从审计记录追溯到具体导出文件。
  - 新增回归断言，验证 JSON 报告导出的 artifact metadata 可用于从 `app.state.artifact_store` 读回完整坏例明细。
- 验证：
  - 红灯验证：`python -m pytest tests/test_task_report_badcase_pagination.py::test_task_report_badcases_are_paginated_without_truncating_export -q` 初始失败，缺少 `exported["artifact"]`。
  - `python -m pytest tests/test_task_report_badcase_pagination.py::test_task_report_badcases_are_paginated_without_truncating_export -q`：1 passed；仅 Starlette/httpx2 依赖弃用警告。
  - `python -m pytest tests/test_task_report_badcase_pagination.py tests/test_task_center_api.py::test_viewer_can_export_task_report_after_admin_approval tests/test_task_center_api.py::test_task_report_offline_package_contains_audit_bundle_and_uses_export_approval tests/test_task_center_api.py::test_report_export_request_lifecycle_reject_revoke_and_expire tests/test_artifact_store.py -q`：12 passed；仅 Starlette/httpx2 依赖弃用警告。
  - 本批只触碰 Task Report 导出 ArtifactStore 接入和定向测试，没有运行后端全量、前端测试或 E2E。

### 2026-06-05 Skill Package ArtifactStore 接入

- 改动摘要：继续补齐 ArtifactStore 主资产接入，把 Skill Package 上传的原始 zip 从普通本地文件提升为可追溯、可校验、可读回的产物记录。
- 主要变更：
  - `POST /skills/packages/upload` 调用 `_install_skill_package` 时注入 `ctx.artifact_store`。
  - `_install_skill_package` 将通过校验并注册成功的原始 zip 写入 ArtifactStore 的 `skill_packages` 命名空间。
  - 上传响应和 `skill_packages` 持久化记录新增 `artifact` 元数据，包含 `kind`、`artifact_id`、`size_bytes`、`sha256`、`content_type`、`storage_path`、业务 metadata 和 `created_at`。
  - 上传文件名先规整为安全 basename 后写入本地包目录和 ArtifactStore；原始文件名保留在 `original_filename`。
  - 新增回归测试，验证 API 返回的 artifact metadata 可用于从 `app.state.artifact_store` 读回原始 zip。
- 验证：
  - 红灯验证：`python -m pytest tests/test_skill_package_security.py::test_skill_package_upload_persists_original_zip_in_artifact_store -q` 初始失败，缺少 `uploaded["artifact"]`。
  - `python -m pytest tests/test_skill_package_security.py::test_skill_package_upload_persists_original_zip_in_artifact_store -q`：1 passed；仅 Starlette/httpx2 依赖弃用警告。
  - `python -m pytest tests/test_skill_package_security.py tests/test_artifact_store.py -q`：21 passed；仅 Starlette/httpx2 依赖弃用警告。
  - 本批只触碰 Skill Package ArtifactStore 接入和定向测试，没有运行后端全量、前端测试或 E2E。

### 2026-06-05 Repro Bundle ArtifactStore 接入

- 改动摘要：继续执行优化计划中 ArtifactStore 与可回放产物的剩余缺口，把 Step Repro Bundle 从瞬时响应推进为可落盘、可审计、可后续下载/复现的本地产物。
- 主要变更：
  - `RouteContext` 新增 `artifact_store` 依赖，`create_app()` 将 `LocalArtifactStore(store.root / "artifacts")` 注入路由上下文。
  - `GET /runs/{run_id}/items/{item_id}/steps/{step_id}/repro-bundle` 生成 bundle 后写入 ArtifactStore 的 `repro_bundles` 命名空间。
  - Repro Bundle 响应新增 `artifact` 元数据，包含 `kind`、`artifact_id`、`size_bytes`、`sha256`、`content_type`、`storage_path`、业务 metadata 和 `created_at`。
  - 更新 `tests/test_experience_efficiency.py`，验证 API 返回的 artifact metadata 可用于从 `app.state.artifact_store` 读回真实 JSON bundle。
- 验证：
  - 红灯验证：`python -m pytest tests/test_experience_efficiency.py::test_step_replay_prompt_debug_and_repro_bundle_are_callable -q` 初始失败，缺少 `bundle["artifact"]`。
  - `python -m pytest tests/test_experience_efficiency.py::test_step_replay_prompt_debug_and_repro_bundle_are_callable -q`：1 passed；仅 Starlette/httpx2 依赖弃用警告。
  - `python -m pytest tests/test_experience_efficiency.py tests/test_artifact_store.py -q`：15 passed；仅 Starlette/httpx2 依赖弃用警告。
  - 本批只触碰 Repro Bundle ArtifactStore 接入和定向测试，没有运行后端全量、前端测试或 E2E。

### 2026-06-05 Reality-First 优化计划第二批硬化

- 改动摘要：继续执行当前优化计划，聚焦 Feature Flag 同步、Replay/Prompt Debug/Repro 权限与异常态、真实质量门禁 skipped、模型网关脱敏、ArtifactStore、安全包 warning、Worker 控制证明和前端诊断错误详情。
- 主要变更：
  - 前端启动后调用 `/features`，通过 `mergeFeatureFlags` 合并后端 flags 与本地 `VITE_ENABLE_*`，避免前后端开关状态不一致。
  - CI Gate 评估缺失真实指标时返回 `skipped` 和明确 reason，不再把缺失指标按 0 处理；Productization、baseline guard 和 Repair Task 复测入口统一使用 gate status 归并函数。
  - live Step Replay 增加 input/config/output schema 校验；output schema 失败时保留 `raw_output`、返回空 `validated_output` 和 `OUTPUT_SCHEMA_INVALID`。
  - Repro Bundle GET 增加 `role/actor` 查询参数、`run:create` 权限门禁和审计记录；Viewer 会被 Replay、Prompt Debug、Repro Bundle 拒绝。
  - 新增 `aegisqa/storage/artifacts.py`，实现 `ArtifactStore`、`LocalArtifactStore`、结构化错误、元数据、路径穿越/绝对路径/大小限制校验，并挂载到 `app.state.artifact_store`。
  - 模型网关 HTTP/network 错误详情通过 `redact_secrets` 脱敏，避免 provider 错误 body 回显密钥。
  - Skill Package zip 安全扫描新增 warning：可执行/二进制文件、直接模型 SDK 调用、疑似硬编码 API key；不阻断历史包上传，但审批证据可见。
  - Worker 状态机新增运行中 cancel 回归，证明 cancel 后不启动后续 RunItem；pause/cancel 同级覆盖。
  - Trace Flow、Trace Tree、Report 页面加载失败 Alert 增加 `formatApiError` description，展示错误码与 `trace_id`。
  - `scripts/smoke_production_like.ps1` 增加 Docker CLI/Compose 前置检查和 `$composeStarted` 清理保护。
- 验证：
  - 红灯验证：`python -m pytest tests/test_productization_api.py::test_ci_gate_missing_metric_is_skipped_instead_of_fake_passed -q` 初始失败，缺失 `cost` 被判为 passed。
  - 红灯验证：`python -m pytest tests/test_artifact_store.py -q` 初始失败，缺少 `aegisqa.storage.artifacts`。
  - 红灯验证：`python -m pytest tests/test_model_gateway.py::test_model_gateway_http_error_redacts_provider_body_secrets -q` 初始失败，provider body 泄漏 `sk-*`。
  - 红灯验证：`python -m pytest tests/test_experience_efficiency.py::test_step_debug_endpoints_reject_viewer_role -q` 初始失败，Repro Bundle 对 Viewer 返回 200。
  - 红灯验证：`npm test -- App.test.tsx -t "Trace Flow 加载失败时展示后端错误码和 trace_id|报告加载失败时展示后端错误码和 trace_id"` 初始失败，页面未展示结构化错误详情。
  - `python -m pytest tests/test_artifact_store.py tests/test_skill_package_security.py tests/test_model_gateway.py tests/test_model_usage_billing.py tests/test_experience_efficiency.py tests/test_platform_core.py::test_workflow_runner_honors_pause_requested_during_active_execution tests/test_platform_core.py::test_workflow_runner_honors_cancel_requested_during_active_execution tests/test_productization_api.py::test_assertion_dsl_and_ci_gate_return_actionable_results tests/test_productization_api.py::test_ci_gate_missing_metric_is_skipped_instead_of_fake_passed tests/test_productization_api.py::test_ci_gate_config_can_be_saved_and_evaluated_against_run_and_task tests/test_productization_api.py::test_ci_gate_evaluation_history_is_saved_and_filterable -q`：47 passed；仅 Starlette/httpx2 依赖弃用警告。
  - `cd frontend && npm run typecheck`：passed。
  - `cd frontend && npm test -- App.test.tsx -t "默认隐藏高级模块导航|启动后合并后端 feature flags|Trace Flow 加载失败时展示后端错误码和 trace_id|报告加载失败时展示后端错误码和 trace_id|Trace Flow Step 抽屉"`：5 passed。
  - `.\scripts\smoke_production_like.ps1 -StartCompose`：失败，稳定报错为 Docker CLI 不可用；本机未安装或未暴露 `docker`，因此未完成真实 MySQL/Redis/Celery 环境级 smoke。
  - 本批没有运行后端全量、前端全量 Vitest 或 Playwright E2E；按当前计划只跑受影响面的定向验证。

### 2026-06-05 Feature Flag 主导航降噪

- 改动摘要：落实 Phase 0 的主线降噪要求，新增后端 `/features` 和前端 `features.ts`，默认关闭 CI Gate、候选资产、修复任务、实验中心、人工审核和 Judge 审计入口。
- 主要变更：
  - 新增 `aegisqa/core/features.py`，统一读取 `AEGISQA_ENABLE_<FEATURE>`，默认值全部为 false。
  - 新增 `GET /features`，返回当前 flags、defaults 和后端环境变量前缀。
  - 新增 `frontend/src/features.ts`，读取 `VITE_ENABLE_<FEATURE>`，并允许测试显式覆盖。
  - AppShell 主导航按 flag 过滤高级模块；用户直达 disabled 路由时显示 `Experimental / Disabled` 和对应环境变量提示。
  - Playwright E2E 配置显式开启高级模块 flags，保证已有产品化 E2E 继续覆盖高级页面。
  - `docs/audit/rebuild_completion_audit.md` 已同步新增 Feature Flag 降噪证据，明确这是试用级收口，不代表高级模块生产完成。
- 验证：
  - 红灯验证：`python -m pytest tests/test_feature_flags.py -q` 初始失败，缺少 `aegisqa.core.features`。
  - 红灯验证：`npm test -- App.test.tsx -t "默认隐藏高级模块导航"` 初始失败，高级导航仍可见。
  - `python -m pytest tests/test_feature_flags.py -q`：2 passed；仅 Starlette/httpx2 依赖弃用警告。
  - `npm test -- App.test.tsx -t "默认隐藏高级模块导航"`：1 passed。
  - `npm test -- App.test.tsx -t "展示主导航|默认隐藏高级模块导航|CI Gate 页面支持创建配置|Experiment 实验中心|Annotation Queue 人工审核|候选资产中心支持审批|Judge 审计创建"`：5 passed；该筛选未命中 Experiment/Annotation 的准确用例名。
  - `npm test -- App.test.tsx -t "Experiment 页面展示|Annotation Queue 页面支持来源任务筛选"`：2 passed。
  - `npm run typecheck`：passed。
  - 本批没有运行前端全量 Vitest、全量 Playwright 或后端全量。

### 2026-06-05 Trace Flow Step 调试抽屉接入

- 改动摘要：继续落实优化计划 P3，把 Trace Flow 页面中已有的 Step 动作按钮接到真实后端调试接口，并在同一个 Step 抽屉中展示 resolved/raw/validated/schema/LLM call 与接口返回预览。
- 主要变更：
  - 新增前端 API client 方法：`replayRunItemStep`、`debugRunItemStepPrompt`、`runItemStepReproBundle`。
  - Trace Flow 的 `Replay Step`、`Prompt Debug`、`导出 Repro Bundle` 从占位链接改为按钮调用，不再跳转到无效查询页。
  - 新增 Step 调试抽屉，展示 Step 基础信息、Resolved Input、Raw Output、Validated Output、Schema Errors、LLM Calls 和调试结果预览。
  - 更新 `frontend/src/test/App.test.tsx`，覆盖三个动作会请求对应后端接口并展示返回证据。
  - 更新 `frontend/e2e/experience-workbench.spec.ts`，浏览器级验证 Trace Flow Step 调试抽屉可触发 Replay、Prompt Debug 和 Repro Bundle。
- 验证：
  - 红灯验证：`npm test -- App.test.tsx -t "Trace Flow Step 抽屉"` 初始失败，失败原因为页面中没有可调用的 `Replay Step` 按钮。
  - `npm test -- App.test.tsx -t "Trace Flow Step 抽屉"`：1 passed。
  - `npm test -- App.test.tsx -t "Trace Flow"`：4 passed。
  - `npm run typecheck`：passed。
  - `npm run e2e -- experience-workbench.spec.ts`：1 passed。
  - 本批只触碰 Trace Flow 前端接入、类型、相关 E2E 和状态文档，没有运行前端全量 E2E、前端全量 Vitest 或后端全量。

### 2026-06-05 Step Replay / Debug / Repro 后端闭环

- 改动摘要：继续落实优化计划 P3，把 Trace Flow 中已经展示的 Replay、Prompt Debug、Repro Bundle 动作接成真实后端接口，默认不隐式调用外部模型。
- 主要变更：
  - 新增 `POST /runs/{run_id}/items/{item_id}/steps/{step_id}/replay`，支持 original/override input、override config、disable cache 和 `mock_llm_calls`。默认 `mock_llm_calls=true` 时只返回可复现输入与历史输出，不重新执行 Skill；显式设为 false 时才重新执行 Skill。
  - 新增 `POST /runs/{run_id}/items/{item_id}/steps/{step_id}/prompt-debug`，基于 Step 快照返回 rendered prompt、prompt_calls、schema_validation 和 token usage；不会隐式调用外部模型。
  - 新增 `GET /runs/{run_id}/items/{item_id}/steps/{step_id}/repro-bundle`，导出 workflow、skill manifest、resolved input、raw/validated output、schema errors、prompt/LLM calls、错误和后续 debug endpoint。
  - 更新 `tests/test_experience_efficiency.py`，覆盖三类接口可调用并返回真实 Run/Step 证据。
- 验证：
  - `python -m pytest tests/test_experience_efficiency.py -q`：5 passed；仅 Starlette/httpx2 依赖弃用警告。
  - `.\scripts\verify_release_candidate.ps1 -Scope docs`：passed。
  - `git diff --check`：passed；仅 Git 提示工作区文件后续可能按 CRLF 写入。
  - 本批只改后端调试接口和定向测试，没有运行前端全量、E2E 或后端全量；后续触碰前端抽屉交互时再跑对应前端定向测试。

### 2026-06-05 优化计划 P0/P6 落地

- 改动摘要：落实当前优化计划的第一批低风险事项，重点是修正文档真实性、恢复审计材料、固化分层验证策略，并为生产类环境 smoke 提供可执行脚本。
- 主要变更：
  - 新增 `docs/audit/feature_truth_audit.md`，逐模块记录 UI、API、持久化、真实 runtime 数据、阻断效果、测试覆盖、mock/shell 状态、处理决策和 Required Fix。
  - 新增 `docs/audit/rebuild_completion_audit.md`，把当前结论限定为“发布候选/小团队试用”，并列出 MySQL、Redis、Celery、真实模型 Provider 和 Replay/Repro 的剩余缺口。
  - 新增 `scripts/verify_release_candidate.ps1`，提供 `docs`、`targeted`、`release` 三档验证，避免小改动后反复运行全量测试。
  - 新增 `scripts/smoke_production_like.ps1`，复用 `docker-compose.yml`，在显式传 `-StartCompose` 时验证 MySQL + Redis + Celery + API/Worker 异步执行链路。
  - 新增 `scripts/smoke_model_provider.ps1`，用于验证 openai-compatible 模型连接别名、secret_ref 和临时密钥不持久化；默认不发真实模型请求。
  - 更新 `docker-compose.yml`，为 MySQL/Redis 增加 healthcheck，并让 API 容器安装 Celery 依赖后再使用 Celery executor。
  - 更新 `.gitignore`，忽略历史 `tmp-report-debug*/` 与 `tmp-report-gate-debug/` 调试目录。
  - 更新 `docs/RELEASE_READINESS.md`、`docs/RUNTIME_SMOKE.md` 和 `docs/tutorials/connect-real-model.md`，记录分层验证、production-like smoke 和 provider smoke 使用方式。
- 验证策略：
  - 本批主要是文档、脚本和忽略规则改动，不立即跑后端/前端全量测试。
  - `.\scripts\verify_release_candidate.ps1 -Scope docs`：通过。
  - PowerShell 语法解析：`scripts/verify_release_candidate.ps1`、`scripts/smoke_production_like.ps1`、`scripts/smoke_runtime.ps1`、`scripts/smoke_model_provider.ps1` 均通过。
  - `scripts/smoke_model_provider.ps1` 未执行真实 provider 调用；当前未提供真实 `BaseUrl`、`DefaultModel` 和密钥环境变量，本轮只验证脚本语法、文档和密钥不回显设计。
  - `docker-compose.yml` PyYAML 结构检查：通过，确认 mysql/redis/api/worker 服务、healthcheck 和 `service_healthy` 依赖存在。
  - `docker compose -f docker-compose.yml config`：未执行成功，当前机器未安装或未暴露 `docker` 命令；未启动任何容器。
  - `git diff --check`：通过，仅 Windows LF/CRLF 提示。
  - `git status --short --branch --untracked-files=all`：不再显示 `.runtime-smoke/`、`.e2e-artifacts/` 或历史 `tmp-report-*` 调试目录。
  - 仅在后续改动触碰 API/前端契约时运行 targeted；发布候选前再集中执行 `-Scope release`。

### 2026-06-05 发布候选体验与运行时硬化

- 改动摘要：在体验效率优化基础上继续完成发布前优化计划的 Phase 0-6：补齐 build/e2e 验证，统一动作契约，新增 runtime smoke，新增体验主链路 E2E，补 request id 诊断信息，瘦身项目状态文档，并完成发布候选验证。
- 主要变更：
  - 新增 `aegisqa/api/actions.py`，统一后端动作描述结构并保留旧 `action` 字段兼容。
  - 更新 `aegisqa/api/experience.py`，Overview、Task、Trace、Report 动作均通过统一构造器生成。
  - 更新 `aegisqa/api/app.py`，新增 request id middleware 和错误响应 trace id 对齐。
  - 新增 `frontend/src/types/actions.ts` 和 `frontend/src/actions/actionRouter.ts`。
  - 更新 `frontend/src/pages/ReportsPage.tsx`、`TraceFlowPage.tsx`、`TaskOperationsDrawer.tsx`，统一动作读取和分发。
  - 新增 `scripts/smoke_runtime.ps1` 和 `docs/RUNTIME_SMOKE.md`。
  - 新增 `frontend/e2e/experience-workbench.spec.ts`。
  - 更新 `frontend/e2e/task-flow-helpers.ts`，修复 Badcase 标题严格匹配。
  - 更新 `frontend/vitest.config.ts`，把前端单测文件级 worker 收敛为 2，稳定全量 Vitest。
  - 更新 `.gitignore`，忽略 `.runtime-smoke/` 运行产物。
  - 新增 `docs/RELEASE_READINESS.md`，记录发布候选验收标准、已知边界和回滚策略。
  - 新增 `docs/status_archive/2026-06-05-project-status-archive.md`，保存完整历史状态日志。
- 已执行验证：
  - `python -m pytest -q`：通过，后端全量测试通过；仅 Starlette/httpx2 依赖弃用警告。
  - `cd frontend && npm run typecheck`：通过。
  - `cd frontend && npm test`：通过，12 个测试文件、133 passed。
  - `cd frontend && npm run build`：通过。
  - `cd frontend && npm run e2e`：通过，15 passed。
  - `.\scripts\smoke_runtime.ps1`：通过；当前机器 8000 被非 AegisQA 旧服务占用，脚本自动切到 8020 并完成主链路，结束后 8020 无残留监听。最近一次 Task 为 `task-cd1c24d82fe7`，Run 为 `run-5e4aecbc0611`。
  - `git diff --check`：通过；仅 Windows 工作区 LF/CRLF 提示。
  - `npm run build`：通过。
  - `npm run e2e`：14 passed；修复抽屉旧 query 遮住执行后状态、Badcase 标题多匹配后重新通过。
  - `npx playwright test e2e/task-execution.spec.ts e2e/task-report.spec.ts`：2 passed。
  - `python -m pytest tests/test_experience_efficiency.py -q`：4 passed。
  - `python -m pytest tests/test_api_frontend_contract.py::test_api_request_id_is_returned_in_headers_and_error_payload tests/test_experience_efficiency.py -q`：5 passed。
  - `cd frontend && npm run typecheck`：通过。
  - `cd frontend && npm test -- src/test/App.test.tsx src/test/ReportsPage.test.tsx`：2 个测试文件、89 passed。
  - `npx playwright test e2e/experience-workbench.spec.ts`：1 passed。
- 当前限制：
  - 本轮最终验证栈已通过，但尚未做 MySQL/Redis/Celery/真实模型 provider 的环境级 smoke。
  - MySQL/Redis/Celery 仍以代码路径、fake adapter 和可选编排资产为主，真实容器 smoke 仍是发布前单独事项。
  - 当前分支已有发布候选提交 `e387cb7`，后续新增优化会单独提交；`tmp-report-debug*` 是历史调试目录，已通过 `.gitignore` 排除。

## 发布候选提交前检查

- 最终验证栈已完成：`python -m pytest -q`、`cd frontend && npm run typecheck`、`cd frontend && npm test`、`cd frontend && npm run build`、`cd frontend && npm run e2e`、`.\scripts\smoke_runtime.ps1`、`git diff --check`。
- 确认 `scripts/smoke_runtime.ps1` 在当前机器通过，且没有残留自己启动的端口：已通过，8020 无残留监听。
- 复查 `git status --short --untracked-files=all`，只提交项目文件，不提交 `.runtime-smoke/` 和历史 `tmp-report-debug*`。
- 形成 release candidate commit；如果需要推送，再推送当前分支。

## 历史归档

- 完整历史状态：`docs/status_archive/2026-06-05-project-status-archive.md`
- Reality-first 审计：`docs/audit/feature_truth_audit.md`、`docs/audit/rebuild_completion_audit.md`
- Runtime smoke 说明：`docs/RUNTIME_SMOKE.md`
- 发布就绪清单：`docs/RELEASE_READINESS.md`
