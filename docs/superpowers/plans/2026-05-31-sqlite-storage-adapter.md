# SQLite 轻量仓储适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留当前本地文件资产能力的前提下，新增 SQLite 元数据仓储，让 AegisQA 可以先用轻量数据库承载 Task、Run、Workflow、Report、Judge、审计等 JSON 文档。

**Architecture:** 新增 `SQLiteStore`，与 `JsonStore` 暴露相同的 `read_json/write_json/write_jsonl/append_jsonl/iter_jsonl/path/list_json` 接口。JSON 文档进入 SQLite，Dataset rows、上传文件、Skill 插件包继续通过 `path()` 落本地文件；这样数据库先承担元数据一致性，文件系统继续承担大对象与流式样本。

**Tech Stack:** Python stdlib `sqlite3`、FastAPI、pytest、现有 JsonStore 接口。

---

### Task 1: Store 列表接口与 SQLite 红灯测试

**Files:**
- Create: `tests/test_sqlite_store_adapter.py`
- Modify: `docs/PROJECT_STATUS.md`

- [x] **Step 1: Write failing tests**

新增测试：

```python
def test_sqlite_store_round_trips_json_jsonl_and_lists_records(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "store")
    store.write_json(["tasks", "task-a.json"], {"task_id": "task-a", "value": 1})
    assert store.read_json(["tasks", "task-a.json"])["value"] == 1
    assert [item["task_id"] for item in store.list_json(["tasks"])] == ["task-a"]
    store.append_jsonl(["audit", "events.jsonl"], {"event_id": "e1"})
    store.append_jsonl(["audit", "events.jsonl"], {"event_id": "e2"})
    assert [row["event_id"] for row in store.iter_jsonl(["audit", "events.jsonl"])] == ["e1", "e2"]
```

```python
def test_fastapi_task_flow_can_use_sqlite_backend(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store", storage_backend="sqlite"))
    # 上传数据、发布 Workflow、创建 Task、执行 Task 后，列表接口必须从 SQLite 读回。
```

```python
def test_sqlite_store_reads_legacy_file_json_for_gradual_migration(tmp_path: Path) -> None:
    legacy_path = tmp_path / "store" / "tasks" / "task-legacy.json"
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_text(json.dumps({"task_id": "task-legacy"}, ensure_ascii=False), encoding="utf-8")
    store = SQLiteStore(tmp_path / "store")
    assert store.read_json(["tasks", "task-legacy.json"])["task_id"] == "task-legacy"
    assert store.list_json(["tasks"])[0]["task_id"] == "task-legacy"
```

- [x] **Step 2: Run RED**

Run: `python -m pytest tests\test_sqlite_store_adapter.py -q`

Expected: fails because `aegisqa.storage.sqlite_store.SQLiteStore` and `create_app(..., storage_backend="sqlite")` do not exist.

### Task 2: 实现 Store 接口

**Files:**
- Modify: `aegisqa/storage/json_store.py`
- Create: `aegisqa/storage/sqlite_store.py`

- [x] **Step 1: Add `JsonStore.list_json`**

`JsonStore.list_json(prefix, recursive=False)` 按更新时间倒序返回 JSON payload，供上层服务停止直接扫 `store.root`。

- [x] **Step 2: Add `SQLiteStore`**

SQLite 表结构：

```sql
create table if not exists json_documents (
  key text primary key,
  payload text not null,
  updated_at text not null
);
create table if not exists jsonl_rows (
  stream_key text not null,
  row_index integer not null,
  payload text not null,
  created_at text not null,
  primary key (stream_key, row_index)
);
```

`path()` 仍返回 `root / parts`，用于 Dataset rows、上传文件和插件包。

- [x] **Step 3: Run store test GREEN**

Run: `python -m pytest tests\test_sqlite_store_adapter.py::test_sqlite_store_round_trips_json_jsonl_and_lists_records -q`

Expected: 1 passed。

### Task 3: FastAPI 与服务列表迁移

**Files:**
- Modify: `aegisqa/api/app.py`
- Modify: `aegisqa/datasets/service.py`
- Modify: `aegisqa/workflows/service.py`
- Modify: `aegisqa/engine/runner.py`
- Modify: `aegisqa/judge/profiles.py`

- [x] **Step 1: Add backend selection**

`create_app(store_root=..., storage_backend="json|sqlite")`，默认仍是 `json`；未传参时可读取 `AEGISQA_STORAGE_BACKEND`。

- [x] **Step 2: Replace direct `store.root` scans**

把 `_list_records`、`_list_workflow_drafts`、`WorkflowService.list_versions`、`WorkflowRunner.list_runs`、`DatasetService.list_datasets`、`JudgeProfileService.list_profiles/list_all_audits` 改成 `store.list_json(...)`。

- [x] **Step 3: Run FastAPI SQLite GREEN**

Run: `python -m pytest tests\test_sqlite_store_adapter.py -q`

Expected: 3 passed。

### Task 4: 文档、验证与提交

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/PRD_ACCEPTANCE_MATRIX.md`

- [x] **Step 1: Document SQLite mode**

README 增加：

```powershell
$env:AEGISQA_STORAGE_BACKEND="sqlite"
python -m uvicorn aegisqa.api.app:app --reload --host 127.0.0.1 --port 8000
```

说明 SQLite 当前承担元数据，文件资产仍保留本地路径。

- [x] **Step 2: Run full verification**

Run:

```powershell
python -m pytest -q
python -m aegisqa.examples.run_mvp_demo
cd frontend; npm run typecheck
cd frontend; npm test
cd frontend; npm run build
cd frontend; npm run e2e
```

- [x] **Step 3: Commit**

Run:

```powershell
git add .
git commit -m "feat: 支持 SQLite 轻量元数据仓储"
```
