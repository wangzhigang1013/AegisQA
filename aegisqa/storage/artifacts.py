from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class ArtifactStore(ABC):
    @abstractmethod
    def put_bytes(self, key: str, content: bytes, *, content_type: str = "application/octet-stream") -> str:
        """Persist bytes and return an artifact URI."""

    @abstractmethod
    def get_bytes(self, uri: str) -> bytes:
        """Read artifact bytes by URI."""

    @abstractmethod
    def describe(self, uri: str) -> dict[str, Any]:
        """Return artifact metadata."""


class LocalArtifactStore(ArtifactStore):
    scheme = "local://"

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put_bytes(self, key: str, content: bytes, *, content_type: str = "application/octet-stream") -> str:
        path = self._resolve_key(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        meta_path = path.with_suffix(path.suffix + ".meta.json")
        meta_path.write_text(
            json.dumps({"content_type": content_type, "size": len(content), "key": key}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        uri_key = key.replace("\\", "/")
        return f"{self.scheme}{uri_key}"

    def put_json(self, key: str, payload: Any) -> str:
        content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        return self.put_bytes(key, content, content_type="application/json")

    def get_bytes(self, uri: str) -> bytes:
        return self._resolve_uri(uri).read_bytes()

    def get_json(self, uri: str) -> Any:
        return json.loads(self.get_bytes(uri).decode("utf-8"))

    def describe(self, uri: str) -> dict[str, Any]:
        path = self._resolve_uri(uri)
        meta_path = path.with_suffix(path.suffix + ".meta.json")
        if meta_path.exists():
            return json.loads(meta_path.read_text(encoding="utf-8"))
        return {"content_type": "application/octet-stream", "size": path.stat().st_size, "key": self._key_from_uri(uri)}

    def _resolve_key(self, key: str) -> Path:
        normalised = key.replace("\\", "/").lstrip("/")
        if ".." in Path(normalised).parts:
            raise ValueError("ARTIFACT_PATH_INVALID: path traversal is not allowed")
        path = (self.root / normalised).resolve()
        if self.root != path and self.root not in path.parents:
            raise ValueError("ARTIFACT_PATH_INVALID: path escapes artifact root")
        return path

    def _resolve_uri(self, uri: str) -> Path:
        return self._resolve_key(self._key_from_uri(uri))

    def _key_from_uri(self, uri: str) -> str:
        if not uri.startswith(self.scheme):
            raise ValueError("ARTIFACT_URI_INVALID: unsupported artifact URI")
        return uri.removeprefix(self.scheme)
