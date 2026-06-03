# AegisQA Reality-First Rebuild Completion Audit

审计日期：2026-06-03

本文件用于逐项核对 `AEGISQA_REALITY_FIRST_REBUILD_PLAN_FOR_AI.md` 的 Phase 0-6 显式要求。状态含义：

- `done`：已有代码、接口或 UI，并有自动化测试或文档证据。
- `partial`：主能力已实现，但仍有边界或验证缺口。
- `pending`：尚未实现或未找到证据。

| Phase | Status | Current Coverage | Evidence | Remaining Risk / Next Fix |
| --- | --- | --- | --- | --- |
| Phase 0 Feature Truth Audit 与主线降噪 | done | 已新增 feature truth audit；后端和前端 feature flag 默认关闭 CI Gate、Candidate Assets、Repair Tasks、Experiments、Annotation Queue、Judge Audit；主导航只保留核心入口；Report 缺真实质量、成本、evidence 时显示 unavailable/skipped。 | `docs/audit/feature_truth_audit.md`；`aegisqa/core/features.py`；`frontend/src/features.ts`；`tests/test_reality_first_phase0.py`；`frontend/src/features.test.ts`。 | 后续新增高级入口时必须继续默认隐藏，并更新审计表。 |
| Phase 1 Skill Package Spec v1 | done | v1 skill/prompt schema、legacy manifest 兼容、包安全校验、旧/新 handler 入口兼容、Prompt/Code/Hybrid 示例包可上传、合约测试、审批、运行。 | `docs/specs/skill-package-v1.md`；`aegisqa/skills/specs/*.schema.json`；`examples/skill_packages/`；`tests/test_skill_package_v1.py`；`tests/test_skill_package_security.py`。 | 真实 provider SDK 静态检测目前以 warning 为主，不阻断。 |
| Phase 2 Prompt Registry / RuntimeContext / LLM Gateway | done | Skill 包 prompt assets 进入 registry 并保存 hash；LLM Gateway 校验 prompt、变量、alias、权限、schema、token；Model Alias 后端和 Governance UI 均可管理并写审计；Skill runtime 只能通过 `context.llm.call` 使用 alias；本批补齐 `max_calls_per_run` 与 `max_tokens_per_run`。 | `aegisqa/llm/`；`aegisqa/api/routes/governance.py`；`frontend/src/pages/GovernancePage.tsx`；`tests/test_llm_gateway_phase2.py`；`frontend/src/test/App.test.tsx`。 | 真实 provider secret 注入仍按计划不接入；当前 provider 为 test provider。 |
| Phase 3 Hybrid Skill A 与真实 Step Trace | done | Hybrid 示例包执行代码检索、judge prompt、review prompt 条件判断和 aggregate；Step 持久化 resolved/raw/validated/schema_errors/prompt_calls/skill_version，并兼容旧 snapshot；Trace Tree/Flow 展示新字段。 | `examples/skill_packages/hybrid_judge_reviewer/`；`aegisqa/engine/runner.py`；`frontend/src/pages/TraceTreePage.tsx`；`frontend/src/pages/TraceFlowPage.tsx`；`tests/test_step_trace_phase3.py`。 | 更复杂的多 prompt debug UI 可继续增强，但主链路 trace 已具备回放证据。 |
| Phase 4 QualityCheckResult 与 GateEvaluator | done | 新增质量模型、规则目录和 GateEvaluator；Preflight、Report Quality Gate、CI Gate 都走 GateEvaluator；缺真实指标时返回 skipped；阻断规则失败时 CI Gate 返回 failed/blocked 决策；Report 展示 rule evidence。 | `aegisqa/quality/`；`aegisqa/api/routes/tasks.py`；`aegisqa/api/routes/productization.py`；`tests/test_quality_gate_phase4.py`；`frontend/src/test/ReportsPage.test.tsx`。 | Run 完成后 GateEvaluationResult 目前主要由 Report/CI Gate API 计算或持久化，后续可增加 run-complete 自动持久化索引。 |
| Phase 5 Node Replay / Prompt Debug / Repro Bundle | done | Step Replay 支持 original/override input、disable_cache、mock_llm_calls；本批补齐 mock LLM replay 复用历史 prompt call trace 并标记 mocked；Prompt Debug 返回 rendered/raw/parsed/schema/token/artifact URI；Repro Bundle 导出 workflow、manifest、prompt assets、step fields、llm calls 并写 ArtifactStore。 | `aegisqa/api/routes/tasks.py`；`aegisqa/api/routes/skills.py`；`tests/test_replay_debug_phase5.py`；`frontend/src/pages/TraceFlowPage.tsx`；`frontend/src/pages/SkillsPage.tsx`。 | Replay 当前为单 Step 诊断 replay，不写回原 Run；这是计划内的非持久化行为。 |
| Phase 6 Worker / ArtifactStore / Sandbox Lite | done | JsonStore 标记 dev-only；SQLite 作为 local persistent trial；LocalArtifactStore 承载 datasets、skill packages、rendered prompts、raw LLM responses、reports、prompt debug、repro bundles；API 创建 Run/Task 后入队；Local Worker 每次执行一个 pending item；pause/cancel 不启动新 item；状态机提供大写 state；Sandbox Lite 有 timeout、stdout/stderr 限制、cwd 隔离、provider secret 隔离和 SDK/API key warning。 | `docs/specs/runtime-infrastructure-v1.md`；`aegisqa/storage/artifacts.py`；`aegisqa/workers/local.py`；`aegisqa/skills/packages.py`；`tests/test_runtime_infra_phase6.py`；`tests/test_skill_package_security.py`。 | Sandbox Lite 不是容器级隔离；生产仍需 PostgreSQL/MySQL + Object Storage + 独立 worker/sandbox。 |

## Latest Gap Closures

- Governance 已新增 Model Alias 管理 UI，覆盖 `GET /model-aliases` 和 `POST /model-aliases`。
- `context.llm.call` 子进程 runtime 已强制 `max_calls_per_run` 与 `max_tokens_per_run`。
- Badcase 创建已强制 `source in step|quality_check|gate_rule|annotation`，并要求 `source_id` 与 `evidence`。
- Step Replay 在 `mock_llm_calls=true` 且存在历史 prompt calls 时，不再重新触发 LLM runtime，而是复用历史 prompt trace 并标记 `mocked=true`。

## Final Verification

- `python -m pytest -q`: 159 passed, with only the existing Starlette/httpx deprecation warning.
- `cd frontend && npm run typecheck`: passed.
- `cd frontend && npm test`: 10 test files passed, 118 tests passed.
- `cd frontend && npm run e2e`: 9 passed.
- `git diff --check`: passed, with only Windows LF/CRLF conversion warnings.

## Completion Decision

Phase 0-6 explicit rebuild requirements are complete for the local reality-first runtime scope. Remaining notes in the table are production hardening boundaries or follow-up enhancements, not blockers for the requested rebuild plan:

- real provider secrets are intentionally not injected;
- Sandbox Lite is not container-level isolation;
- production database/object storage/worker replacement remains documented as the production direction;
- run-complete GateEvaluation indexing can be added later as an optimization because Preflight, Report Quality Gate and CI Gate already share `GateEvaluator` and return real skipped/failed evidence.
