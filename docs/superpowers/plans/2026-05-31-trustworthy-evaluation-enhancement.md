# AegisQA 可信评测增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AegisQA 从“任务能跑、报告能看”继续推进到“评测结论可追溯、可解释、可治理、可决策”。

**Architecture:** 本批次不重写主链路，沿用 FastAPI + JSON Store + React/Vite/TypeScript。后端新增围绕 Task/Dataset/Judge 的轻量 API，前端在现有任务中心化信息架构上补独立 Trace Tree、Dataset Lineage、报告质量决策和多 Judge 一致性入口。

**Tech Stack:** FastAPI、Pydantic、Pytest、React、TypeScript、Ant Design、TanStack Query、Vitest。

---

## File Structure

- `tests/test_trustworthy_evaluation_enhancements.py`：新增后端红绿测试，覆盖 Dataset Lineage、Task 参数治理、Task Report 质量决策和多 Judge 一致性。
- `aegisqa/datasets/service.py`：为 Dataset Version 增加来源元数据和 Lineage 构建逻辑。
- `aegisqa/api/app.py`：新增请求模型和共享构建函数，包括质量决策与参数治理。
- `aegisqa/api/routes/datasets.py`：新增 Dataset Lineage API。
- `aegisqa/api/routes/tasks.py`：Task Report 返回质量决策和参数治理，并新增参数治理 API。
- `aegisqa/api/routes/judge.py`：新增多 Judge 交叉验证 API。
- `frontend/src/types.ts`：补齐 Dataset Lineage、Trace Tree、参数治理、质量决策、多 Judge 一致性类型。
- `frontend/src/api/client.ts`：补齐新增 API client。
- `frontend/src/pages/DatasetsPage.tsx`：数据集页增加 Lineage 抽屉，解释数据来源、版本、字段和下游任务。
- `frontend/src/pages/TraceTreePage.tsx`：新增独立 Trace Tree 页面。
- `frontend/src/App.tsx`：新增 `/tasks/:taskId/trace-tree` 路由。
- `frontend/src/pages/ReportsPage.tsx`：增加“质量决策中心”卡片。
- `frontend/src/pages/JudgeAuditPage.tsx`：增加多 Judge 一致性弹窗与结果展示。
- `frontend/src/test/App.test.tsx`：新增前端交互测试。
- `docs/PROJECT_STATUS.md`、`docs/PRD_ACCEPTANCE_MATRIX.md`、`docs/INTERACTION_ACCEPTANCE_MATRIX.md`：同步本批次状态和验收说明。

---

### Task 1: 状态同步与计划落地

**Files:**
- Create: `docs/superpowers/plans/2026-05-31-trustworthy-evaluation-enhancement.md`
- Modify: `docs/PROJECT_STATUS.md`

- [x] **Step 1: 写入本轮实施计划**

本文件记录本轮批次目标、文件边界、测试策略和执行顺序。

- [x] **Step 2: 更新项目状态为执行中**

把 `docs/PROJECT_STATUS.md` 的当前阶段更新为“可信评测增强执行中”，并在最近改动中写明本批次范围。

---

### Task 2: 后端可信评测增强 API

