from __future__ import annotations

import json
from pathlib import Path
from threading import Barrier, BrokenBarrierError, Lock, Thread
from typing import Any

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.storage.mysql_store import MySQLStore
from aegisqa.storage.repositories import RepositoryRegistry


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict[str, object]:
    return {
        "name": "MySQL 任务 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "mysql-model", "temperature": 0},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def test_mysql_store_round_trips_core_repositories_and_mirrors_dedicated_tables(tmp_path: Path) -> None:
    fake = _FakeMySQL()
    store = MySQLStore(tmp_path / "mysql-store", connection_factory=fake.connect)
    repositories = RepositoryRegistry(store)

    repositories.tasks.save({"task_id": "task-a", "name": "任务 A", "status": "queued"})
    repositories.runs.save({"run_id": "run-a", "status": "completed", "dataset_id": "ds", "dataset_version": 1, "snapshot": {}})
    repositories.workflows.save(
        {
            "workflow_id": "wf-demo",
            "version_id": "wf-demo:v1",
            "name": "Workflow v1",
            "version": 1,
            "status": "published",
            "snapshot_hash": "hash-a",
            "steps": [],
            "published_at": "2026-06-04T00:00:00+00:00",
        }
    )
    repositories.audit_events.append(
        {
            "event_id": "audit-a",
            "actor": "api",
            "role": "Evaluator",
            "action": "repository.contract",
            "target": "task-a",
            "result": "success",
            "trace_id": "trace-test",
            "detail": {"ok": True},
            "created_at": "2026-06-04T00:00:00+00:00",
        }
    )

    assert repositories.tasks.get("task-a")["status"] == "queued"
    assert repositories.runs.get("run-a")["status"] == "completed"
    assert repositories.workflows.get("wf-demo:v1")["name"] == "Workflow v1"
    assert repositories.audit_events.get("audit-a")["detail"]["ok"] is True
    assert {record["task_id"] for record in repositories.tasks.list()} == {"task-a"}
    assert [event["event_id"] for event in repositories.audit_events.list()] == ["audit-a"]
    assert fake.tables["tasks"]["task-a"]["status"] == "queued"
    assert fake.tables["runs"]["run-a"]["status"] == "completed"
    assert fake.tables["workflow_versions"]["wf-demo:v1"]["name"] == "Workflow v1"
    assert fake.tables["audit_events"]["audit-a"]["action"] == "repository.contract"
    assert any("create table if not exists workflow_versions" in sql.lower() for sql in fake.executed_sql)
    assert not (tmp_path / "mysql-store" / "tasks" / "task-a.json").exists()


def test_mysql_store_append_jsonl_preserves_concurrent_audit_rows(tmp_path: Path) -> None:
    fake = _FakeMySQL(race_jsonl_next_index=True)
    store = MySQLStore(tmp_path / "mysql-store", connection_factory=fake.connect)
    errors: list[BaseException] = []

    def writer(index: int) -> None:
        try:
            store.append_jsonl(
                ["audit", "events.jsonl"],
                {
                    "event_id": f"audit-race-{index}",
                    "actor": "api",
                    "action": "mysql.concurrent_append",
                    "target": f"target-{index}",
                    "order": index,
                },
            )
        except BaseException as exc:  # pragma: no cover - 失败时由断言统一展示异常。
            errors.append(exc)

    threads = [Thread(target=writer, args=(index,)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    rows = list(store.iter_jsonl(["audit", "events.jsonl"]))
    assert len(rows) == 2
    assert sorted(row["order"] for row in rows) == [0, 1]
    assert sorted(fake.tables["audit_events"]) == ["audit-race-0", "audit-race-1"]


def test_fastapi_task_flow_can_use_mysql_backend_with_core_tables(tmp_path: Path) -> None:
    fake = _FakeMySQL()
    store_root = tmp_path / "mysql-store"
    app = create_app(store_root=store_root, storage_backend="mysql", mysql_connection_factory=fake.connect)
    client = TestClient(app)
    data_path = tmp_path / "mysql_dataset.jsonl"
    _write_jsonl(
        data_path,
        [
            {"question": "什么是 MySQL?", "reference": "MySQL", "expected_label": "pass"},
            {"question": "什么是坏例?", "reference": "不相关参考", "expected_label": "fail"},
        ],
    )

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "mysql_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "MySQL 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "cost_budget": 1.0,
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()

    assert executed["status"] == "completed"
    assert client.get("/tasks").json()[0]["task_id"] == task["task_id"]
    assert client.get("/workflows").json()[0]["version_id"] == workflow["version_id"]
    assert client.get("/runs").json()[0]["run_id"] == executed["run_id"]
    assert client.get(f"/tasks/{task['task_id']}/report").json()["budget_status"]["status"] in {"ok", "warning", "exceeded"}
    assert fake.tables["tasks"][task["task_id"]]["status"] == "completed"
    assert fake.tables["runs"][executed["run_id"]]["status"] == "completed"
    assert workflow["version_id"] in fake.tables["workflow_versions"]
    assert not (store_root / "tasks" / f"{task['task_id']}.json").exists()


def test_governance_runtime_status_reports_mysql_backend_when_enabled(tmp_path: Path) -> None:
    fake = _FakeMySQL()
    client = TestClient(create_app(store_root=tmp_path / "mysql-store", storage_backend="mysql", mysql_connection_factory=fake.connect))

    payload = client.get("/governance/runtime-status").json()
    components = {component["component_id"]: component for component in payload["components"]}

    assert payload["storage"]["backend"] == "mysql"
    assert payload["storage"]["status"] == "available"
    assert payload["external_services"]["mysql"]["status"] == "configured"
    assert components["storage"]["backend"] == "mysql"
    assert components["mysql"]["status"] == "configured"
    assert components["mysql"]["status_label"] == "已配置"


class _FakeMySQL:
    def __init__(self, *, race_jsonl_next_index: bool = False) -> None:
        self.json_documents: dict[str, dict[str, Any]] = {}
        self.jsonl_rows: dict[str, list[dict[str, Any]]] = {}
        self.tables: dict[str, dict[str, dict[str, Any]]] = {
            "tasks": {},
            "runs": {},
            "workflow_versions": {},
            "audit_events": {},
        }
        self.executed_sql: list[str] = []
        self._lock = Lock()
        self._jsonl_next_index_barrier = Barrier(2) if race_jsonl_next_index else None
        self._named_locks: dict[str, Lock] = {}

    def connect(self) -> "_FakeConnection":
        return _FakeConnection(self)


class _FakeConnection:
    def __init__(self, database: _FakeMySQL) -> None:
        self.database = database
        self.held_locks: dict[str, Lock] = {}

    def cursor(self) -> "_FakeCursor":
        return _FakeCursor(self)

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None

    def close(self) -> None:
        return None


class _FakeCursor:
    def __init__(self, connection: _FakeConnection) -> None:
        self.connection = connection
        self.database = connection.database
        self._result: list[dict[str, Any]] = []

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> None:
        params = tuple(params or ())
        self.database.executed_sql.append(sql)
        normalized = " ".join(sql.lower().split())
        if normalized.startswith("select get_lock"):
            lock_name = str(params[0])
            with self.database._lock:
                lock = self.database._named_locks.setdefault(lock_name, Lock())
            acquired = lock.acquire(timeout=float(params[1] if len(params) > 1 else 10))
            if acquired:
                self.connection.held_locks[lock_name] = lock
            self._result = [{"lock_acquired": 1 if acquired else 0, "get_lock(%s, %s)": 1 if acquired else 0}]
            return
        if normalized.startswith("select release_lock"):
            lock_name = str(params[0])
            lock = self.connection.held_locks.pop(lock_name, None)
            if lock:
                lock.release()
            self._result = [{"lock_released": 1, "release_lock(%s)": 1}]
            return
        if normalized.startswith("insert into json_documents"):
            key, collection, payload, updated_at = params[:4]
            self.database.json_documents[str(key)] = {"collection": collection, "payload_json": payload, "updated_at": updated_at}
            return
        if normalized.startswith("select payload_json from json_documents where document_key"):
            row = self.database.json_documents.get(str(params[0]))
            self._result = [{"payload_json": row["payload_json"]}] if row else []
            return
        if normalized.startswith("select document_key, payload_json, updated_at from json_documents"):
            pattern = str(params[0])
            prefix, _, suffix = pattern.partition("%")
            rows = [
                {"document_key": key, "payload_json": row["payload_json"], "updated_at": row["updated_at"]}
                for key, row in self.database.json_documents.items()
                if key.startswith(prefix) and key.endswith(suffix)
            ]
            self._result = sorted(rows, key=lambda row: str(row["updated_at"]), reverse=True)
            return
        if normalized.startswith("delete from jsonl_rows"):
            with self.database._lock:
                self.database.jsonl_rows[str(params[0])] = []
            return
        if normalized.startswith("select coalesce(max(row_index)"):
            rows = self.database.jsonl_rows.get(str(params[0]), [])
            next_index = (max((int(row["row_index"]) for row in rows), default=-1) + 1)
            barrier = self.database._jsonl_next_index_barrier
            if barrier is not None and not self.connection.held_locks:
                try:
                    barrier.wait(timeout=5)
                except BrokenBarrierError:
                    pass
            self._result = [{"next_index": next_index}]
            return
        if normalized.startswith("insert into jsonl_rows"):
            stream_key, row_index, payload, created_at = params[:4]
            with self.database._lock:
                rows = self.database.jsonl_rows.setdefault(str(stream_key), [])
                if any(int(row["row_index"]) == int(row_index) for row in rows):
                    raise RuntimeError(f"Duplicate entry '{stream_key}-{row_index}' for key 'jsonl_rows.PRIMARY'")
                rows.append({"row_index": int(row_index), "payload_json": payload, "created_at": created_at})
            return
        if normalized.startswith("select payload_json from jsonl_rows"):
            rows = sorted(self.database.jsonl_rows.get(str(params[0]), []), key=lambda row: int(row["row_index"]))
            self._result = [{"payload_json": row["payload_json"]} for row in rows]
            return
        if normalized.startswith("insert into tasks"):
            task_id, name, status, dataset_version_id, workflow_version_id, run_id, payload = params[:7]
            self.database.tables["tasks"][str(task_id)] = {
                "name": name,
                "status": status,
                "dataset_version_id": dataset_version_id,
                "workflow_version_id": workflow_version_id,
                "run_id": run_id,
                **json.loads(str(payload)),
            }
            return
        if normalized.startswith("insert into runs"):
            run_id, workflow_version_id, dataset_version_id, status, snapshot, payload, created_at, started_at, finished_at = params[:9]
            self.database.tables["runs"][str(run_id)] = {
                "workflow_version_id": workflow_version_id,
                "dataset_version_id": dataset_version_id,
                "status": status,
                "snapshot": json.loads(str(snapshot or "{}")),
                "created_at": created_at,
                "started_at": started_at,
                "finished_at": finished_at,
                **json.loads(str(payload)),
            }
            return
        if normalized.startswith("insert into workflow_versions"):
            version_id, workflow_id, name, version, status, snapshot_hash, payload, published_at = params[:8]
            self.database.tables["workflow_versions"][str(version_id)] = {
                "workflow_id": workflow_id,
                "name": name,
                "version": version,
                "status": status,
                "snapshot_hash": snapshot_hash,
                "workflow_json": json.loads(str(payload)),
                "published_at": published_at,
            }
            return
        if normalized.startswith("insert into audit_events"):
            event_id, actor, role, action, target, result, trace_id, detail, created_at = params[:9]
            self.database.tables["audit_events"][str(event_id)] = {
                "actor": actor,
                "role": role,
                "action": action,
                "target": target,
                "result": result,
                "trace_id": trace_id,
                "detail": json.loads(str(detail)),
                "created_at": created_at,
            }
            return

    def executemany(self, sql: str, rows: list[tuple[Any, ...]]) -> None:
        for row in rows:
            self.execute(sql, row)

    def fetchone(self) -> dict[str, Any] | None:
        return self._result[0] if self._result else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self._result
