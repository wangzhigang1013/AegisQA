# AegisQA Rebuild Completion Audit

## 审计时间

2026-06-05

## 总体判断

AegisQA 的 Reality-First Rebuild 已达到“工程化 MVP 已成型、发布候选可试用”的阶段。主链路已经有真实数据闭环和回归验证；生产化仍未完成，原因是 MySQL/Redis/Celery/真实模型 Provider 缺少环境级 smoke 证据。

因此当前完成结论应写为：

> 已具备小团队试用和演示所需的真实评测主链路，生产部署前仍需完成外部基础设施与真实模型 Provider 的环境级验证。

## 已完成证据

| 领域 | 当前证据 | 结论 |
| --- | --- | --- |
| 主链路 | Dataset -> Skill -> Workflow -> Task -> Trace -> Report -> Badcase -> Gate -> Workbench 已有 API/UI/E2E 覆盖 | 完成试用级闭环 |
| 体验工作台 | `/overview/workbench` 使用真实 store 聚合，不拉完整 Run 列表，不用 demo 兜底 | 完成 |
| Action Contract | 后端动作结构统一为 `id/action/label/enabled/disabled/target_url/target/payload/evidence`，前端使用 `actionRouter` | 完成 |
| 诊断链路 | API 返回 `X-AegisQA-Request-ID`，错误 payload `trace_id` 与请求头对齐 | 完成 |
| Feature Flag 降噪 | `GET /features`、前端 `features.ts`、主导航过滤和 disabled route 已有定向测试；高级模块默认隐藏，不进入主流程 | 完成试用级收口 |
| Feature Flag 同步 | 前端启动后合并后端 `/features`，后端开启的高级模块可进入导航，同时本地显式开启不会被后端默认 false 覆盖 | 完成 |
| Gate 真实性 | CI Gate 缺失真实指标返回 `skipped` 和 reason，不再把缺失指标按 0 生成假 passed | 完成 |
| Step Debug/Repro | Replay schema invalid 保留 raw output；Replay、Prompt Debug、Repro Bundle 都有 Viewer 权限拒绝回归；Repro Bundle 写入 ArtifactStore 并返回 artifact metadata | 完成试用级闭环 |
| ArtifactStore | 新增 `ArtifactStore` / `LocalArtifactStore`，本地支持产物写入、读取、元数据、路径安全和大小限制；Dataset 上传/物化已接入 `uploaded_datasets`，Step Repro Bundle 已接入 `repro_bundles`，Skill Package 原始 zip 已接入 `skill_packages`，Task Report 导出已接入 `reports`，模型类 Step 已接入 `rendered_prompts` / `raw_llm_responses` | 完成最小接口和六类主产物接入 |
| Skill 包安全 | 上传包安全扫描记录可执行/二进制文件、直接模型 SDK 调用、疑似硬编码 API key warning | 完成第一版 |
| 模型网关安全 | secret_ref/临时 api_key 不持久化，provider usage/cost 和缺失 usage 都有回归；HTTP/network 错误详情已脱敏 | 完成本地可验证部分 |
| 本地 runtime smoke | `scripts/smoke_runtime.ps1` 已验证本地 JSON/SQLite 试用主链路，可自动避开非 AegisQA 8000 服务 | 完成 |
| 前端稳定性 | Vitest 限制 2 worker，避免重页面并发导致懒加载超时 | 完成 |
| 发布文档 | `docs/RELEASE_READINESS.md` 与 `docs/PROJECT_STATUS.md` 明确发布候选口径 | 完成 |

## 尚未完成证据

| 领域 | 缺口 | 当前状态 | 下一步 |
| --- | --- | --- | --- |
| MySQL | 需要真实 MySQL 容器下跑主链路 | 有 adapter 和 compose；本机 `docker` 不可用，production-like smoke 未执行成功 | 在安装 Docker 的目标环境跑 `scripts/smoke_production_like.ps1 -StartCompose` |
| Redis | 需要真实 Redis 限流/队列配置验证 | 有 rate limiter 和 compose；缺环境级证据 | 生产类 smoke 检查 runtime-status |
| Celery | 需要 API 提交后台任务并由 worker 完成 | 有 executor/worker 入口；缺异步 smoke 结果 | production-like smoke 使用 `background=true` 执行并轮询 |
| 真实模型 Provider | 需要真实 openai-compatible endpoint、secret_ref、usage/cost 验证 | 本地 mock/fake provider 已覆盖 secret 与 usage 规则，真实 LiveCall 未验 | 提供 BaseUrl/DefaultModel/Secret 后跑 provider smoke `-LiveCall` |
| ArtifactStore 接入 | 需要验证生产 ArtifactStore 后端与历史产物迁移策略 | Dataset 上传/物化、Repro Bundle、Skill Package 原始 zip、Task Report 导出、rendered prompts 和 raw llm responses 已接入本地 ArtifactStore；外部对象存储/历史迁移未验证 | 在生产类环境验证 ArtifactStore 后端，并补历史数据迁移计划 |

## 阶段判定

| 阶段 | 判定 | 说明 |
| --- | --- | --- |
| Feature Truth Audit | 完成但需持续维护 | 本文件与 `feature_truth_audit.md` 作为事实口径 |
| Skill/Prompt/Runtime | 试用级完成 | mock provider 与包审批可用，真实 provider 待验证 |
| Quality/Gate | 试用级完成 | 可阻断，缺失指标返回 skipped；仍缺更多生产指标样例 |
| Replay/Debug/Repro | 前后端试用级完成 | Step 级 Replay、Prompt Debug、Repro Bundle 已有 API、权限态、schema invalid、ArtifactStore 落盘和前端错误详情覆盖 |
| Worker/Artifact/Sandbox | 部分完成 | 本地 pause/cancel 行为、ArtifactStore 最小接口和 Repro Bundle 首个产物接入已覆盖，Celery/MySQL/Redis 需环境验证 |
| Release Candidate | 已形成 | 本地验证栈已通过，分支仍需按需推送 |

## 下一轮完成标准

1. 生产类 smoke 在 MySQL + Redis + Celery 下通过，并记录 Task/Run/Report 证据。
2. 真实 provider smoke 能证明 secret_ref、token usage、cost source、错误码和错误详情脱敏。
3. Trace Flow Step 调试抽屉继续补真实 Prompt output schema debug、更多异常态、离线下载和跨进程 Repro Bundle 读取。
4. `scripts/verify_release_candidate.ps1 -Scope release` 一条命令可复现本地发布候选验证。
5. `docs/PROJECT_STATUS.md` 每次改动后更新，且不再引用不存在的审计文件。
6. 高级模块继续保持 feature flag/disabled 口径，未验证能力不进入主流程。
