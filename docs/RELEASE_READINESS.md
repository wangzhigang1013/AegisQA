# AegisQA Release Readiness

## 目标

本文件用于判断当前分支能否作为小团队试用版或演示版发布候选。它不是生产完成声明；AegisQA 当前仍应按“工程化 MVP 已成型，生产化边界仍需真实环境验证”来描述。

## 发布候选必须通过

在提交 release candidate 前，必须从仓库根目录完成：

```powershell
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
cd ..
.\scripts\smoke_runtime.ps1
git diff --check
```

通过标准：

- 后端全量 pytest 退出码为 0。
- 前端 TypeScript、Vitest、生产构建和 Playwright E2E 退出码为 0。
- Runtime smoke 输出 `Runtime smoke passed`。
- `git diff --check` 无空白错误；Windows LF/CRLF 提示可记录为非阻断。
- `git status --short --untracked-files=all` 中不包含 `.runtime-smoke/` 产物。

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
