# Task Preflight Persistent Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task.

**Goal:** 把任务创建前的 Preflight 从一次性临时响应升级为可追溯、可查询、可被 Task 引用的证据记录，保证用户创建任务前实际看过的检查结果能进入任务审计链路。

**Architecture:** 后端 `POST /tasks/preflight` 在生成检查结果后持久化 `task_preflights` 记录并返回 `preflight_id`；`POST /tasks` 在创建任务时仍重算服务端 Preflight 作为事实源，同时校验传入的 `preflight_id` 或 `preflight_result.preflight_id` 与当前请求签名一致，并把 ID 写入 Task `preflight_result` 与 `execution_config`。前端创建任务时随请求提交最新 Preflight 的 ID。

**Tech Stack:** FastAPI、Pydantic、pytest、React、TypeScript、TanStack Query、Vitest。

---

### Task 1: 后端持久化 Preflight 证据

**Files:**
- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/api/routes/tasks.py`
- Modify: `tests/test_task_center_api.py`

- [x] **Step 1: 写后端测试**

新增测试覆盖：
- `POST /tasks/preflight` 返回 `preflight_id`。
- `GET /task-preflights/{preflight_id}` 可读取同一份记录。
- `POST /tasks` 可通过 `preflight_id` 引用记录，并写入 `task.preflight_result.preflight_id` 与 `task.execution_config.preflight_id`。
- 显式 `preflight_id` 与 `preflight_result.preflight_id` 冲突时返回 `TASK_PREFLIGHT_STALE`。

- [x] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests\test_task_center_api.py -q -k preflight_is_persisted
python -m pytest tests\test_task_center_api.py -q -k conflicting_preflight_ids
```

Expected: fails，因为接口尚未持久化 Preflight，也没有冲突 ID 校验。

- [x] **Step 3: 实现后端能力**

实现：
- `TaskCreateRequest.preflight_id`。
- `GET /task-preflights/{preflight_id}`。
- `_save_task_preflight` 持久化 `task_preflights` 并写审计事件。
- `POST /tasks/preflight` 返回持久化记录。
- `POST /tasks` 读取并校验 `preflight_id`，写入 Task 快照。
- 冲突 ID 返回结构化 `TASK_PREFLIGHT_STALE`。

- [x] **Step 4: Run GREEN**

Run:

```powershell
python -m pytest tests\test_task_center_api.py -q -k "preflight_is_persisted or conflicting_preflight_ids"
python -m pytest tests\test_task_center_api.py -q -k "recomputes_preflight or stale_preflight or execution_templates"
```

Expected: targeted tests pass。

### Task 2: 前端创建任务提交 Preflight ID

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/RunsPage.tsx`
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: 写前端测试**

扩展“执行中心选择执行模板后创建任务会提交模板 ID”测试，断言创建任务请求同时携带 `preflight_id`。

- [x] **Step 2: Run RED**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "执行中心选择执行模板"
```

Expected: fails，因为请求体尚未提交 `preflight_id`。

- [x] **Step 3: 实现前端提交**

实现：
- `TaskPreflightResult.preflight_id` 类型字段。
- `api.createTask` 请求类型支持 `preflight_id`。
- `RunsPage` 在创建任务时提交 `preflightResult?.preflight_id`。

- [x] **Step 4: Run GREEN**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "执行中心选择执行模板"
npm run typecheck
```

Expected: targeted test and typecheck pass。

### Task 3: 文档、回归和提交

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- Create: `docs/superpowers/plans/2026-05-31-task-preflight-persistent-evidence.md`

- [x] **Step 1: 更新文档**

同步记录：
- 当前阶段为 Task Preflight Persistent Evidence。
- 变更文件、验证命令、测试结果和下一步。
- PRD 和交互矩阵补齐 `preflight_id` 持久化、查询、引用和冲突阻断。

- [x] **Step 2: 全量回归验证**

Run:

```powershell
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
```

Result:
- 后端：92 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
- 前端：4 个测试文件、61 passed。
- TypeScript 与构建：通过。
- Playwright E2E：8 passed。

- [x] **Step 3: 提交**

```powershell
git add .
git commit -m "feat: 持久化任务预检证据"
```
