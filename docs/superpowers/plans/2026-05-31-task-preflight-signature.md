# Task Preflight Signature Freshness 计划

## 背景

任务创建已经要求先运行 Preflight，但旧判断只关注 Dataset 和 Workflow。用户在 Preflight 后如果切换执行参数模板、修改评测目的、质量门槛、repeat 或成本预算，前端仍可能沿用旧预检结果创建任务，导致“看起来预检通过，实际执行配置已变”的隐性风险。

同时，Playwright E2E 曾复用本地 8000 旧后端服务，导致测试结果被旧进程污染；治理页请求审计日志时，`/audit-events?actor=&action=` 会把过滤参数传给不支持参数的 `AuditService.list_events()`，触发 500。

## 实施范围

1. 后端 Preflight 签名补齐
   - `POST /tasks/preflight` 返回 `execution_template_id`、`evaluation_goal`、`quality_gate`、`sample_repeat_times`、`cost_budget`。
   - 后端测试覆盖执行模板和关键执行参数进入 Preflight 响应。

2. 前端创建任务门禁
   - Task 创建向导保存最近一次 Preflight 的完整签名。
   - Dataset、Workflow、执行模板、评测目的、质量门槛、repeat、成本预算任一变化后，创建按钮进入禁用状态并提示重新运行 Preflight。
   - Preflight 请求使用完整表单值，避免 Ant Design `initialValues` 没被带入请求体。

3. E2E 环境隔离
   - Playwright 默认启动独立 FastAPI 端口 `8010`。
   - 前端 dev server 通过 `VITE_API_TARGET` 把 `/api` 代理到本次 E2E 后端。
   - E2E 测试中的后端请求统一走 `/api/...`，不再硬编码 `127.0.0.1:8000`。

4. 审计日志过滤修复
   - `AuditService.list_events()` 增加 actor/action 过滤参数。
   - `GET /audit-events` 按 actor/action 过滤时不再 500。

## 验证

- `python -m pytest tests\test_api.py -q -k audit_events`
- `python -m pytest tests\test_task_center_api.py -q -k "execution_templates"`
- `cd frontend && npm test -- src/pages/task/TaskCreateWizard.test.tsx`
- `python -m pytest -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`

## 结果

- 后端全量：88 passed，Windows `.pytest_cache` 仍有创建警告，不影响结果。
- 前端全量：4 个测试文件，60 passed。
- TypeScript 与生产构建：通过。
- Playwright E2E：8 passed。
