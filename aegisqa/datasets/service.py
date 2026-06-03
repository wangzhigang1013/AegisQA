"""数据集上传、版本化与流式读取。"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from pydantic import BaseModel, Field

from aegisqa.core.errors import AegisQAError
from aegisqa.storage.json_store import JsonStore


class DatasetRow(BaseModel):
    row_id: str
    row_index: int
    row_hash: str
    data: dict[str, Any]


class DatasetVersion(BaseModel):
    dataset_id: str
    name: str
    version: int
    version_id: str
    file_format: str
    row_count: int
    field_schema: dict[str, str]
    preview: list[dict[str, Any]]
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None
    row_store_path: str
    created_at: str = ""
    source_type: str = "unknown"
    source_ref: dict[str, Any] = Field(default_factory=dict)
    artifact_uri: str | None = None
    artifact_metadata: dict[str, Any] = Field(default_factory=dict)


class DatasetService:
    """负责把用户上传文件物化成可按需读取的数据集版本。"""

    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def upload_dataset(
        self,
        name: str,
        file_path: Path | str,
        *,
        golden: bool = False,
        label_field: str | None = None,
        answer_field: str | None = None,
    ) -> DatasetVersion:
        path = Path(file_path)
        dataset_id = _slugify(name)
        version = self._next_version(dataset_id)
        file_format = path.suffix.lower().lstrip(".")
        if file_format not in {"csv", "jsonl"}:
            raise AegisQAError(
                "DATASET_UNSUPPORTED_FORMAT",
                "MVP 仅支持 CSV/JSONL 数据集。",
                details={"filename": path.name, "supported_formats": ["csv", "jsonl"]},
            )

        row_store_parts = ["datasets", dataset_id, f"v{version}", "rows.jsonl"]
        row_count = 0
        preview: list[dict[str, Any]] = []
        samples_by_field: dict[str, list[Any]] = defaultdict(list)

        # 关键点：这里边解析边写入 JSONL，不把完整 rows 放进内存，符合 PRD 的 OOM 约束。
        with self.store.path(*row_store_parts).open("w", encoding="utf-8") as handle:
            for row_count, row_data in enumerate(self._iter_source_rows(path, file_format), start=1):
                row = DatasetRow(
                    row_id=str(row_count),
                    row_index=row_count - 1,
                    row_hash=_stable_hash(row_data),
                    data=row_data,
                )
                handle.write(row.model_dump_json() + "\n")
                if len(preview) < 20:
                    preview.append(row_data)
                for field, value in row_data.items():
                    if len(samples_by_field[field]) < 50:
                        samples_by_field[field].append(value)

        if row_count == 0:
            raise AegisQAError(
                "DATASET_EMPTY",
                "数据集没有可执行样本，请上传至少一行有效数据。",
                details={"filename": path.name, "file_format": file_format},
            )

        dataset = DatasetVersion(
            dataset_id=dataset_id,
            name=name,
            version=version,
            version_id=f"{dataset_id}:v{version}",
            file_format=file_format,
            row_count=row_count,
            field_schema={field: _infer_field_type(values) for field, values in samples_by_field.items()},
            preview=preview,
            golden=golden,
            label_field=label_field,
            answer_field=answer_field,
            row_store_path="/".join(row_store_parts),
            created_at=_now(),
            source_type="file_upload",
            source_ref={"filename": path.name, "file_format": file_format},
        )
        self._save_version(dataset)
        return dataset

    def materialize_source_rows(
        self,
        name: str,
        rows: list[dict[str, Any]],
        *,
        golden: bool = False,
        label_field: str | None = None,
        answer_field: str | None = None,
    ) -> DatasetVersion:
        """把 Source Skill 输出物化为 Dataset Version。

        Source Skill 负责“从哪里取数”，Dataset Version 负责“把本次运行用到的样本
        固定下来”。这样后续 Run 可以回放到同一批 row_id/row_hash。
        """

        dataset_id = _slugify(name)
        version = self._next_version(dataset_id)
        row_store_parts = ["datasets", dataset_id, f"v{version}", "rows.jsonl"]
        preview: list[dict[str, Any]] = []
        samples_by_field: dict[str, list[Any]] = defaultdict(list)
        with self.store.path(*row_store_parts).open("w", encoding="utf-8") as handle:
            for row_count, row_data in enumerate(rows, start=1):
                row = DatasetRow(row_id=str(row_count), row_index=row_count - 1, row_hash=_stable_hash(row_data), data=row_data)
                handle.write(row.model_dump_json() + "\n")
                if len(preview) < 20:
                    preview.append(row_data)
                for field, value in row_data.items():
                    if len(samples_by_field[field]) < 50:
                        samples_by_field[field].append(value)
        dataset = DatasetVersion(
            dataset_id=dataset_id,
            name=name,
            version=version,
            version_id=f"{dataset_id}:v{version}",
            file_format="source",
            row_count=len(rows),
            field_schema={field: _infer_field_type(values) for field, values in samples_by_field.items()},
            preview=preview,
            golden=golden,
            label_field=label_field,
            answer_field=answer_field,
            row_store_path="/".join(row_store_parts),
            created_at=_now(),
            source_type="source_skill",
            source_ref={"materialized_row_count": len(rows)},
        )
        self._save_version(dataset)
        return dataset

    def get_version(self, dataset_id: str, version: int) -> DatasetVersion:
        payload = self.store.read_json(["datasets", dataset_id, f"v{version}", "metadata.json"])
        if not payload:
            raise KeyError(f"数据集版本不存在：{dataset_id} v{version}")
        return DatasetVersion(**payload)

    def list_datasets(self) -> list[dict[str, Any]]:
        """列出数据集及版本摘要，供前端选择器和概览页使用。"""

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for payload in self.store.list_json(["datasets"], recursive=True):
            # `datasets/**` 下同时存在 versions.json 和 metadata.json。这里只接受
            # DatasetVersion 元数据，避免把版本索引文件误当成可执行数据集版本。
            if not isinstance(payload, dict) or "version_id" not in payload or "row_store_path" not in payload:
                continue
            dataset = DatasetVersion(**payload)
            grouped[dataset.dataset_id].append(
                {
                    **dataset.model_dump(mode="json"),
                    "field_paths": [f"row.{field}" for field in sorted(dataset.field_schema)],
                }
            )

        datasets: list[dict[str, Any]] = []
        for versions in grouped.values():
            versions.sort(key=lambda item: int(item["version"]))
            latest = versions[-1]
            datasets.append(
                {
                    "dataset_id": latest["dataset_id"],
                    "name": latest["name"],
                    "latest_version": latest["version"],
                    "latest_version_id": latest["version_id"],
                    "row_count": latest["row_count"],
                    "golden": latest["golden"],
                    "versions": versions,
                }
            )
        return sorted(datasets, key=lambda item: str(item["latest_version_id"]), reverse=True)

    def build_lineage(self, dataset_id: str, version: int, downstream_tasks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """构建 Dataset Version 的数据血缘。

        数据血缘只描述“这一版数据从哪里来、包含哪些字段、被哪些任务消费”。
        真实行数据仍然留在 rows.jsonl 中按需读取，避免为了展示血缘而加载全量样本。
        """

        dataset = self.get_version(dataset_id, version)
        tasks = downstream_tasks or []
        matched_tasks = [
            {
                "task_id": task.get("task_id"),
                "name": task.get("name"),
                "status": task.get("status"),
                "workflow_id": task.get("workflow_id"),
                "workflow_name": task.get("workflow_name"),
                "workflow_version_id": task.get("workflow_version_id"),
                "run_id": task.get("run_id"),
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
            }
            for task in tasks
            if task.get("dataset_id") == dataset.dataset_id and int(task.get("dataset_version", -1)) == dataset.version
        ]
        return {
            "dataset_id": dataset.dataset_id,
            "dataset_version": dataset.version,
            "dataset_version_id": dataset.version_id,
            "name": dataset.name,
            "row_count": dataset.row_count,
            "golden": dataset.golden,
            "label_field": dataset.label_field,
            "answer_field": dataset.answer_field,
            "created_at": dataset.created_at,
            "source": {
                "type": dataset.source_type,
                "ref": dataset.source_ref,
            },
            "field_count": len(dataset.field_schema),
            "fields": dataset.field_schema,
            "field_paths": [f"row.{field}" for field in sorted(dataset.field_schema)],
            "preview": dataset.preview,
            "downstream_tasks": matched_tasks,
        }

    def iter_rows(self, dataset_id: str, version: int, chunk_size: int = 100) -> Iterator[DatasetRow]:
        """逐行读取数据集。

        `chunk_size` 保留给调用方表达分页/分片意图；本方法返回生成器，调用方消费多少、
        才读取多少，不会一次性加载完整数据集。
        """

        dataset = self.get_version(dataset_id, version)
        for payload in self.store.iter_jsonl(dataset.row_store_path.split("/")):
            yield DatasetRow(**payload)

    def iter_row_chunks(self, dataset_id: str, version: int, chunk_size: int = 100) -> Iterator[list[DatasetRow]]:
        chunk: list[DatasetRow] = []
        for row in self.iter_rows(dataset_id, version, chunk_size=chunk_size):
            chunk.append(row)
            if len(chunk) >= chunk_size:
                yield chunk
                chunk = []
        if chunk:
            yield chunk

    def export_rows(self, dataset_id: str, version: int, output_path: Path | str, *, file_format: str = "jsonl") -> Path:
        """导出数据集行。

        P1 要求支持数据导出。这里复用流式读取接口，避免导出时把完整数据集加载进内存。
        """

        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if file_format == "jsonl":
            with path.open("w", encoding="utf-8") as handle:
                for row in self.iter_rows(dataset_id, version):
                    handle.write(json.dumps(row.data, ensure_ascii=False) + "\n")
            return path
        if file_format == "csv":
            iterator = self.iter_rows(dataset_id, version)
            first = next(iterator, None)
            if first is None:
                path.write_text("", encoding="utf-8")
                return path
            fieldnames = list(first.data.keys())
            with path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerow(first.data)
                for row in iterator:
                    writer.writerow(row.data)
            return path
        raise ValueError("file_format 仅支持 jsonl/csv")

    def correct_field_type(self, dataset_id: str, version: int, field_name: str, field_type: str) -> DatasetVersion:
        """人工修正字段类型。

        自动识别只能给出初始建议；测试工程师可把标签字段修成 enum、把 URL 修成
        audio_url 等。修正写回版本元数据，不改变原始 rows。
        """

        dataset = self.get_version(dataset_id, version)
        if field_name not in dataset.field_schema:
            raise KeyError(f"字段不存在：{field_name}")
        dataset.field_schema[field_name] = field_type
        self.store.write_json(["datasets", dataset.dataset_id, f"v{dataset.version}", "metadata.json"], dataset.model_dump(mode="json"))
        return dataset

    def _next_version(self, dataset_id: str) -> int:
        versions = self.store.read_json(["datasets", dataset_id, "versions.json"], default=[])
        return len(versions) + 1

    def _save_version(self, dataset: DatasetVersion) -> None:
        self.store.write_json(["datasets", dataset.dataset_id, f"v{dataset.version}", "metadata.json"], dataset.model_dump(mode="json"))
        versions = self.store.read_json(["datasets", dataset.dataset_id, "versions.json"], default=[])
        versions.append({"version": dataset.version, "version_id": dataset.version_id, "row_count": dataset.row_count})
        self.store.write_json(["datasets", dataset.dataset_id, "versions.json"], versions)

    def _iter_source_rows(self, path: Path, file_format: str) -> Iterator[dict[str, Any]]:
        if file_format == "csv":
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    yield {key: _parse_scalar(value) for key, value in row.items()}
            return

        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                line = line.strip()
                if line:
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise AegisQAError(
                            "DATASET_PARSE_ERROR",
                            f"JSONL 第 {line_number} 行不是合法 JSON。",
                            details={"line_number": line_number, "error": exc.msg},
                        ) from exc
                    if not isinstance(payload, dict):
                        raise AegisQAError(
                            "DATASET_PARSE_ERROR",
                            f"JSONL 第 {line_number} 行必须是对象。",
                            details={"line_number": line_number, "actual_type": type(payload).__name__},
                        )
                    yield payload


def _slugify(name: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_\-\u4e00-\u9fff]+", "_", name.strip()).strip("_")
    return value or "dataset"


def _parse_scalar(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    text = value.strip()
    if text == "":
        return None
    lowered = text.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        if re.fullmatch(r"[-+]?\d+", text):
            return int(text)
        if re.fullmatch(r"[-+]?\d+\.\d+", text):
            return float(text)
    except ValueError:
        return text
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    return parsed


def _infer_field_type(values: list[Any]) -> str:
    non_null = [value for value in values if value is not None]
    if not non_null:
        return "text"
    if all(isinstance(value, bool) for value in non_null):
        return "boolean"
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in non_null):
        return "number"
    if all(isinstance(value, (dict, list)) for value in non_null):
        return "json"
    if all(isinstance(value, str) and value.startswith(("http://", "https://")) for value in non_null):
        lowered = [value.lower() for value in non_null]
        if all(value.endswith((".wav", ".mp3", ".m4a", ".flac")) for value in lowered):
            return "audio_url"
        if all(value.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")) for value in lowered):
            return "image_url"
        return "url"
    return "text"


def _stable_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
