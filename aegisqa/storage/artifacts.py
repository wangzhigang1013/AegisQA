"""运行产物存储接口与本地实现。"""

from __future__ import annotations

import hashlib
import json
import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from aegisqa.core.time import now_beijing_str, now_beijing
from pathlib import Path, PurePosixPath
from typing import Any


DEFAULT_ARTIFACT_KINDS = {
    "uploaded_datasets",
    "skill_packages",
    "rendered_prompts",
    "raw_llm_responses",
    "reports",
    "repro_bundles",
}
DEFAULT_MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
_WINDOWS_DRIVE_PATTERN = re.compile(r"^[a-zA-Z]:")


class ArtifactStoreError(ValueError):
    """ArtifactStore 的可结构化错误，便于 API/Worker 统一转换。"""

    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class ArtifactMetadata:
    kind: str
    artifact_id: str
    size_bytes: int
    sha256: str
    content_type: str | None
    storage_path: str
    metadata: dict[str, Any]
    created_at: str


class ArtifactStore(ABC):
    """承载可回放、可审计产物的存储接口。"""

    @abstractmethod
    def put_bytes(
        self,
        kind: str,
        artifact_id: str,
        payload: bytes,
        *,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactMetadata:
        """保存二进制产物并返回不可变元数据。"""

    @abstractmethod
    def read_bytes(self, kind: str, artifact_id: str) -> bytes:
        """读取已保存的产物内容。"""

    @abstractmethod
    def get_metadata(self, kind: str, artifact_id: str) -> ArtifactMetadata:
        """读取产物元数据。"""


class LocalArtifactStore(ArtifactStore):
    """本地文件系统 ArtifactStore。

    本实现面向本地试用和单机部署。所有路径先按白名单 kind 与相对 artifact_id
    解析，再用 `resolve` 确认最终位置仍在 root 内，避免路径穿越和符号链接逃逸。
    """

    def __init__(
        self,
        root: Path | str,
        *,
        max_artifact_bytes: int = DEFAULT_MAX_ARTIFACT_BYTES,
        allowed_kinds: set[str] | None = None,
    ) -> None:
        self.root = Path(root).resolve()
        self.max_artifact_bytes = max(1, int(max_artifact_bytes))
        self.allowed_kinds = allowed_kinds or set(DEFAULT_ARTIFACT_KINDS)
        self.root.mkdir(parents=True, exist_ok=True)

    def put_bytes(
        self,
        kind: str,
        artifact_id: str,
        payload: bytes,
        *,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactMetadata:
        if len(payload) > self.max_artifact_bytes:
            raise ArtifactStoreError(
                "ARTIFACT_TOO_LARGE",
                "产物超过本地 ArtifactStore 大小限制。",
                details={"size_bytes": len(payload), "max_artifact_bytes": self.max_artifact_bytes},
            )
        path = self._resolve_path(kind, artifact_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        artifact_metadata = ArtifactMetadata(
            kind=kind,
            artifact_id=self._normalize_artifact_id(artifact_id),
            size_bytes=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            content_type=content_type,
            storage_path=self._relative_storage_path(path),
            metadata=dict(metadata or {}),
            created_at=now_beijing_str(),
        )
        self._metadata_path(path).write_text(json.dumps(asdict(artifact_metadata), ensure_ascii=False, indent=2), encoding="utf-8")
        return artifact_metadata

    def read_bytes(self, kind: str, artifact_id: str) -> bytes:
        path = self._resolve_path(kind, artifact_id)
        return path.read_bytes()

    def get_metadata(self, kind: str, artifact_id: str) -> ArtifactMetadata:
        path = self._resolve_path(kind, artifact_id)
        payload = json.loads(self._metadata_path(path).read_text(encoding="utf-8"))
        return ArtifactMetadata(**payload)

    def _resolve_path(self, kind: str, artifact_id: str) -> Path:
        self._validate_kind(kind)
        parts = self._artifact_parts(artifact_id)
        candidate = self.root.joinpath(kind, *parts)
        resolved_root = self.root.resolve()
        resolved_parent = candidate.parent.resolve()
        if not _is_relative_to(resolved_parent, resolved_root):
            raise ArtifactStoreError(
                "ARTIFACT_PATH_INVALID",
                "产物路径必须位于 ArtifactStore 根目录内。",
                details={"kind": kind, "artifact_id": artifact_id},
            )
        if candidate.exists() and not _is_relative_to(candidate.resolve(), resolved_root):
            raise ArtifactStoreError(
                "ARTIFACT_PATH_INVALID",
                "产物路径不能通过符号链接逃逸 ArtifactStore 根目录。",
                details={"kind": kind, "artifact_id": artifact_id},
            )
        return candidate

    def _validate_kind(self, kind: str) -> None:
        if kind not in self.allowed_kinds:
            raise ArtifactStoreError(
                "ARTIFACT_KIND_INVALID",
                "未知产物类型，无法写入 ArtifactStore。",
                details={"kind": kind, "allowed_kinds": sorted(self.allowed_kinds)},
            )

    def _artifact_parts(self, artifact_id: str) -> list[str]:
        normalized = self._normalize_artifact_id(artifact_id)
        pure_path = PurePosixPath(normalized)
        parts = list(pure_path.parts)
        if not parts:
            raise ArtifactStoreError("ARTIFACT_PATH_INVALID", "产物路径不能为空。", details={"artifact_id": artifact_id})
        for part in parts:
            if part in {"", ".", ".."} or "/" in part or "\\" in part or _WINDOWS_DRIVE_PATTERN.match(part):
                raise ArtifactStoreError(
                    "ARTIFACT_PATH_INVALID",
                    "产物路径只能使用安全的相对路径片段。",
                    details={"artifact_id": artifact_id},
                )
        return parts

    def _normalize_artifact_id(self, artifact_id: str) -> str:
        if not isinstance(artifact_id, str) or not artifact_id.strip():
            raise ArtifactStoreError("ARTIFACT_PATH_INVALID", "产物路径不能为空。", details={"artifact_id": artifact_id})
        raw = artifact_id.strip()
        if raw.startswith(("/", "\\")) or _WINDOWS_DRIVE_PATTERN.match(raw):
            raise ArtifactStoreError(
                "ARTIFACT_PATH_INVALID",
                "产物路径必须是相对路径。",
                details={"artifact_id": artifact_id},
            )
        return raw.replace("\\", "/")

    def _metadata_path(self, path: Path) -> Path:
        return path.with_name(f"{path.name}.meta.json")

    def _relative_storage_path(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True
