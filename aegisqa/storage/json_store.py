"""本地 JSON 文件仓储。

MVP 为了便于面试演示和本地运行，默认使用文件存储承载元数据与执行快照。
接口刻意做得很薄，后续替换成 MySQL/PostgreSQL 时，上层服务不需要重写业务逻辑。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Iterator


class JsonStore:
    """面向 JSON/JSONL 的最小仓储封装。"""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, *parts: str) -> Path:
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_json(self, parts: Iterable[str], payload: Any) -> Path:
        path = self.path(*parts)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def read_json(self, parts: Iterable[str], default: Any | None = None) -> Any:
        path = self.path(*parts)
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

    def write_jsonl(self, parts: Iterable[str], rows: Iterable[dict[str, Any]]) -> Path:
        path = self.path(*parts)
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return path

    def append_jsonl(self, parts: Iterable[str], row: dict[str, Any]) -> None:
        path = self.path(*parts)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def iter_jsonl(self, parts: Iterable[str]) -> Iterator[dict[str, Any]]:
        path = self.path(*parts)
        if not path.exists():
            return
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)

