# Repair Task Follow-up Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Repair Task 的修复建议拆成可领取、可完成、可重开的二级任务。

**Architecture:** 继续复用现有 `POST /repair-tasks/{repair_task_id}/actions` 动作入口，新增 `create_followup_repair_tasks`。后端从最近的 `remediation_plan` 或 `generate_remediation_plan` 结果中读取建议，跳过父任务已有的 `retest_and_compare` 验证动作，把其余建议保存为带父子关系的 Repair Task。前端工作台直接合并动作响应中的父任务和子任务，避免刷新竞态。

**Tech Stack:** FastAPI、现有 JSON/SQLite Store 抽象、React、Ant Design、TanStack Query、Vitest、Pytest。

---

## 任务 1：后端拆分动作

- [x] 写失败测试：`tests/test_task_flow_optimization.py::test_repair_task_can_split_remediation_plan_into_followup_tasks`。
- [x] 运行 `python -m pytest tests\test_task_flow_optimization.py -q`，确认 `create_followup_repair_tasks` 不支持导致失败。
- [x] 在 `aegisqa/api/routes/tasks.py` 支持 `create_followup_repair_tasks`。
- [x] 子任务字段包含 `parent_repair_task_id`、`recommended_action`、`target_url`、`remediation_area`、证据和推荐说明。
- [x] 重复触发时按父任务、标题和推荐动作复用已有子任务。
- [x] 将最近建议持久化为 `remediation_plan`，避免 `last_action_result` 被后续动作覆盖后丢失上下文。
- [x] 运行后端定向测试确认通过。

## 任务 2：前端工作台入口

- [x] 写失败测试：`frontend/src/test/App.test.tsx` 新增“修复任务工作台支持把建议拆成可追踪子任务”。
- [x] 运行 `npm test -- src/test/App.test.tsx -t "拆成可追踪子任务"`，确认缺少按钮导致失败。
- [x] `frontend/src/types.ts` 增加子任务和推荐动作字段。
- [x] `frontend/src/pages/RepairTasksPage.tsx` 新增“拆分子任务”按钮。
- [x] 新增“推荐动作”列，展示 `recommended_action` 和 `target_url` 入口。
- [x] 动作成功后把响应中的子任务合并到当前列表，而不是依赖立即 refetch。
- [x] 运行前端定向测试确认通过。

## 任务 3：文档与验证

- [x] 同步 `docs/PROJECT_STATUS.md`。
- [x] 同步 `docs/PRD_ACCEPTANCE_MATRIX.md`。
- [x] 同步 `docs/INTERACTION_ACCEPTANCE_MATRIX.md`。
- [x] 运行 `git diff --check`。
- [x] 运行 `python -m pytest -q`。
- [x] 运行 `cd frontend && npm run typecheck`。
- [x] 运行 `cd frontend && npm test`。
- [x] 运行 `cd frontend && npm run build`。
- [x] 运行 `cd frontend && npm run e2e`。
