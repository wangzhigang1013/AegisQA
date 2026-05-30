from __future__ import annotations

from threading import Thread
from time import sleep

from aegisqa.storage.file_lock import FileLock
from aegisqa.storage.json_store import JsonStore


def test_file_lock_serializes_parallel_threads(tmp_path) -> None:
    lock_path = tmp_path / "shared.json.lock"
    state = {"active": 0, "max_active": 0, "completed": 0}

    def worker() -> None:
        with FileLock(lock_path, timeout_seconds=5):
            state["active"] += 1
            state["max_active"] = max(state["max_active"], state["active"])
            sleep(0.003)
            state["completed"] += 1
            state["active"] -= 1

    threads = [Thread(target=worker) for _ in range(30)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert state["completed"] == 30
    assert state["max_active"] == 1
    assert not lock_path.exists()


def test_json_store_append_jsonl_preserves_concurrent_rows(tmp_path) -> None:
    store = JsonStore(tmp_path / "store")

    def writer(offset: int) -> None:
        for index in range(20):
            store.append_jsonl(["events", "index.jsonl"], {"id": offset + index})

    threads = [Thread(target=writer, args=(worker_index * 20,)) for worker_index in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    rows = list(store.iter_jsonl(["events", "index.jsonl"]))
    assert len(rows) == 400
    assert sorted(row["id"] for row in rows) == list(range(400))
