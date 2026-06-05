import json
from pathlib import Path
from threading import Thread

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.storage.sqlite_store import SQLiteStore


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict[str, object]:
    return {
        "name": "SQLite 任务 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "sqlite-model", "temperature": 0},
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


def test_sqlite_store_round_trips_json_jsonl_and_lists_records(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "store")

    store.write_json(["tasks", "task-a.json"], {"task_id": "task-a", "value": 1})
    store.write_json(["tasks", "task-b.json"], {"task_id": "task-b", "value": 2})

    assert store.read_json(["tasks", "task-a.json"])["value"] == 1
    assert {item["task_id"] for item in store.list_json(["tasks"])} == {"task-a", "task-b"}
    assert not (tmp_path / "store" / "tasks" / "task-a.json").exists()

    store.append_jsonl(["audit", "events.jsonl"], {"event_id": "e1"})
    store.append_jsonl(["audit", "events.jsonl"], {"event_id": "e2"})

    assert [row["event_id"] for row in store.iter_jsonl(["audit", "events.jsonl"])] == ["e1", "e2"]
    assert (tmp_path / "store" / "aegisqa.sqlite3").exists()


def test_sqlite_store_append_jsonl_preserves_concurrent_rows(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "store")
    errors: list[BaseException] = []

    def writer(offset: int) -> None:
        try:
            for index in range(20):
                store.append_jsonl(["audit", "events.jsonl"], {"event_id": f"e-{offset + index}", "order": offset + index})
        except BaseException as exc:  # pragma: no cover - 失败时由断言统一展示异常。
            errors.append(exc)

    threads = [Thread(target=writer, args=(worker_index * 20,)) for worker_index in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    rows = list(store.iter_jsonl(["audit", "events.jsonl"]))
    assert len(rows) == 400
    assert sorted(row["order"] for row in rows) == list(range(400))


def test_sqlite_store_reads_legacy_file_json_for_gradual_migration(tmp_path: Path) -> None:
    legacy_path = tmp_path / "store" / "tasks" / "task-legacy.json"
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_text(json.dumps({"task_id": "task-legacy", "value": 3}, ensure_ascii=False), encoding="utf-8")
    store = SQLiteStore(tmp_path / "store")

    assert store.read_json(["tasks", "task-legacy.json"])["task_id"] == "task-legacy"
    assert store.list_json(["tasks"])[0]["task_id"] == "task-legacy"


def test_fastapi_task_flow_can_use_sqlite_backend(tmp_path: Path) -> None:
    store_root = tmp_path / "sqlite-store"
    app = create_app(store_root=store_root, storage_backend="sqlite")
    client = TestClient(app)
    data_path = tmp_path / "sqlite_dataset.jsonl"
    _write_jsonl(
        data_path,
        [
            {"question": "什么是 SQLite?", "reference": "SQLite", "expected_label": "pass"},
            {"question": "什么是坏例?", "reference": "不相关参考", "expected_label": "fail"},
        ],
    )

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "sqlite_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "SQLite 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "cost_budget": 1.0,
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()

    assert executed["status"] == "completed"
    assert client.get("/tasks").json()[0]["task_id"] == task["task_id"]
    assert client.get("/datasets").json()[0]["dataset_id"] == dataset["dataset_id"]
    assert client.get("/workflows").json()[0]["version_id"] == workflow["version_id"]
    assert client.get("/runs").json()[0]["run_id"] == executed["run_id"]
    assert client.get(f"/tasks/{task['task_id']}/report").json()["budget_status"]["status"] in {"ok", "warning", "exceeded"}
    assert (store_root / "aegisqa.sqlite3").exists()
    assert not (store_root / "tasks" / f"{task['task_id']}.json").exists()
