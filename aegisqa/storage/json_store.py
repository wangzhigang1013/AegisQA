"""本地 JSON 文件仓储。

MVP 为了便于面试演示和本地运行，默认使用文件存储承载元数据与执行快照。
接口刻意做得很薄，后续替换成 MySQL/PostgreSQL 时，上层服务不需要重写业务逻辑。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable, Iterator
from uuid import uuid4

from aegisqa.storage.file_lock import FileLock


class JsonStore:
    """面向 JSON/JSONL 的最小仓储封装。"""

    dev_only = True
    production_replacement = "PostgreSQL/MySQL metadata store + ArtifactStore"

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, *parts: str) -> Path:
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_json(self, parts: Iterable[str], payload: Any) -> Path:
        path = self.path(*parts)
        with FileLock(self._lock_path(path)):
            self._atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2))
        return path

    def read_json(self, parts: Iterable[str], default: Any | None = None) -> Any:
        path = self.path(*parts)
        with FileLock(self._lock_path(path)):
            if not path.exists():
                return default
            return json.loads(path.read_text(encoding="utf-8"))

    def write_jsonl(self, parts: Iterable[str], rows: Iterable[dict[str, Any]]) -> Path:
        path = self.path(*parts)
        content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        with FileLock(self._lock_path(path)):
            self._atomic_write_text(path, content)
        return path

    def append_jsonl(self, parts: Iterable[str], row: dict[str, Any]) -> None:
        path = self.path(*parts)
        with FileLock(self._lock_path(path)):
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def iter_jsonl(self, parts: Iterable[str]) -> Iterator[dict[str, Any]]:
        path = self.path(*parts)
        with FileLock(self._lock_path(path)):
            if not path.exists():
                rows: list[dict[str, Any]] = []
            else:
                rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        yield from rows

    def list_json(self, prefix: Iterable[str], *, recursive: bool = False) -> list[dict[str, Any]]:
        """按目录前缀列出 JSON 文档。

        过去上层服务直接扫描 `store.root`，这会把业务逻辑绑死在文件系统上。
        新增该方法后，JsonStore 和 SQLiteStore 可以共享同一套列表语义。
        """

        root = self.root.joinpath(*prefix)
        if not root.exists():
            return []
        pattern = "**/*.json" if recursive else "*.json"
        paths = sorted(root.glob(pattern), key=lambda item: item.stat().st_mtime, reverse=True)
        records: list[dict[str, Any]] = []
        for path in paths:
            if path.name.endswith(".lock"):
                continue
            records.append(json.loads(path.read_text(encoding="utf-8")))
        return records

    def _lock_path(self, path: Path) -> Path:
        return path.with_name(f"{path.name}.lock")

    def _atomic_write_text(self, path: Path, content: str) -> None:
        # 先写临时文件再 os.replace，读者要么看到旧完整文件，要么看到新完整文件。
        temp_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            temp_path.write_text(content, encoding="utf-8")
            os.replace(temp_path, path)
        finally:
            if temp_path.exists():
                temp_path.unlink()
