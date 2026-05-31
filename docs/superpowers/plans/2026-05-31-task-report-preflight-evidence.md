# Task Report Preflight Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** 让任务报告中心也能展示创建任务前的 Preflight 证据，避免用户从报告复盘或导出上下文时丢失“任务创建前检查过什么”的关键信息。

**Architecture:** 后端 `GET /tasks/{task_id}/report` 直接从 Task 快照读取 `preflight_result`，以 `preflight_evidence` 字段返回。前端 `ReportSummary` 接收该字段，在任务摘要与版本快照中展示 Preflight 状态、ID 和摘要；如果旧任务没有证据，则显示未记录。

**Tech Stack:** FastAPI、pytest、React、TypeScript、Ant Design、Vitest。

---

### Task 1: 后端报告返回 Preflight 证据

**Files:**
- Modify: `aegisqa/api/routes/tasks.py`
- Modify: `tests/test_task_center_api.py`

- [x] **Step 1: 写失败测试**

扩展 Preflight 持久化测试：
- 创建任务时引用 `preflight_id`。
- 获取 `/tasks/{task_id}/report`。
- 断言报告返回 `preflight_evidence.preflight_id`、状态和检查项。

- [x] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests\test_task_center_api.py -q -k preflight_is_persisted
```

Result: 失败，原因是报告缺少 `preflight_evidence`。

- [x] **Step 3: Run GREEN**

实现 `GET /tasks/{task_id}/report` 返回 `preflight_evidence`，复跑目标测试通过。

### Task 2: 报告摘要展示 Preflight 证据

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/ReportsPage.tsx`
- Modify: `frontend/src/pages/report/ReportSummary.tsx`
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: 写失败测试**

扩展报告中心测试：
- mock Task Report 返回 `preflight_evidence`。
- 断言页面展示“创建前 Preflight 证据”和 `preflight_id`。

- [x] **Step 2: Run RED**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "报告中心围绕任务展示报告"
```

Result: 失败，原因是报告摘要没有展示 Preflight 证据。

- [x] **Step 3: Run GREEN**

实现：
- `TaskReport.preflight_evidence` 类型。
- `ReportsPage` 把证据传给 `ReportSummary`。
- `ReportSummary` 展示状态、ID 和摘要。

### Task 3: 文档、回归和提交

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- Create: `docs/superpowers/plans/2026-05-31-task-report-preflight-evidence.md`

- [x] **Step 1: 更新文档**

同步记录：
- Task Report API 返回 `preflight_evidence`。
- 报告中心摘要展示 Preflight 证据。
- 变更文件、验证命令、测试结果和下一步。

- [x] **Step 2: 回归验证**

Run:

```powershell
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
git diff --check
```

Result:
- 后端：92 passed；仍有 Windows `.pytest_cache` 创建警告，不影响结果。
- 前端：4 个测试文件、62 passed。
- TypeScript 与构建：通过。
- Playwright E2E：8 passed。
- 差异检查：通过，仅有 Windows LF/CRLF 换行提示。

- [x] **Step 3: 提交**

```powershell
git add .
git commit -m "feat: 报告展示任务预检证据"
```
