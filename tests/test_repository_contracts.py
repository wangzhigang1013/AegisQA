from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import pytest

from aegisqa.storage.file_lock import FileLock
from aegisqa.storage.json_store import JsonStore
from aegisqa.storage.repositories import RepositoryRegistry
from aegisqa.storage.sqlite_store import SQLiteStore


@pytest.mark.parametrize("store_factory", [JsonStore, SQLiteStore])
def test_core_repository_contracts_are_shared_by_json_and_sqlite(store_factory, tmp_path) -> None:
    store = store_factory(tmp_path / store_factory.__name__)
    repositories = RepositoryRegistry(store)

    repositories.tasks.save({"task_id": "task-a", "status": "queued"})
    repositories.runs.save({"run_id": "run-a", "status": "completed"})
    repositories.workflows.save({"version_id": "wf-demo:v1", "name": "Workflow v1"})
    repositories.skill_packages.save({"package_id": "pkg-a", "status": "pending_review"})
    repositories.audit_events.append(
        {
            "event_id": "audit-a",
            "actor": "api",
            "action": "repository.contract",
            "target": "task-a",
            "detail": {"ok": True},
            "created_at": "2026-06-04T00:00:00+00:00",
        }
    )

    assert repositories.tasks.get("task-a")["status"] == "queued"
    assert repositories.runs.get("run-a")["status"] == "completed"
    assert repositories.workflows.get("wf-demo:v1")["name"] == "Workflow v1"
    assert repositories.skill_packages.get("pkg-a")["status"] == "pending_review"
    assert repositories.audit_events.get("audit-a")["detail"]["ok"] is True
    assert {record["task_id"] for record in repositories.tasks.list()} == {"task-a"}
    assert {record["version_id"] for record in repositories.workflows.list()} == {"wf-demo:v1"}
    assert [event["event_id"] for event in repositories.audit_events.list()] == ["audit-a"]


@pytest.mark.parametrize("store_factory", [JsonStore, SQLiteStore])
def test_repository_get_raises_key_error_with_collection_context(store_factory, tmp_path) -> None:
    repositories = RepositoryRegistry(store_factory(tmp_path / store_factory.__name__))

    with pytest.raises(KeyError, match="tasks 记录不存在：missing-task"):
        repositories.tasks.get("missing-task")


def test_json_store_list_json_waits_for_document_file_lock(tmp_path) -> None:
    store = JsonStore(tmp_path / "store")
    store.write_json(["skill_packages", "pkg-a.json"], {"package_id": "pkg-a", "status": "pending_review"})
    document_path = store.path("skill_packages", "pkg-a.json")
    lock_path = document_path.with_name(f"{document_path.name}.lock")

    executor = ThreadPoolExecutor(max_workers=1)
    try:
        with FileLock(lock_path, timeout_seconds=1):
            future = executor.submit(store.list_json, ["skill_packages"])
            # list_json 是读路径，也必须尊重写锁；否则 Windows 下并发 os.replace
            # 可能因为读句柄仍打开而失败，E2E Skill 合约测试会偶发 500。
            with pytest.raises(FutureTimeoutError):
                future.result(timeout=0.1)

        assert future.result(timeout=1) == [{"package_id": "pkg-a", "status": "pending_review"}]
    finally:
        executor.shutdown(wait=True)