**Files:**
- Create: `tests/test_trustworthy_evaluation_enhancements.py`
- Modify: `aegisqa/datasets/service.py`
- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/api/routes/datasets.py`
- Modify: `aegisqa/api/routes/tasks.py`
- Modify: `aegisqa/api/routes/judge.py`

- [x] **Step 1: 写失败测试**

测试必须覆盖：

```python
def test_dataset_lineage_tracks_source_fields_and_downstream_tasks(tmp_path: Path) -> None:
    ...
    lineage = client.get(f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/lineage").json()
    assert lineage["source"]["type"] == "file_upload"
    assert lineage["field_count"] == 4
    assert lineage["downstream_tasks"][0]["task_id"] == task["task_id"]


def test_task_report_returns_quality_decision_and_parameter_governance(tmp_path: Path) -> None:
    ...
    report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert report["quality_decision"]["status"] in {"passed", "warning", "blocked"}
    assert report["parameter_governance"]["prompt_skill_versions"][0]["skill_ref"] == "llm.call@0.1.0"
    assert report["parameter_governance"]["parameter_sources"]


def test_task_parameter_governance_endpoint_explains_runtime_sources(tmp_path: Path) -> None:
    ...
    governance = client.get(f"/tasks/{task['task_id']}/parameter-governance").json()
    assert governance["task_id"] == task["task_id"]
    assert governance["parameter_sources"][0]["parameters"]


def test_judge_cross_validation_returns_pairwise_agreement(tmp_path: Path) -> None:
    ...
    result = client.post("/judge-cross-validation", json={...}).json()
    assert result["profile_count"] == 2
    assert result["pairwise_agreement"]["judge-a|judge-b"] == 0.5
```

- [x] **Step 2: 运行测试确认红灯**

Run: `python -m pytest tests\test_trustworthy_evaluation_enhancements.py -q`

Expected: 失败原因是新 API 或字段不存在。

- [x] **Step 3: 实现最小后端能力**

实现内容：
- Dataset Version 写入 `created_at`、`source_type`、`source_ref`。
- `DatasetService.build_lineage()` 返回数据来源、字段、预览、下游 Task。
- Task Report 增加 `quality_decision` 和 `parameter_governance`。
- `GET /tasks/{task_id}/parameter-governance` 返回 Skill/Prompt 版本和参数来源。
- `POST /judge-cross-validation` 调用现有 `JudgeProfileService.cross_validate()`。

- [x] **Step 4: 运行后端定向测试确认绿灯**

Run: `python -m pytest tests\test_trustworthy_evaluation_enhancements.py -q`

Expected: 4 passed。

---

### Task 3: 前端可信评测体验

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/pages/DatasetsPage.tsx`
- Create: `frontend/src/pages/TraceTreePage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/ReportsPage.tsx`
- Modify: `frontend/src/pages/JudgeAuditPage.tsx`
- Modify: `frontend/src/test/App.test.tsx`

- [x] **Step 1: 写失败测试**

测试必须覆盖：
- 数据集页可以打开 Lineage 抽屉并看到来源与下游任务。
- `/tasks/task-demo/trace-tree` 能显示独立 Trace Tree 页面。
- 报告中心显示“质量决策中心”和下一步动作。
- Judge 审计页可以打开“多 Judge 一致性”弹窗。

- [x] **Step 2: 运行前端定向测试确认红灯**

Run: `cd frontend && npm test -- src/test/App.test.tsx -t "Lineage|Trace Tree|质量决策|多 Judge"`

Expected: 失败原因是 UI 或 API client 字段尚未实现。

- [x] **Step 3: 实现最小前端能力**

实现内容：
- API client 新增 `datasetLineage()`、`taskParameterGovernance()`、`crossValidateJudges()`。
- 数据集页新增“查看 Lineage”按钮与抽屉。
- 新增 Trace Tree 独立页面，展示 Run、Workflow、Dataset、Item、Step 输入输出摘要。
- 报告页新增质量决策卡片。
- Judge 审计页新增多 Judge 一致性弹窗和结果卡。

- [x] **Step 4: 运行前端定向测试确认绿灯**

Run: `cd frontend && npm test -- src/test/App.test.tsx -t "Lineage|Trace Tree|质量决策|多 Judge"`

Expected: 相关测试通过。

---

### Task 4: 文档与完整验收

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`
- Modify: `docs/INTERACTION_ACCEPTANCE_MATRIX.md`

- [x] **Step 1: 同步验收矩阵**

写入本批次新增能力：
- Dataset Lineage。
- Trace Tree 独立页。
- Task 参数治理。
- 质量决策中心。
- 多 Judge 一致性。

- [x] **Step 2: 完整验证**

Run:

```powershell
python -m pytest -q
cd frontend
npm run typecheck
npm test
npm run build
npm run e2e
```

Expected:
- 后端全量通过。
- 前端类型检查、单测、构建、E2E 通过。

- [x] **Step 3: 提交 Git 变更**

Run:

```powershell
git status --short
git add .
git commit -m "feat: 增强可信评测治理视图"
```

Expected: 生成一个聚焦本批次能力的提交。
