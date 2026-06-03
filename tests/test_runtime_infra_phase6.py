from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.storage.artifacts import LocalArtifactStore
from aegisqa.storage.json_store import JsonStore
from aegisqa.workers.local import LocalRunWorker


def test_local_artifact_store_writes_reads_and_blocks_traversal(tmp_path: Path) -> None:
    store = LocalArtifactStore(tmp_path / "artifacts")

    uri = store.put_bytes("reports/run-1/result.json", b'{"ok": true}', content_type="application/json")

    assert uri == "local://reports/run-1/result.json"
    assert store.get_bytes(uri) == b'{"ok": true}'
    assert store.describe(uri)["content_type"] == "application/json"
    assert store.get_json(uri) == {"ok": True}

    try:
        store.put_bytes("../escape.txt", b"bad")
    except ValueError as exc:
        assert "ARTIFACT_PATH_INVALID" in str(exc)
    else:  # pragma: no cover - defensive assertion
        raise AssertionError("path traversal should be blocked")


def test_json_store_is_marked_dev_only(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")

    assert store.dev_only is True
    assert store.production_replacement == "PostgreSQL/MySQL metadata store + ArtifactStore"


def test_local_run_worker_executes_queued_run(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    data_path = tmp_path / "worker.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"question": "worker"}, ensure_ascii=False) + "\n")
    dataset = client.post("/datasets/from-path", json={"name": "worker_dataset", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "worker_workflow",
                "nodes": [
                    {
                        "node_id": "answer",
                        "node_type": "skill",
                        "label": "answer",
                        "skill_ref": "llm.call@0.1.0",
                        "input_mapping": {"prompt": "row.question"},
                        "output_mapping": {"answer": "context.answer"},
                        "config": {"model": "demo-model"},
                    },
                    {"node_id": "report", "node_type": "output", "label": "report"},
                ],
                "edges": [{"source": "answer", "target": "report"}],
            }
        },
    ).json()
    run = client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    worker = LocalRunWorker(client.app.state.runner)
    worker.enqueue_run(run["run_id"])

    result = worker.run_once()

    assert result["status"] == "completed"
    assert result["run_id"] == run["run_id"]
    assert result["processed_items"] == 1


def test_api_enqueues_run_and_local_worker_processes_one_pending_item_at_a_time(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    run = _create_worker_run(client, tmp_path, row_count=2)

    queue_status = client.get("/workers/local/status").json()
    assert queue_status["pending_runs"] == [run["run_id"]]

    first = client.post("/workers/local/run-once").json()
    assert first["run_id"] == run["run_id"]
    assert first["processed_items"] == 1
    assert first["run_status"] == "running"
    partially_processed = client.get(f"/runs/{run['run_id']}").json()
    assert [item["status"] for item in partially_processed["items"]] == ["succeeded", "pending"]

    second = client.post("/workers/local/run-once").json()
    assert second["processed_items"] == 1
    assert second["run_status"] == "completed"
    completed = client.get(f"/runs/{run['run_id']}").json()
    assert [item["status"] for item in completed["items"]] == ["succeeded", "succeeded"]


def test_local_worker_does_not_start_new_item_after_pause_or_cancel(tmp_path: Path) -> None:
    paused_client = TestClient(create_app(store_root=tmp_path / "paused-store"))
    paused_run = _create_worker_run(paused_client, tmp_path, row_count=2)
    paused_client.post("/workers/local/run-once")
    paused_client.post(f"/runs/{paused_run['run_id']}/pause")

    paused_result = paused_client.post("/workers/local/run-once").json()
    paused_snapshot = paused_client.get(f"/runs/{paused_run['run_id']}").json()
    assert paused_result["processed_items"] == 0
    assert paused_snapshot["status"] == "paused"
    assert [item["status"] for item in paused_snapshot["items"]] == ["succeeded", "pending"]

    canceled_client = TestClient(create_app(store_root=tmp_path / "canceled-store"))
    canceled_run = _create_worker_run(canceled_client, tmp_path, row_count=2)
    canceled_client.post("/workers/local/run-once")
    canceled_client.post(f"/runs/{canceled_run['run_id']}/cancel")

    canceled_result = canceled_client.post("/workers/local/run-once").json()
    canceled_snapshot = canceled_client.get(f"/runs/{canceled_run['run_id']}").json()
    assert canceled_result["processed_items"] == 0
    assert canceled_snapshot["status"] == "canceled"
    assert [item["status"] for item in canceled_snapshot["items"]] == ["succeeded", "pending"]


def test_runtime_records_expose_canonical_state_machine_values(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "state-store"))
    run = _create_worker_run(client, tmp_path, row_count=2)
    assert run["state"] == "QUEUED"
    assert [item["state"] for item in run["items"]] == ["PENDING", "PENDING"]

    client.post("/workers/local/run-once")
    running = client.get(f"/runs/{run['run_id']}").json()
    assert running["state"] == "RUNNING"
    assert [item["state"] for item in running["items"]] == ["SUCCEEDED", "PENDING"]
    assert running["items"][0]["steps"][0]["state"] == "SUCCEEDED"

    client.post(f"/runs/{run['run_id']}/pause")
    paused = client.get(f"/runs/{run['run_id']}").json()
    assert paused["state"] == "PAUSED"

    client.post(f"/runs/{run['run_id']}/resume")
    completed = client.get(f"/runs/{run['run_id']}").json()
    assert completed["state"] == "SUCCEEDED"
    assert [item["state"] for item in completed["items"]] == ["SUCCEEDED", "SUCCEEDED"]


def _create_worker_run(client: TestClient, tmp_path: Path, *, row_count: int) -> dict:
    data_path = tmp_path / f"worker-{row_count}.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        for index in range(row_count):
            handle.write(json.dumps({"question": f"worker {index}"}, ensure_ascii=False) + "\n")
    dataset = client.post("/datasets/from-path", json={"name": f"worker_dataset_{row_count}", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": f"worker_workflow_{row_count}",
                "nodes": [
                    {
                        "node_id": "answer",
                        "node_type": "skill",
                        "label": "answer",
                        "skill_ref": "llm.call@0.1.0",
                        "input_mapping": {"prompt": "row.question"},
                        "output_mapping": {"answer": "context.answer"},
                        "config": {"model": "demo-model"},
                    },
                    {"node_id": "report", "node_type": "output", "label": "report"},
                ],
                "edges": [{"source": "answer", "target": "report"}],
            }
        },
    ).json()
    return client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
