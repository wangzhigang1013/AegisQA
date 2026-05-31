# Task Preflight Evidence Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** 把已经持久化的任务 Preflight 证据从后端审计数据变成用户可见信息，让任务详情能直接回答“创建这个任务前系统检查过什么、检查结果是什么、证据 ID 是多少”。

**Architecture:** 不新增后端模型。沿用 Task 记录里的 `preflight_result` 与 `execution_config.preflight_id`，在任务详情抽屉的“参数”页增加 Preflight 证据区；前端展示 ID、状态、生成时间、摘要和检查项表格。旧任务没有 Preflight 时显示明确提示。

**Tech Stack:** React、TypeScript、Ant Design、TanStack Query、Vitest。

---

### Task 1: 前端测试先行

**Files:**
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: 写失败测试**

新增测试覆盖：
- 打开执行中心任务详情。
- 切换到“参数”页。
- 看到“创建前 Preflight 证据”。
- 看到 `preflight_id`、摘要和检查项标题。

- [x] **Step 2: Run RED**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "任务详情参数页展示创建前 Preflight 证据"
```

Result: 失败，原因是页面找不到“创建前 Preflight 证据”。

### Task 2: 展示 Preflight 证据

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/task/TaskOperationsDrawer.tsx`

- [x] **Step 1: 实现最小 UI**

实现：
- `TaskRecord.execution_config.preflight_id` 类型。
- 参数页新增 Preflight 证据卡片。
- 展示 Preflight ID、状态、生成时间、摘要。
- 展示检查项表格：检查项、状态、结果、修复建议。
- 旧任务没有 Preflight 时展示信息提示。

- [x] **Step 2: Run GREEN**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "任务详情参数页展示创建前 Preflight 证据"
```

Result: 1 passed。

### Task 3: 文档、回归和提交

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- Create: `docs/superpowers/plans/2026-05-31-task-preflight-evidence-visibility.md`

- [x] **Step 1: 更新文档**

同步记录：
- 任务详情参数页展示创建前 Preflight 证据。
- 前端测试数更新。
- 变更文件、验证命令、测试结果和下一步。

- [x] **Step 2: 回归验证**

Run:

```powershell
cd frontend
npm run typecheck
npm test
npm run build
python -m pytest -q
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
git commit -m "feat: 展示任务预检证据"
```
