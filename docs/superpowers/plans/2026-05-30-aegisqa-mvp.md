# AegisQA MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 PRD 中 P0 闭环：Skill 注册、数据集流式解析、线性 Workflow、类型安全映射、分片执行、报告、Badcase 纠错、Golden/Judge 审计、安全脱敏与最小 API/Streamlit 界面。

**Architecture:** 采用 Python 单体 MVP：`aegisqa` 包承载领域模型、执行引擎、Skill 系统、JSON 文件仓储、FastAPI API 与 Streamlit UI。异步队列在本地 MVP 中用轻量队列抽象模拟，消息只携带 `item_id`，接口保留 Celery/Redis 替换点。

**Tech Stack:** Python 3.10+、Pydantic v2、FastAPI、Streamlit、pytest、PyYAML、标准库 JSON/CSV/SQLite 风格文件存储。

---

### Task 1: 项目骨架与核心测试

**Files:**
- Create: `pyproject.toml`
- Create: `README.md`
- Create: `aegisqa/__init__.py`
- Create: `tests/test_platform_core.py`

- [x] **Step 1: 写失败测试**

测试覆盖 PRD 验收主链路：Skill 注册、CSV/JSONL 流式数据集、类型安全、运行与报告、Badcase、Judge 审计、Secret 脱敏。

- [x] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_platform_core.py -q`

Expected: 初始红灯阶段应失败，失败点为 `aegisqa` 包缺少对应模块。

### Task 2: Skill 系统与类型安全映射

**Files:**
- Create: `aegisqa/skills/base.py`
- Create: `aegisqa/skills/examples.py`
- Create: `aegisqa/skills/registry.py`
- Create: `aegisqa/core/mapper.py`
- Create: `aegisqa/core/security.py`

- [x] **Step 1: 实现 BaseSkill、SkillResult、manifest 注册与合约校验**
- [x] **Step 2: 实现 `resolve_input_mapping` 与 `TypeMismatchError`**
- [x] **Step 3: 实现 Secret 脱敏**

### Task 3: 数据集、工作流与执行引擎

**Files:**
- Create: `aegisqa/datasets/service.py`
- Create: `aegisqa/workflows/models.py`
- Create: `aegisqa/engine/runner.py`
- Create: `aegisqa/engine/rate_limit.py`
- Create: `aegisqa/storage/json_store.py`

- [x] **Step 1: 实现 CSV/JSONL 流式解析、字段识别、预览、版本化**
- [x] **Step 2: 实现线性 Workflow 发布快照**
- [x] **Step 3: 实现 Run/Item/Step 状态机、Chunk 派发与轻量队列消息**
- [x] **Step 4: 实现失败重试、断点续跑、取消标记与限速等待记录**

### Task 4: 报告、Badcase 与 Judge 审计

**Files:**
- Create: `aegisqa/reports/aggregator.py`
- Create: `aegisqa/judge/audit.py`
- Create: `aegisqa/badcases/service.py`

- [x] **Step 1: 聚合通过率、错误率、平均/P95 耗时和业务指标**
- [x] **Step 2: 生成 Badcase 列表与人工纠错流转**
- [x] **Step 3: 输出 Accuracy、Precision、Recall、F1、Cohen's Kappa、混淆矩阵**

### Task 5: API、UI 与验收材料

**Files:**
- Create: `aegisqa/api/app.py`
- Create: `streamlit_app.py`
- Create: `examples/data/rag_qa_1000.jsonl`
- Create: `examples/workflows/rag_regression.yaml`
- Create: `tests/test_api.py`

- [x] **Step 1: 实现 REST API 草案**
- [x] **Step 2: 实现 Streamlit MVP 页面**
- [x] **Step 3: 生成 1000 条示例数据与示例 Workflow**
- [x] **Step 4: 写 PRD 验收清单并运行完整验证**

### Task 6: PRD 扩展项补齐

**Files:**
- Create: `aegisqa/workflows/dag.py`
- Create: `aegisqa/judge/prompt_candidates.py`
- Create: `aegisqa/infrastructure/manifest.py`
- Create: `infra/mysql/schema.sql`
- Create: `docker-compose.yml`
- Modify: `streamlit_app.py`
- Test: `tests/test_full_prd_gap_closure.py`

- [x] **Step 1: 实现真实 Source Skill 执行与 Source rows 物化**
- [x] **Step 2: 实现 DAG 条件分支与按层并行执行**
- [x] **Step 3: 实现 Prompt 优化候选池、Badcase 多条件筛选和 embedding 聚类**
- [x] **Step 4: 实现 HTML/CSV 报告导出、生产适配清单、MySQL schema、Celery/Redis 部署资产**
- [x] **Step 5: 扩展 Streamlit 工作台覆盖 PRD 核心页面**
