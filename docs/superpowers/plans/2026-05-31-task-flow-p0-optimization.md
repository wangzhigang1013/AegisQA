# Task Flow P0 Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AegisQA 的核心使用链路从“功能可点”升级为“目标明确、运行前可预检、报告先给结论、诊断可沉淀修复任务”的任务闭环。

**Architecture:** 后端在 Task 路由中新增 Preflight Check 与 Repair Task API，并把评测目标、质量门槛、预检结果写入 Task 快照。前端扩展创建任务向导、执行中心和报告中心，让用户按“评测目的 -> 数据/Workflow -> 门槛 -> 预检 -> 创建 -> 报告 -> 修复任务”完成一次评测。

**Tech Stack:** FastAPI、Pydantic、pytest、React、TypeScript、Ant Design、TanStack Query、Vitest。

---

### Task 1: 后端任务预检与修复任务 API

**Files:**
- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/api/routes/tasks.py`
- Create: `tests/test_task_flow_optimization.py`

- [x] **Step 1: 写失败测试**

新增测试覆盖：

```python
def test_task_preflight_blocks_missing_workflow_fields(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=False)
    response = client.post("/tasks/preflight", json={
        "dataset_id": dataset["dataset_id"],
        "dataset_version": dataset["version"],
        "workflow_version_id": workflow["version_id"],
        "evaluation_goal": "release_gate",
        "quality_gate": {"pass_rate": 0.8, "max_badcase_count": 0},
    })
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "blocked"
    assert any(check["check_id"] == "field_mapping" and check["status"] == "blocked" for check in result["checks"])
```

```python
def test_task_stores_goal_gate_preflight_and_creates_repair_tasks(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post("/tasks", json={
        "name": "上线门禁任务",
        "dataset_id": dataset["dataset_id"],
        "dataset_version": dataset["version"],
        "workflow_version_id": workflow["version_id"],
        "evaluation_goal": "release_gate",
        "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
    }).json()
    assert task["evaluation_goal"] == "release_gate"
    assert task["quality_gate"]["pass_rate"] == 0.9
    assert task["preflight_result"]["status"] in {"passed", "warning"}
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()
    assert repair["created_count"] >= 1
    assert client.get(f"/repair-tasks?source_task_id={executed['task_id']}").json()[0]["source_task_id"] == executed["task_id"]
```

- [x] **Step 2: Run RED**

Run: `python -m pytest tests\test_task_flow_optimization.py -q`

Expected: fails because `/tasks/preflight` and Repair Task API do not exist.

- [x] **Step 3: 实现最小后端能力**

实现：
- `TaskCreateRequest.evaluation_goal`
- `TaskCreateRequest.quality_gate`
- `TaskPreflightRequest`
- `POST /tasks/preflight`
- `GET /repair-tasks`
- `POST /tasks/{task_id}/repair-tasks/from-diagnostics`

- [x] **Step 4: Run GREEN**

Run: `python -m pytest tests\test_task_flow_optimization.py -q`

Expected: 2 passed。

### Task 2: 前端创建任务向导与报告第一屏

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/task/TaskCreateWizard.tsx`
- Modify: `frontend/src/pages/RunsPage.tsx`
- Modify: `frontend/src/pages/ReportsPage.tsx`
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: 写失败测试**

扩展现有前端测试：
- 创建任务向导必须展示评测目的、质量门槛和 Preflight Check。
- 报告中心必须展示“评测结论”第一屏。
- 点击“生成修复任务”必须调用后端并显示创建数量。

- [x] **Step 2: Run RED**

Run: `cd frontend && npm test -- src/test/App.test.tsx -t "执行中心默认展示任务列表并可以创建任务|报告中心围绕任务展示报告"`

Expected: fails because UI 不存在。

- [x] **Step 3: 实现 UI 和 API client**

实现：
- `api.taskPreflight`
- `api.createRepairTasksFromDiagnostics`
- `api.repairTasks`
- `TaskCreateWizard` 增加目标、门槛、预检按钮和检查表。
- `RunsPage` 创建任务前可运行预检，创建时提交目标、门槛、预检结果。
- `ReportsPage` 第一屏显示“能不能过 / 为什么 / 影响多大 / 下一步”，并增加生成 Repair Task 按钮。

- [x] **Step 4: Run GREEN**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "执行中心默认展示任务列表并可以创建任务|报告中心围绕任务展示报告"
npm run typecheck
```

Expected: targeted tests and typecheck pass。

### Task 3: 文档、回归和提交

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`
- Modify: `docs/superpowers/plans/2026-05-31-task-flow-p0-optimization.md`

- [x] **Step 1: 更新文档**

记录 Preflight、Repair Task、评测结论第一屏、验证命令和下一步。

- [x] **Step 2: 回归验证**

Run:

```powershell
python -m pytest tests\test_task_flow_optimization.py -q
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
```

- [x] **Step 3: 提交**

```powershell
git add .
git commit -m "feat: 优化任务全流程闭环"
```
