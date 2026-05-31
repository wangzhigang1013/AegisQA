# Repair Task Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把报告诊断生成的 Repair Task 从“接口返回结果”升级为可筛选、可领取、可完成、可重开的修复工作台。

**Architecture:** 后端在 Task 路由中补 Repair Task 状态流转 API，继续使用现有 JSON/SQLite 文档仓储。前端新增 `RepairTasksPage`，在主导航提供“修复任务”入口，表格展示根因、影响样本、来源任务和证据，并提供领取、完成、重开、回到报告/Trace 的动作。

**Tech Stack:** FastAPI、Pydantic、pytest、React、TypeScript、Ant Design、TanStack Query、Vitest。

---

### Task 1: 后端 Repair Task 状态流转

**Files:**
- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/api/routes/tasks.py`
- Modify: `tests/test_task_flow_optimization.py`

- [x] **Step 1: 写失败测试**

新增测试 `test_repair_task_status_flow_is_traceable`：

```python
def test_repair_task_status_flow_is_traceable(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post("/tasks", json={
        "name": "修复闭环任务",
        "dataset_id": dataset["dataset_id"],
        "dataset_version": dataset["version"],
        "workflow_version_id": workflow["version_id"],
        "evaluation_goal": "release_gate",
        "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
    }).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]

    started = client.post(f"/repair-tasks/{repair['repair_task_id']}/start", json={"owner": "qa_owner"}).json()
    assert started["status"] == "in_progress"
    assert started["owner"] == "qa_owner"
    assert started["started_at"]

    resolved = client.post(f"/repair-tasks/{repair['repair_task_id']}/resolve", json={"resolution_note": "已修复 prompt 并补充 Golden。"}).json()
    assert resolved["status"] == "resolved"
    assert resolved["resolution_note"] == "已修复 prompt 并补充 Golden。"
    assert resolved["resolved_at"]

    reopened = client.post(f"/repair-tasks/{repair['repair_task_id']}/reopen", json={"reason": "复测仍未通过。"}).json()
    assert reopened["status"] == "open"
    assert reopened["reopen_reason"] == "复测仍未通过。"
```

- [x] **Step 2: Run RED**

Run: `python -m pytest tests\test_task_flow_optimization.py -q`

Expected: fails because `/repair-tasks/{repair_task_id}/start|resolve|reopen` do not exist.

- [x] **Step 3: 实现最小后端能力**

实现：
- `RepairTaskStartRequest(owner: str)`
- `RepairTaskResolveRequest(resolution_note: str)`
- `RepairTaskReopenRequest(reason: str)`
- `POST /repair-tasks/{repair_task_id}/start`
- `POST /repair-tasks/{repair_task_id}/resolve`
- `POST /repair-tasks/{repair_task_id}/reopen`

状态规则：
- `open` 或 `reopened` 可以 `start`。
- `open`、`reopened`、`in_progress` 可以 `resolve`。
- `resolved` 可以 `reopen`。
- 非法状态返回 `REPAIR_TASK_INVALID_TRANSITION`。

- [x] **Step 4: Run GREEN**

Run: `python -m pytest tests\test_task_flow_optimization.py -q`

Expected: 3 passed。

### Task 2: 前端修复任务工作台

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/pages/RepairTasksPage.tsx`
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: 写失败测试**

新增前端测试：
- 主导航显示“修复任务”。
- `/repair-tasks` 展示修复任务表格、证据、来源任务、领取/完成按钮。
- 点击“领取”调用 `POST /repair-tasks/{id}/start` 并显示负责人。
- 点击“完成”打开弹窗，填写修复说明后调用 `POST /repair-tasks/{id}/resolve` 并显示 resolved。

- [x] **Step 2: Run RED**

Run: `cd frontend && npm test -- src/test/App.test.tsx -t "修复任务工作台"`

Expected: fails because page and API client do not exist.

- [x] **Step 3: 实现 UI 和 API client**

实现：
- `api.startRepairTask`
- `api.resolveRepairTask`
- `api.reopenRepairTask`
- `RepairTasksPage` 列表、状态筛选、详情抽屉、领取、完成、重开、跳转报告/Trace。
- `App.tsx` 增加导航和路由。

- [x] **Step 4: Run GREEN**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "修复任务工作台"
npm run typecheck
```

Expected: targeted tests and typecheck pass。

### Task 3: 文档、回归和提交

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- Modify: `docs/superpowers/plans/2026-05-31-repair-task-workbench.md`

- [x] **Step 1: 更新文档**

记录 Repair Task Workbench、状态流转、验证命令、结果和下一步。

- [x] **Step 2: 回归验证**

Run:

```powershell
python -m pytest tests\test_task_flow_optimization.py -q
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
```

- [x] **Step 3: 提交**

```powershell
git add .
git commit -m "feat: 增加修复任务工作台"
```
