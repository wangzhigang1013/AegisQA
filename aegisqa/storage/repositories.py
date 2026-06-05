"""核心业务对象 Repository 抽象。

JsonStore 和 SQLiteStore 已经共享 `read_json/write_json/list_json` 等最小能力。
本模块在其上提供面向业务集合的 repository facade，让路由和服务逐步从“拼路径读写”
迁移到“按业务对象读写”，后续 MySQL adapter 只需要实现相同契约。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Protocol


class DocumentStore(Protocol):
    """JsonStore / SQLiteStore 共同实现的最小文档存储协议。"""

    def write_json(self, parts: Iterable[str], payload: Any) -> Any: ...

    def read_json(self, parts: Iterable[str], default: Any | None = None) -> Any: ...

    def list_json(self, prefix: Iterable[str], *, recursive: bool = False) -> list[dict[str, Any]]: ...

    def append_jsonl(self, parts: Iterable[str], row: dict[str, Any]) -> None: ...

    def iter_jsonl(self, parts: Iterable[str]) -> Iterable[dict[str, Any]]: ...


FilenameFactory = Callable[[str], str]


@dataclass(frozen=True)
class JsonDocumentRepository:
    """基于 JSON 文档集合的通用 Repository。"""

    store: DocumentStore
    collection: str
    id_key: str
    filename_factory: FilenameFactory = str

    def save(self, record: dict[str, Any]) -> dict[str, Any]:
        record_id = str(record[self.id_key])
        self.store.write_json([self.collection, f"{self.filename_factory(record_id)}.json"], record)
        return record

    def get(self, record_id: str) -> dict[str, Any]:
        payload = self.store.read_json([self.collection, f"{self.filename_factory(str(record_id))}.json"])
        if not payload:
            raise KeyError(f"{self.collection} 记录不存在：{record_id}")
        return payload

    def list(self) -> list[dict[str, Any]]:
        return self.store.list_json([self.collection])


@dataclass(frozen=True)
class AuditEventRepository:
    """审计事件目前是 append-only JSONL，单独封装以保留事件流语义。"""

    store: DocumentStore
    stream_parts: tuple[str, str] = ("audit", "events.jsonl")

    def append(self, event: dict[str, Any]) -> dict[str, Any]:
        self.store.append_jsonl(self.stream_parts, event)
        return event

    def get(self, event_id: str) -> dict[str, Any]:
        for event in self.list():
            if event.get("event_id") == event_id:
                return event
        raise KeyError(f"audit_events 记录不存在：{event_id}")

    def list(self) -> list[dict[str, Any]]:
        return list(self.store.iter_jsonl(self.stream_parts))


class RepositoryRegistry:
    """集中暴露当前生产化优先级要求的一组核心 Repository。"""

    def __init__(self, store: DocumentStore) -> None:
        self.store = store
        self.tasks = JsonDocumentRepository(store, "tasks", "task_id")
        self.runs = JsonDocumentRepository(store, "runs", "run_id")
        self.workflows = JsonDocumentRepository(store, "workflows", "version_id", _safe_workflow_version_id)
        self.skill_packages = JsonDocumentRepository(store, "skill_packages", "package_id")
        self.audit_events = AuditEventRepository(store)

    def collection(self, collection: str, id_key: str) -> JsonDocumentRepository:
        """为尚未显式建模的集合提供过渡 repository。"""

        known = {
            ("tasks", "task_id"): self.tasks,
            ("runs", "run_id"): self.runs,
            ("workflows", "version_id"): self.workflows,
            ("skill_packages", "package_id"): self.skill_packages,
        }
        return known.get((collection, id_key), JsonDocumentRepository(self.store, collection, id_key))


def _safe_workflow_version_id(value: str) -> str:
    return value.replace(":", "_").replace("/", "_")
