# AegisQA Release Readiness

## 目标

本文件用于判断当前分支能否作为小团队试用版或演示版发布候选。它不是生产完成声明；AegisQA 当前仍应按“工程化 MVP 已成型，生产化边界仍需真实环境验证”来描述。

## 发布候选必须通过

在提交 release candidate 前，必须从仓库根目录完成：

```powershell
.\scripts\verify_release_candidate.ps1 -Scope release
```

通过标准：

- 后端全量 pytest 退出码为 0。
- 前端 TypeScript、Vitest、生产构建和 Playwright E2E 退出码为 0。
- Runtime smoke 输出 `Runtime smoke passed`。
- `git diff --check` 无空白错误；Windows LF/CRLF 提示可记录为非阻断。
- `git status --short --untracked-files=all` 中不包含 `.runtime-smoke/` 产物。

## 分层验证策略

不要在每个小改动后运行全量测试。按改动风险选择验证层级：

```powershell
# 文档、脚本和状态文件改动：只检查必需文件、忽略规则和空白问题。
.\scripts\verify_release_candidate.ps1 -Scope docs

# API 契约、工作台动作、前端类型改动：跑定向后端契约测试和 typecheck。
.\scripts\verify_release_candidate.ps1 -Scope targeted

# 发布候选提交前：集中跑后端全量、前端单测、构建、E2E、本地 runtime smoke。
.\scripts\verify_release_candidate.ps1 -Scope release
```

涉及本地运行时主链路但不需要全量 E2E 时，可以在 targeted 基础上增加 runtime smoke：

```powershell
.\scripts\verify_release_candidate.ps1 -Scope targeted -IncludeRuntimeSmoke
```

生产类环境验证单独执行，不纳入默认 release 脚本，避免 Docker/MySQL/Redis/Celery 成为每次本地回归的耗时项：

```powershell
.\scripts\smoke_production_like.ps1 -StartCompose
```

真实模型 Provider 也单独验证，默认只检查连接别名和密钥不回显；只有显式 `-LiveCall` 才消耗模型额度：

```powershell
.\scripts\smoke_model_provider.ps1 -BaseUrl "https://example.com/v1" -DefaultModel "model-name" -SecretRef "env:MODEL_API_KEY"
.\scripts\smoke_model_provider.ps1 -BaseUrl "https://example.com/v1" -DefaultModel "model-name" -SecretRef "env:MODEL_API_KEY" -ApiKeyEnv "MODEL_API_KEY" -LiveCall
```

## 当前已知边界

- `JsonStore` 和 `SQLiteStore` 可支撑本地试用；MySQL 仍需要真实容器 smoke 后才能宣称生产部署就绪。
- Redis rate limiter 和 Celery worker 已有适配资产，但发布前仍需要真实队列执行验证。
- 模型网关默认可用 mock provider；真实 provider 需要单独验证 secret 引用、连接测试、token usage 和成本来源。
- 高级治理模块继续通过 feature flag 和页面状态控制，不应在未验证时写成“生产完成”。
- 历史 `tmp-report-debug*` 目录不属于发布内容，不应提交。

## 回滚策略

- 如果 Overview 工作台或推荐动作异常，可回滚 `aegisqa/api/experience.py`、`aegisqa/api/actions.py`、`frontend/src/actions/actionRouter.ts` 相关提交，主 Task/Report API 仍保留。
- 如果 request id middleware 影响接口，可回滚 `aegisqa/api/app.py` 中 middleware 与 `_error_response` 改动；旧错误 payload 仍会生成独立 `trace_id`。
- 如果新增体验 E2E 不稳定，先保留产品修复，单独降级 E2E 定位器，不回滚已验证的 action contract。
- 如果 runtime smoke 与本机端口冲突，使用 `-ApiUrl "http://127.0.0.1:<free-port>"` 或关闭旧服务；不要让 smoke 复用非 AegisQA 的 8000 服务。

## 发布说明口径

建议对外描述：

> AegisQA 当前已具备真实评测任务主链路和小团队试用所需的基础治理能力，支持 Dataset、Skill、Workflow、Task、Trace、Report、Badcase、Gate 和审计闭环。当前版本仍是发布候选/试用版，生产部署前需要完成 MySQL/Redis/Celery 和真实模型 provider 的环境级 smoke。

不建议描述：

> 已完成生产化平台。

## 试用前人工检查

- 打开 Overview，确认不展示 demo 兜底，能看到真实工作台空态或真实任务。
- 创建并执行一个 Task，确认 Task 抽屉状态能从 queued 更新到 completed。
- 打开 Trace Flow，确认 Step 可见 resolved/raw/validated/schema/prompt/action 信息。
- 打开 Report，确认优先结论与推荐动作可用，Badcase 可进入 Golden/修复任务流程。
- 导出报告和任务结果，确认 CSV/HTML 不执行用户输入中的公式或脚本。
