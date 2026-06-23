"""Repository 抽象层单元测试。"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from aegisqa.storage.repositories import (
    AuditEventRepository,
    JsonDocumentRepository,
    RepositoryRegistry,
    SkillPackageRepository,
    TaskRepository,
)


# ── 辅助 ──────────────────────────────────────────────────────

class FakeStore:
    """内存文档存储，用于单元测试。"""

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._jsonl: dict[str, list[dict[str, Any]]] = {}

    def _key(self, parts: Iterable[str]) -> str:
        return "/".join(parts)

    def write_json(self, parts: Iterable[str], payload: Any) -> Any:
        self._data[self._key(parts)] = payload
        return payload

    def read_json(self, parts: Iterable[str], default: Any | None = None) -> Any:
        return self._data.get(self._key(parts), default)

    def list_json(self, prefix: Iterable[str], *, recursive: bool = False) -> list[dict[str, Any]]:
        prefix_str = self._key(prefix) + "/"
        results = []
        for key, value in self._data.items():
            if key.startswith(prefix_str) and isinstance(value, dict):
                results.append(value)
        return results

    def append_jsonl(self, parts: Iterable[str], row: dict[str, Any]) -> None:
        key = self._key(parts)
        self._jsonl.setdefault(key, []).append(row)

    def iter_jsonl(self, parts: Iterable[str]) -> Iterable[dict[str, Any]]:
        return iter(self._jsonl.get(self._key(parts), []))


# ── JsonDocumentRepository 测试 ───────────────────────────────

class TestJsonDocumentRepository:
    def test_save_and_get(self) -> None:
        store = FakeStore()
        repo = JsonDocumentRepository(store, "items", "item_id")
        record = {"item_id": "item-1", "name": "test"}
        repo.save(record)
        result = repo.get("item-1")
        assert result["name"] == "test"

    def test_get_missing_raises(self) -> None:
        store = FakeStore()
        repo = JsonDocumentRepository(store, "items", "item_id")
        with pytest.raises(KeyError, match="记录不存在"):
            repo.get("nonexistent")

    def test_list(self) -> None:
        store = FakeStore()
        repo = JsonDocumentRepository(store, "items", "item_id")
        repo.save({"item_id": "1", "name": "a"})
        repo.save({"item_id": "2", "name": "b"})
        items = repo.list()
        assert len(items) == 2

    def test_list_empty(self) -> None:
        store = FakeStore()
        repo = JsonDocumentRepository(store, "items", "item_id")
        assert repo.list() == []


# ── SkillPackageRepository 测试 ───────────────────────────────

class TestSkillPackageRepository:
    def test_find_by_skill_id(self) -> None:
        store = FakeStore()
        repo = SkillPackageRepository(store)
        repo.save({
            "package_id": "pkg-1",
            "manifest": {"skill_id": "my-skill"},
            "status": "approved",
        })
        results = repo.find_by_skill_id("my-skill")
        assert len(results) == 1
        assert results[0]["package_id"] == "pkg-1"

    def test_find_by_skill_id_empty(self) -> None:
        store = FakeStore()
        repo = SkillPackageRepository(store)
        assert repo.find_by_skill_id("nonexistent") == []

    def test_index_invalidation_on_save(self) -> None:
        store = FakeStore()
        repo = SkillPackageRepository(store)
        repo.save({
            "package_id": "pkg-1",
            "manifest": {"skill_id": "my-skill"},
            "status": "approved",
        })
        # Index should be built
        results = repo.find_by_skill_id("my-skill")
        assert len(results) == 1

        # Save another record - index should be invalidated
        repo.save({
            "package_id": "pkg-2",
            "manifest": {"skill_id": "my-skill"},
            "status": "pending_review",
        })
        results = repo.find_by_skill_id("my-skill")
        assert len(results) == 2

    def test_multiple_versions_same_skill(self) -> None:
        store = FakeStore()
        repo = SkillPackageRepository(store)
        repo.save({
            "package_id": "pkg-1",
            "manifest": {"skill_id": "my-skill@1.0.0"},
            "status": "replaced",
        })
        repo.save({
            "package_id": "pkg-2",
            "manifest": {"skill_id": "my-skill@2.0.0"},
            "status": "approved",
        })
        results = repo.find_by_skill_id("my-skill@1.0.0")
        assert len(results) == 1
        results = repo.find_by_skill_id("my-skill@2.0.0")
        assert len(results) == 1


# ── TaskRepository 测试 ───────────────────────────────────────

class TestTaskRepository:
    def test_find_by_run_id(self) -> None:
        store = FakeStore()
        repo = TaskRepository(store)
        repo.save({
            "task_id": "task-1",
            "run_id": "run-1",
            "status": "completed",
        })
        result = repo.find_by_run_id("run-1")
        assert result is not None
        assert result["task_id"] == "task-1"

    def test_find_by_run_id_empty(self) -> None:
        store = FakeStore()
        repo = TaskRepository(store)
        assert repo.find_by_run_id("nonexistent") is None

    def test_find_by_attempt_run_id(self) -> None:
        store = FakeStore()
        repo = TaskRepository(store)
        repo.save({
            "task_id": "task-1",
            "run_id": "run-main",
            "attempts": [
                {"attempt_index": 1, "run_id": "run-attempt-1"},
                {"attempt_index": 2, "run_id": "run-attempt-2"},
            ],
        })
        result = repo.find_by_run_id("run-attempt-2")
        assert result is not None
        assert result["task_id"] == "task-1"

    def test_index_invalidation_on_save(self) -> None:
        store = FakeStore()
        repo = TaskRepository(store)
        repo.save({"task_id": "task-1", "run_id": "run-1"})
        assert repo.find_by_run_id("run-1") is not None

        # Update the record
        repo.save({"task_id": "task-1", "run_id": "run-1", "status": "completed"})
        result = repo.find_by_run_id("run-1")
        assert result is not None
        assert result["status"] == "completed"


# ── AuditEventRepository 测试 ─────────────────────────────────

class TestAuditEventRepository:
    def test_append_and_list(self) -> None:
        store = FakeStore()
        repo = AuditEventRepository(store)
        repo.append({"event_id": "evt-1", "action": "test"})
        repo.append({"event_id": "evt-2", "action": "test2"})
        events = repo.list()
        assert len(events) == 2

    def test_get_by_id(self) -> None:
        store = FakeStore()
        repo = AuditEventRepository(store)
        repo.append({"event_id": "evt-1", "action": "test"})
        event = repo.get("evt-1")
        assert event["action"] == "test"

    def test_get_missing_raises(self) -> None:
        store = FakeStore()
        repo = AuditEventRepository(store)
        with pytest.raises(KeyError, match="记录不存在"):
            repo.get("nonexistent")


# ── RepositoryRegistry 测试 ───────────────────────────────────

class TestRepositoryRegistry:
    def test_known_collections(self) -> None:
        store = FakeStore()
        registry = RepositoryRegistry(store)
        assert registry.tasks.collection == "tasks"
        assert registry.runs.collection == "runs"
        assert registry.workflows.collection == "workflows"
        assert registry.skill_packages.collection == "skill_packages"

    def test_unknown_collection_fallback(self) -> None:
        store = FakeStore()
        registry = RepositoryRegistry(store)
        repo = registry.collection("unknown", "id")
        assert repo.collection == "unknown"

    def test_known_collection_returns_specific(self) -> None:
        store = FakeStore()
        registry = RepositoryRegistry(store)
        repo = registry.collection("tasks", "task_id")
        assert repo is registry.tasks
