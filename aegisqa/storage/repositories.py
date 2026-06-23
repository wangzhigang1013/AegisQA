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


class SkillPackageRepository(JsonDocumentRepository):
    """skill_packages 集合的 Repository，额外维护 skill_id → 记录 的内存索引。

    `_find_skill_package` 之前每次都 `_list_records` 全量扫盘，在 upload / 合约测试 /
    审批 / 回滚等链路里会被反复调用，记录数大时是明显的 O(n·m) 热点。这里在写入时
    让索引失效、在查找时惰性重建，把按 skill_id 查找的扫描范围从「全部记录」缩小到
    「该 skill_id 下的少数几条历史记录」，行为与全量扫描完全一致。

    父类是 frozen dataclass，这里用 object.__setattr__ 维护可变的索引缓存。
    """

    def __init__(self, store: DocumentStore) -> None:
        super().__init__(store, "skill_packages", "package_id")
        object.__setattr__(self, "_skill_id_index", None)

    def save(self, record: dict[str, Any]) -> dict[str, Any]:
        result = super().save(record)
        # 写入后让索引失效，下次 find_by_skill_id 按最新数据重建。
        object.__setattr__(self, "_skill_id_index", None)
        return result

    def _ensure_index(self) -> dict[str, list[dict[str, Any]]]:
        index = getattr(self, "_skill_id_index", None)
        if index is None:
            index: dict[str, list[dict[str, Any]]] = {}
            for record in self.list():
                skill_id = record.get("manifest", {}).get("skill_id")
                if skill_id:
                    index.setdefault(str(skill_id), []).append(record)
            object.__setattr__(self, "_skill_id_index", index)
        return index

    def find_by_skill_id(self, skill_id: str) -> list[dict[str, Any]]:
        """返回该 skill_id 下的所有历史记录（可能为空列表）。"""
        return list(self._ensure_index().get(skill_id, []))


class TaskRepository(JsonDocumentRepository):
    """tasks 集合的 Repository，额外维护 run_id → 记录 的内存索引。

    `_find_task_by_run_id` 之前全量扫盘，在任务执行、报告生成等链路里会被反复调用。
    这里用与 SkillPackageRepository 相同的惰性索引模式，把按 run_id 查找的扫描范围
    从「全部记录」缩小到「该 run_id 对应的单条任务」，行为与全量扫描完全一致。

    一个 task 可能有多个 attempts，每个 attempt 有独立的 run_id，所以索引值是列表。
    """

    def __init__(self, store: DocumentStore) -> None:
        super().__init__(store, "tasks", "task_id")
        object.__setattr__(self, "_run_id_index", None)

    def save(self, record: dict[str, Any]) -> dict[str, Any]:
        result = super().save(record)
        # 写入后让索引失效，下次 find_by_run_id 按最新数据重建。
        object.__setattr__(self, "_run_id_index", None)
        return result

    def _ensure_index(self) -> dict[str, list[dict[str, Any]]]:
        index = getattr(self, "_run_id_index", None)
        if index is None:
            index: dict[str, list[dict[str, Any]]] = {}
            for record in self.list():
                # 主 run_id
                run_id = record.get("run_id")
                if run_id:
                    index.setdefault(str(run_id), []).append(record)
                # attempts 里的 run_id
                for attempt in record.get("attempts", []):
                    attempt_run_id = attempt.get("run_id")
                    if attempt_run_id:
                        index.setdefault(str(attempt_run_id), []).append(record)
            object.__setattr__(self, "_run_id_index", index)
        return index

    def find_by_run_id(self, run_id: str) -> dict[str, Any] | None:
        """返回该 run_id 对应的任务（可能为 None）。"""
        results = self._ensure_index().get(run_id, [])
        return results[0] if results else None


class RepositoryRegistry:
    """集中暴露当前生产化优先级要求的一组核心 Repository。"""

    def __init__(self, store: DocumentStore) -> None:
        self.store = store
        self.tasks = TaskRepository(store)
        self.runs = JsonDocumentRepository(store, "runs", "run_id")
        self.workflows = JsonDocumentRepository(store, "workflows", "version_id", _safe_workflow_version_id)
        self.skill_packages = SkillPackageRepository(store)
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
