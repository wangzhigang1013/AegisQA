# Task Diagnostics 深度优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增任务根因诊断层，让报告能解释“为什么失败、影响多少样本、下一步查哪里”，而不是只展示通过率和 Badcase。

**Architecture:** 新增 `aegisqa/reports/diagnostics.py`，把 `RunRecord`、`RunReport`、分层指标和参数治理聚合为稳定的 `TaskDiagnostics` 字典；`/tasks/{task_id}/report` 和新增 `/tasks/{task_id}/diagnostics` 复用同一诊断函数。前端报告中心增加“根因诊断”区域，展示主要根因、证据、Step 健康度、数据质量和建议动作。

**Tech Stack:** FastAPI、Pydantic、pytest、React、Ant Design、TanStack Query、Vitest。

---

### Task 1: 后端诊断红灯测试

**Files:**
- Create: `tests/test_task_diagnostics.py`

- [x] **Step 1: Write failing API tests**

新增测试覆盖：

```python
def test_task_report_returns_root_cause_diagnostics(tmp_path: Path) -> None:
    client, task = _seed_task_with_badcases(tmp_path)
    report = client.get(f"/tasks/{task['task_id']}/report").json()
    diagnostics = report["diagnostics"]
    assert diagnostics["summary"]["status"] in {"needs_attention", "healthy"}
    assert diagnostics["summary"]["primary_cause"] in {"judge_or_answer_quality", "runtime_error", "weak_segment", "data_quality", "healthy"}
    assert diagnostics["root_causes"]
    assert any(item["cause_type"] == "weak_segment" for item in diagnostics["root_causes"])
    assert diagnostics["step_health"][0]["step_id"]
```

```python
def test_task_diagnostics_endpoint_explains_data_quality_and_parameters(tmp_path: Path) -> None:
    client, task = _seed_task_with_missing_reference_and_override(tmp_path)
    diagnostics = client.get(f"/tasks/{task['task_id']}/diagnostics").json()
    assert any(item["cause_type"] == "data_quality" for item in diagnostics["root_causes"])
    assert diagnostics["data_quality"]["field_coverage"]
    assert diagnostics["parameter_risks"]["override_count"] >= 1
```

- [x] **Step 2: Run RED**

Run: `python -m pytest tests\test_task_diagnostics.py -q`

Expected: fails because `diagnostics` and `/tasks/{task_id}/diagnostics` do not exist.

### Task 2: 后端诊断模型与 API

**Files:**
- Create: `aegisqa/reports/diagnostics.py`
- Modify: `aegisqa/api/routes/tasks.py`

- [x] **Step 1: Implement diagnostics builder**

`build_task_diagnostics(task, run, report, segments, parameter_governance)` 输出：

- `summary`：状态、主要根因、置信度、证据数量。
- `root_causes`：根因类型、严重级别、置信度、影响样本数、证据和建议动作。
- `weak_segments`：低通过率分层。
- `step_health`：每个 Step 的调用、失败、缓存、耗时和健康状态。
- `data_quality`：字段覆盖率、缺失字段、重复 row hash。
- `parameter_risks`：任务覆盖参数数、Secret 引用数、表达式参数数。

- [x] **Step 2: Wire API**

`GET /tasks/{task_id}/report` 增加 `diagnostics` 字段。

新增 `GET /tasks/{task_id}/diagnostics`，便于后续独立页面、CI 或导出复用。

- [x] **Step 3: Run GREEN**

Run: `python -m pytest tests\test_task_diagnostics.py -q`

Expected: 2 passed。

### Task 3: 前端类型、API 与报告 UI

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/ReportsPage.tsx`
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: Add frontend failing test**

在 `App.test.tsx` 增加报告中心断言：

```tsx
expect(screen.getByText('根因诊断')).toBeInTheDocument();
expect(screen.getByText('主要根因')).toBeInTheDocument();
expect(screen.getByText('弱分层风险')).toBeInTheDocument();
expect(screen.getByText('数据质量')).toBeInTheDocument();
```

- [x] **Step 2: Implement UI**

报告中心新增“根因诊断”卡片：

- 顶部展示诊断状态、主要根因、置信度、证据数。
- 表格展示 root causes。
- 小表展示 Step 健康度。
- 数据质量区展示字段覆盖和缺失字段。
- 参数风险区展示 override、expression、secret_ref 数量。

- [x] **Step 3: Run frontend GREEN**

Run:

```powershell
cd frontend
npm test -- src/test/App.test.tsx -t "根因诊断"
npm run typecheck
```

Expected: targeted test and typecheck pass。

### Task 4: 文档、全量验证和提交

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`

- [x] **Step 1: Update docs**

记录 Task Diagnostics 的后端 API、报告 UI、验证命令和下一步。

- [x] **Step 2: Full verification**

Run:

```powershell
python -m pytest -q
python -m aegisqa.examples.run_mvp_demo
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
```

- [x] **Step 3: Commit**

```powershell
git add .
git commit -m "feat: 增加任务根因诊断"
```
