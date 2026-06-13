"""SQLite 轻量元数据仓储。

SQLiteStore 与 JsonStore 保持同一组最小接口：JSON 文档进入 SQLite，
JSONL 事件流进入 SQLite；Dataset rows、上传文件、插件包仍通过 `path()`
保留在本地文件系统。这样可以先获得轻量数据库的查询和一致性基础，同时避免
把大样本行和 zip 包塞进数据库影响流式评测。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable, Iterator


class SQLiteStore:
    """面向 JSON/JSONL 的 SQLite 仓储封装。"""

    def __init__(self, root: Path | str, *, db_name: str = "aegisqa.sqlite3") -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / db_name
        self._init_schema()

    def path(self, *parts: str) -> Path:
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_json(self, parts: Iterable[str], payload: Any) -> Path:
        key = _key(parts)
        raw = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
        with self._connection() as conn:
            conn.execute(
                """
                insert into json_documents(key, payload, updated_at)
                values (?, ?, ?)
                on conflict(key) do update set payload=excluded.payload, updated_at=excluded.updated_at
                """,
                (key, raw, _now()),
            )
        return self.path(*key.split("/"))

    def read_json(self, parts: Iterable[str], default: Any | None = None) -> Any:
        key = _key(parts)
        with self._connection() as conn:
            row = conn.execute("select payload from json_documents where key = ?", (key,)).fetchone()
        if row:
            return json.loads(row["payload"])

        # 渐进迁移：如果目录里已有 JsonStore 时代的文件，SQLiteStore 可以直接读，
        # 方便用户先切换后端，再逐步把热数据写入 SQLite。
        legacy_path = self.root.joinpath(*key.split("/"))
        if legacy_path.exists():
            return json.loads(legacy_path.read_text(encoding="utf-8"))
        return default

    def write_jsonl(self, parts: Iterable[str], rows: Iterable[dict[str, Any]]) -> Path:
        key = _key(parts)
        with self._connection() as conn:
            # 覆盖写入和 append 共享同一个 stream_key；先拿写锁，避免并发 append
            # 在删除与批量插入之间插入旧流，造成审计事件顺序错乱。
            conn.execute("begin immediate")
            conn.execute("delete from jsonl_rows where stream_key = ?", (key,))
            conn.executemany(
                "insert into jsonl_rows(stream_key, row_index, payload, created_at) values (?, ?, ?, ?)",
                [
                    (key, index, json.dumps(row, ensure_ascii=False, default=str), _now())
                    for index, row in enumerate(rows)
                ],
            )
        return self.path(*key.split("/"))

    def append_jsonl(self, parts: Iterable[str], row: dict[str, Any]) -> None:
        key = _key(parts)
        with self._connection() as conn:
            # SQLite 的默认 deferred 事务会让并发写入先同时读到相同 max(row_index)，
            # 再在 insert 时撞主键。BEGIN IMMEDIATE 让 row_index 分配和 insert 成为
            # 串行临界区，保证审计事件流在轻量 SQLite 模式下不丢事件。
            conn.execute("begin immediate")
            next_index = conn.execute("select coalesce(max(row_index), -1) + 1 from jsonl_rows where stream_key = ?", (key,)).fetchone()[0]
            conn.execute(
                "insert into jsonl_rows(stream_key, row_index, payload, created_at) values (?, ?, ?, ?)",
                (key, next_index, json.dumps(row, ensure_ascii=False, default=str), _now()),
            )

    def iter_jsonl(self, parts: Iterable[str]) -> Iterator[dict[str, Any]]:
        key = _key(parts)
        with self._connection() as conn:
            rows = conn.execute(
                "select payload from jsonl_rows where stream_key = ? order by row_index asc",
                (key,),
            ).fetchall()
        if rows:
            yield from (json.loads(row["payload"]) for row in rows)
            return

        # Dataset rows 仍由 DatasetService 通过 `path()` 流式写入文件；这里保留文件
        # 回退，避免 SQLite 模式破坏大数据集按需读取。
        legacy_path = self.root.joinpath(*key.split("/"))
        if not legacy_path.exists():
            return
        for line in legacy_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                yield json.loads(line)

    def delete_json(self, parts: Iterable[str]) -> bool:
        """删除指定 key 的 JSON 文档。返回是否存在并被删除。"""
        key = _key(parts)
        with self._connection() as conn:
            cursor = conn.execute("delete from json_documents where key = ?", (key,))
            return cursor.rowcount > 0

    def delete_jsonl(self, parts: Iterable[str]) -> None:
        """删除指定 stream 的所有 JSONL 行。"""
        key = _key(parts)
        with self._connection() as conn:
            conn.execute("delete from jsonl_rows where stream_key = ?", (key,))

    def list_jsonl_keys(self, prefix: Iterable[str]) -> list[str]:
        """列出指定前缀下的所有 JSONL stream key。"""
        prefix_key = _key(prefix).strip("/")
        match_prefix = f"{prefix_key}/" if prefix_key else ""
        with self._connection() as conn:
            rows = conn.execute(
                "select distinct stream_key from jsonl_rows where stream_key like ? order by stream_key",
                (f"{match_prefix}%",),
            ).fetchall()
        return [row["stream_key"] for row in rows]

    def count_jsonl(self, parts: Iterable[str]) -> int:
        """统计指定 stream 的 JSONL 行数。"""
        key = _key(parts)
        with self._connection() as conn:
            row = conn.execute("select count(*) as cnt from jsonl_rows where stream_key = ?", (key,)).fetchone()
        return row["cnt"] if row else 0

    def list_json(self, prefix: Iterable[str], *, recursive: bool = False) -> list[dict[str, Any]]:
        prefix_key = _key(prefix).strip("/")
        match_prefix = f"{prefix_key}/" if prefix_key else ""
        with self._connection() as conn:
            rows = conn.execute(
                "select key, payload, updated_at from json_documents where key like ? order by updated_at desc",
                (f"{match_prefix}%.json",),
            ).fetchall()

        records_by_key: dict[str, tuple[str, dict[str, Any]]] = {}
        for row in rows:
            key = row["key"]
            relative = key[len(match_prefix) :]
            if not recursive and "/" in relative:
                continue
            records_by_key[key] = (row["updated_at"], json.loads(row["payload"]))

        legacy_root = self.root.joinpath(*prefix_key.split("/")) if prefix_key else self.root
        if legacy_root.exists():
            pattern = "**/*.json" if recursive else "*.json"
            for path in legacy_root.glob(pattern):
                key = path.relative_to(self.root).as_posix()
                if key in records_by_key:
                    continue
                records_by_key[key] = (datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(), json.loads(path.read_text(encoding="utf-8")))

        return [payload for _, payload in sorted(records_by_key.values(), key=lambda item: item[0], reverse=True)]

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma journal_mode = wal")
        conn.execute("pragma busy_timeout = 5000")
        return conn

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                create table if not exists json_documents (
                    key text primary key,
                    payload text not null,
                    updated_at text not null
                )
                """
            )
            conn.execute("create index if not exists idx_json_documents_updated_at on json_documents(updated_at)")
            conn.execute(
                """
                create table if not exists jsonl_rows (
                    stream_key text not null,
                    row_index integer not null,
                    payload text not null,
                    created_at text not null,
                    primary key (stream_key, row_index)
                )
                """
            )


def _key(parts: Iterable[str]) -> str:
    return "/".join(str(part).replace("\\", "/").strip("/") for part in parts if str(part).strip("/"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
