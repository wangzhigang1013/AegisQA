"""MySQL 文档仓储适配器。

该适配器先保持 JsonStore/SQLiteStore 的最小接口，保证现有服务不用大改；
同时把 Task、Run、Workflow、AuditEvent 镜像到 MySQL 核心表，作为后续
Repository 深化和报表查询下推的第一步。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import queue
import threading
import time
from typing import Any, Callable, Iterable, Iterator

logger = logging.getLogger(__name__)

ConnectionFactory = Callable[[], Any]
MYSQL_JSONL_LOCK_TIMEOUT_SECONDS = 10

# 连接池配置
POOL_MIN_SIZE = int(os.getenv("AEGISQA_MYSQL_POOL_MIN_SIZE", "2"))
POOL_MAX_SIZE = int(os.getenv("AEGISQA_MYSQL_POOL_MAX_SIZE", "10"))
POOL_MAX_IDLE_SECONDS = int(os.getenv("AEGISQA_MYSQL_POOL_MAX_IDLE", "300"))  # 5 minutes


class ConnectionPool:
    """线程安全的 MySQL 连接池。"""

    def __init__(self, factory: ConnectionFactory, min_size: int = 2, max_size: int = 10, max_idle_seconds: int = 300) -> None:
        self._factory = factory
        self._min_size = min_size
        self._max_size = max_size
        self._max_idle_seconds = max_idle_seconds
        self._pool: queue.Queue[tuple[Any, float]] = queue.Queue(maxsize=max_size)
        self._lock = threading.Lock()
        self._size = 0
        self._closed = False

        # 预创建最小连接数
        for _ in range(min_size):
            try:
                conn = self._create_connection()
                self._pool.put((conn, time.time()))
                self._size += 1
            except Exception as exc:
                logger.warning("Failed to pre-create MySQL connection: %s", exc)

    def _create_connection(self) -> Any:
        """创建新连接。"""
        conn = self._factory()
        # 设置连接超时
        if hasattr(conn, "ping"):
            try:
                conn.ping(reconnect=True)
            except Exception:
                pass
        return conn

    def acquire(self) -> Any:
        """获取连接。"""
        if self._closed:
            raise RuntimeError("Connection pool is closed")

        # 尝试从池中获取
        try:
            conn, created_at = self._pool.get_nowait()
            # 检查连接是否过期
            if time.time() - created_at > self._max_idle_seconds:
                try:
                    conn.close()
                except Exception:
                    pass
                with self._lock:
                    self._size -= 1
                return self.acquire()
            return conn
        except queue.Empty:
            pass

        # 池为空，尝试创建新连接
        with self._lock:
            if self._size < self._max_size:
                conn = self._create_connection()
                self._size += 1
                return conn

        # 池已满，等待连接释放
        try:
            conn, created_at = self._pool.get(timeout=30)
            return conn
        except queue.Empty:
            raise RuntimeError("Connection pool timeout: no available connections")

    def release(self, conn: Any) -> None:
        """释放连接回池。"""
        if self._closed:
            try:
                conn.close()
            except Exception:
                pass
            return

        try:
            self._pool.put_nowait((conn, time.time()))
        except queue.Full:
            try:
                conn.close()
            except Exception:
                pass
            with self._lock:
                self._size -= 1

    def close_all(self) -> None:
        """关闭所有连接。"""
        self._closed = True
        while not self._pool.empty():
            try:
                conn, _ = self._pool.get_nowait()
                conn.close()
            except Exception:
                pass
        self._size = 0


class MySQLStore:
    """面向 MySQL 的 JSON 文档与审计事件流仓储封装。"""

    backend = "mysql"

    def __init__(
        self,
        root: Path | str,
        *,
        connection_factory: ConnectionFactory | None = None,
        schema_path: Path | str | None = None,
        initialize_schema: bool = True,
    ) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.connection_factory = connection_factory or _mysql_connection_factory_from_env
        self.schema_path = Path(schema_path) if schema_path else _default_schema_path()
        # 初始化连接池
        self._pool = ConnectionPool(
            factory=self.connection_factory,
            min_size=POOL_MIN_SIZE,
            max_size=POOL_MAX_SIZE,
            max_idle_seconds=POOL_MAX_IDLE_SECONDS,
        )
        if initialize_schema:
            self._init_schema()

    def path(self, *parts: str) -> Path:
        # Dataset rows、上传 zip 等大对象仍走文件系统，MySQL 只承载元数据与审计事件。
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_json(self, parts: Iterable[str], payload: Any) -> Path:
        key = _key(parts)
        collection = key.split("/", 1)[0] if key else ""
        raw = _dumps(payload)
        now = _now()
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    insert into json_documents(document_key, collection, payload_json, updated_at)
                    values (%s, %s, %s, %s)
                    on duplicate key update
                      collection = values(collection),
                      payload_json = values(payload_json),
                      updated_at = values(updated_at)
                    """,
                    (key, collection, raw, now),
                )
                if isinstance(payload, dict):
                    self._mirror_core_document(cursor, collection, payload, raw, now)
        return self.path(*key.split("/"))

    def read_json(self, parts: Iterable[str], default: Any | None = None) -> Any:
        key = _key(parts)
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("select payload_json from json_documents where document_key = %s", (key,))
                row = cursor.fetchone()
        if row:
            return _loads(_row_value(row, "payload_json"))

        legacy_path = self.root.joinpath(*key.split("/"))
        if legacy_path.exists():
            return json.loads(legacy_path.read_text(encoding="utf-8"))
        return default

    def write_jsonl(self, parts: Iterable[str], rows: Iterable[dict[str, Any]]) -> Path:
        key = _key(parts)
        now = _now()
        serialized_rows = [(key, index, _dumps(row), now) for index, row in enumerate(rows)]
        with self._connection() as conn:
            with conn.cursor() as cursor:
                with self._jsonl_stream_lock(cursor, key):
                    cursor.execute("delete from jsonl_rows where stream_key = %s", (key,))
                    if serialized_rows:
                        cursor.executemany(
                            "insert into jsonl_rows(stream_key, row_index, payload_json, created_at) values (%s, %s, %s, %s)",
                            serialized_rows,
                        )
                    if key == "audit/events.jsonl":
                        for _, _, raw, _ in serialized_rows:
                            event = _loads(raw)
                            if isinstance(event, dict):
                                self._mirror_audit_event(cursor, event)
        return self.path(*key.split("/"))

    def append_jsonl(self, parts: Iterable[str], row: dict[str, Any]) -> None:
        key = _key(parts)
        raw = _dumps(row)
        with self._connection() as conn:
            with conn.cursor() as cursor:
                with self._jsonl_stream_lock(cursor, key):
                    cursor.execute(
                        "select coalesce(max(row_index), -1) + 1 as next_index from jsonl_rows where stream_key = %s",
                        (key,),
                    )
                    next_row = cursor.fetchone()
                    next_index = int(_row_value(next_row, "next_index", 0) or 0)
                    cursor.execute(
                        "insert into jsonl_rows(stream_key, row_index, payload_json, created_at) values (%s, %s, %s, %s)",
                        (key, next_index, raw, _now()),
                    )
                    if key == "audit/events.jsonl":
                        self._mirror_audit_event(cursor, row)

    def iter_jsonl(self, parts: Iterable[str]) -> Iterator[dict[str, Any]]:
        key = _key(parts)
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "select payload_json from jsonl_rows where stream_key = %s order by row_index asc",
                    (key,),
                )
                rows = cursor.fetchall()
        if rows:
            yield from (_loads(_row_value(row, "payload_json")) for row in rows)
            return

        legacy_path = self.root.joinpath(*key.split("/"))
        if not legacy_path.exists():
            return
        for line in legacy_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                yield json.loads(line)

    def list_json(self, prefix: Iterable[str], *, recursive: bool = False) -> list[dict[str, Any]]:
        prefix_key = _key(prefix).strip("/")
        match_prefix = f"{prefix_key}/" if prefix_key else ""
        with self._connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    select document_key, payload_json, updated_at
                    from json_documents
                    where document_key like %s
                    order by updated_at desc
                    """,
                    (f"{match_prefix}%.json",),
                )
                rows = cursor.fetchall()

        records_by_key: dict[str, tuple[str, dict[str, Any]]] = {}
        for row in rows:
            key = str(_row_value(row, "document_key"))
            relative = key[len(match_prefix) :]
            if not recursive and "/" in relative:
                continue
            records_by_key[key] = (str(_row_value(row, "updated_at", "")), _loads(_row_value(row, "payload_json")))

        legacy_root = self.root.joinpath(*prefix_key.split("/")) if prefix_key else self.root
        if legacy_root.exists():
            pattern = "**/*.json" if recursive else "*.json"
            for path in legacy_root.glob(pattern):
                key = path.relative_to(self.root).as_posix()
                if key in records_by_key:
                    continue
                records_by_key[key] = (datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(), json.loads(path.read_text(encoding="utf-8")))

        return [payload for _, payload in sorted(records_by_key.values(), key=lambda item: item[0], reverse=True)]

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        """获取数据库连接（从连接池）。"""
        conn = self._pool.acquire()
        try:
            yield conn
            conn.commit()
        except Exception:
            rollback = getattr(conn, "rollback", None)
            if callable(rollback):
                rollback()
            raise
        finally:
            self._pool.release(conn)

    def _init_schema(self) -> None:
        with self._connection() as conn:
            with conn.cursor() as cursor:
                if self.schema_path.exists():
                    for statement in _split_sql_statements(self.schema_path.read_text(encoding="utf-8")):
                        cursor.execute(statement)
                # 通用文档表保存完整 JSON，是现有服务兼容层；核心表用于生产查询演进。
                cursor.execute(
                    """
                    create table if not exists json_documents (
                      document_key varchar(512) primary key,
                      collection varchar(191) not null,
                      payload_json json not null,
                      updated_at timestamp not null,
                      key idx_json_documents_collection (collection),
                      key idx_json_documents_updated_at (updated_at)
                    )
                    """
                )
                cursor.execute(
                    """
                    create table if not exists jsonl_rows (
                      stream_key varchar(512) not null,
                      row_index int not null,
                      payload_json json not null,
                      created_at timestamp not null,
                      primary key (stream_key, row_index)
                    )
                    """
                )

    @contextmanager
    def _jsonl_stream_lock(self, cursor: Any, key: str) -> Iterator[None]:
        """用 MySQL named lock 串行化单个 JSONL stream 的 row_index 分配。

        `append_jsonl()` 需要先读取当前最大 row_index 再插入下一行；如果两个
        API 请求并发执行，默认事务隔离下它们可能同时读到相同的 next index。
        named lock 按 stream_key 维度加锁，既避免并发 append 撞主键，也避免
        `write_jsonl()` 的覆盖写和 append 在同一 stream 上交错。
        """

        lock_name = _jsonl_lock_name(key)
        self._acquire_jsonl_lock(cursor, lock_name)
        try:
            yield
        finally:
            self._release_jsonl_lock(cursor, lock_name)

    def _acquire_jsonl_lock(self, cursor: Any, lock_name: str) -> None:
        cursor.execute("select get_lock(%s, %s) as lock_acquired", (lock_name, MYSQL_JSONL_LOCK_TIMEOUT_SECONDS))
        row = cursor.fetchone()
        if int(_row_value(row, "lock_acquired", 0) or 0) != 1:
            raise RuntimeError(f"MySQL JSONL stream lock 获取失败：{lock_name}")

    def _release_jsonl_lock(self, cursor: Any, lock_name: str) -> None:
        cursor.execute("select release_lock(%s) as lock_released", (lock_name,))

    def _mirror_core_document(self, cursor: Any, collection: str, payload: dict[str, Any], raw: str, now: str) -> None:
        if collection == "tasks" and payload.get("task_id"):
            cursor.execute(
                """
                insert into tasks(task_id, name, status, dataset_version_id, workflow_version_id, run_id, task_json, created_at, updated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on duplicate key update
                  name = values(name),
                  status = values(status),
                  dataset_version_id = values(dataset_version_id),
                  workflow_version_id = values(workflow_version_id),
                  run_id = values(run_id),
                  task_json = values(task_json),
                  updated_at = values(updated_at)
                """,
                (
                    payload["task_id"],
                    payload.get("name") or payload["task_id"],
                    payload.get("status") or "unknown",
                    payload.get("dataset_version_id") or _dataset_version_id(payload),
                    payload.get("workflow_version_id") or "",
                    payload.get("run_id"),
                    raw,
                    _timestamp(payload.get("created_at"), now),
                    _timestamp(payload.get("updated_at"), now),
                ),
            )
            return
        if collection == "runs" and payload.get("run_id"):
            workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
            cursor.execute(
                """
                insert into runs(run_id, workflow_version_id, dataset_version_id, status, snapshot_json, run_json, created_at, started_at, finished_at, updated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on duplicate key update
                  workflow_version_id = values(workflow_version_id),
                  dataset_version_id = values(dataset_version_id),
                  status = values(status),
                  snapshot_json = values(snapshot_json),
                  run_json = values(run_json),
                  started_at = values(started_at),
                  finished_at = values(finished_at),
                  updated_at = values(updated_at)
                """,
                (
                    payload["run_id"],
                    workflow.get("version_id") or (payload.get("snapshot") or {}).get("workflow_version") or "",
                    _dataset_version_id(payload),
                    payload.get("status") or "unknown",
                    _dumps(payload.get("snapshot") or {}),
                    raw,
                    _timestamp(payload.get("created_at"), now),
                    _timestamp(payload.get("started_at")),
                    _timestamp(payload.get("finished_at")),
                    now,
                ),
            )
            return
        if collection == "workflows" and payload.get("version_id"):
            cursor.execute(
                """
                insert into workflow_versions(version_id, workflow_id, name, version, status, snapshot_hash, workflow_json, published_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                on duplicate key update
                  workflow_id = values(workflow_id),
                  name = values(name),
                  version = values(version),
                  status = values(status),
                  snapshot_hash = values(snapshot_hash),
                  workflow_json = values(workflow_json),
                  published_at = values(published_at)
                """,
                (
                    payload["version_id"],
                    payload.get("workflow_id") or str(payload["version_id"]).split(":")[0],
                    payload.get("name") or payload["version_id"],
                    int(payload.get("version") or 1),
                    payload.get("status") or "published",
                    payload.get("snapshot_hash") or "",
                    raw,
                    _timestamp(payload.get("published_at")),
                ),
            )

    def _mirror_audit_event(self, cursor: Any, event: dict[str, Any]) -> None:
        if not event.get("event_id"):
            return
        cursor.execute(
            """
            insert into audit_events(event_id, actor, role, action, target, result, trace_id, detail_json, created_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            on duplicate key update
              actor = values(actor),
              role = values(role),
              action = values(action),
              target = values(target),
              result = values(result),
              trace_id = values(trace_id),
              detail_json = values(detail_json),
              created_at = values(created_at)
            """,
            (
                event["event_id"],
                event.get("actor") or "api",
                event.get("role") or event.get("actor") or "System",
                event.get("action") or "unknown",
                event.get("target") or "",
                event.get("result") or "success",
                event.get("trace_id") or "",
                _dumps(event.get("detail") or {}),
                _timestamp(event.get("created_at"), _now()),
            ),
        )


def _mysql_connection_factory_from_env() -> Any:
    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except ImportError as exc:  # pragma: no cover - 只有未安装生产依赖时触发。
        raise RuntimeError("MySQL 存储后端需要安装 pymysql：pip install pymysql") from exc

    return pymysql.connect(
        host=os.getenv("AEGISQA_MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("AEGISQA_MYSQL_PORT", "3306")),
        user=os.getenv("AEGISQA_MYSQL_USER", "aegisqa"),
        password=os.getenv("AEGISQA_MYSQL_PASSWORD", "aegisqa_password"),
        database=os.getenv("AEGISQA_MYSQL_DATABASE", "aegisqa"),
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=False,
    )


def _default_schema_path() -> Path:
    return Path(__file__).resolve().parents[2] / "infra" / "mysql" / "schema.sql"


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    for char in sql:
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        if char == ";" and not in_single and not in_double:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            continue
        current.append(char)
    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def _key(parts: Iterable[str]) -> str:
    return "/".join(str(part).replace("\\", "/").strip("/") for part in parts if str(part).strip("/"))


def _jsonl_lock_name(key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]
    return f"aegisqa:jsonl:{digest}"


def _dataset_version_id(payload: dict[str, Any]) -> str:
    if payload.get("dataset_version_id"):
        return str(payload["dataset_version_id"])
    snapshot = payload.get("snapshot") if isinstance(payload.get("snapshot"), dict) else {}
    if snapshot.get("dataset_version"):
        return str(snapshot["dataset_version"])
    dataset_id = payload.get("dataset_id")
    dataset_version = payload.get("dataset_version")
    if dataset_id is not None and dataset_version is not None:
        return f"{dataset_id}:v{dataset_version}"
    return ""


def _row_value(row: Any, key: str, default: Any | None = None) -> Any:
    if row is None:
        return default
    if isinstance(row, dict):
        return row.get(key, default)
    try:
        return getattr(row, key)
    except AttributeError:
        return default


def _loads(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    return json.loads(str(value))


def _dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)


def _timestamp(value: Any, fallback: str | None = None) -> str | None:
    if value is None or value == "":
        return fallback
    text = str(value).replace("T", " ").replace("Z", "")
    if text.endswith("+00:00"):
        text = text[:-6]
    return text


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
