# Runtime Smoke 验证

本地 runtime smoke 用来验证 AegisQA 的最小真实主链路是否可用：

```text
FastAPI health
  -> 物化 Dataset
  -> 发布 Workflow
  -> 运行 Preflight
  -> 创建 Task
  -> 执行 Task
  -> 读取 Trace Flow
  -> 读取 Task Report
  -> 读取 Overview Workbench
```

这个 smoke 不接真实模型 API Key，默认使用 mock 模型能力；它验证的是平台运行时、存储、Workflow、Task、Trace、Report 和工作台契约，不等价于 MySQL/Redis/Celery 的生产部署验收。

## 运行方式

在仓库根目录执行：

```powershell
.\scripts\smoke_runtime.ps1
```

脚本会先请求 `http://127.0.0.1:8000/health`：

- 如果已有 FastAPI 服务可用，会复用当前服务。
- 如果不可用，会在隐藏 PowerShell 进程中启动 `python -m uvicorn aegisqa.api.app:app --host 127.0.0.1 --port 8000`。
- 如果 `8000` 被非 AegisQA 服务占用，会自动选择 `8020-8035` 中的可用端口，并在输出中打印实际端口。
- 脚本自己启动的后端会在结束时停止；传入 `-KeepApi` 可保留服务。

## 常用参数

```powershell
.\scripts\smoke_runtime.ps1 -ApiUrl "http://127.0.0.1:8000"
.\scripts\smoke_runtime.ps1 -StorageBackend sqlite
.\scripts\smoke_runtime.ps1 -StoreRoot ".runtime-smoke/sqlite-store" -StorageBackend sqlite
.\scripts\smoke_runtime.ps1 -KeepApi
```

## 通过标准

脚本输出 `Runtime smoke passed`，并打印 Task、Run 和 Report 入口。

失败时优先看：

- `/health` 是否可访问。
- 当前 8000 端口是否运行旧代码。
- `AEGISQA_STORAGE_BACKEND` 和 `AEGISQA_STORE_ROOT` 是否指向预期环境。
- 是否有旧数据或旧进程污染当前 smoke。

## 生产部署前仍需补充

发布前还需要单独验证：

- MySQL Store 真实容器写入和并发审计追加。
- Redis rate limiter 和 Celery worker 的真实队列执行。
- 前端生产构建和 Playwright E2E。
- 外部模型 provider 的 secret 引用、连接测试、token usage 和成本来源。
