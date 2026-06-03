"""Badcase 人工纠错服务。"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.core.errors import AegisQAError
from aegisqa.storage.json_store import JsonStore

ALLOWED_BADCASE_SOURCES = {"step", "quality_check", "gate_rule", "annotation"}


class BadcaseRecord(BaseModel):
    badcase_id: str
    run_id: str
    item_id: str
    status: str = "detected"
    reason: str
    payload: dict[str, Any] = Field(default_factory=dict)
    source: str | None = None
    source_id: str | None = None
    evidence: Any = None
    human_label: str | None = None
    problem_type: str | None = None
    note: str | None = None
    golden_candidate: bool = False
    created_at: str
    updated_at: str


class BadcaseService:
    """管理 Badcase 状态流转与人工纠错。"""

    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def create_badcase(self, run_id: str, item_id: str, reason: str, payload: dict[str, Any]) -> BadcaseRecord:
        source, source_id, evidence = _validated_source(payload)
        now = _now()
        record = BadcaseRecord(
            badcase_id=f"badcase-{uuid4().hex[:12]}",
            run_id=run_id,
            item_id=item_id,
            status="pending_review",
            reason=reason,
            payload=payload,
            source=source,
            source_id=source_id,
            evidence=evidence,
            created_at=now,
            updated_at=now,
        )
        self._save(record)
        return record

    def correct_badcase(
        self,
        badcase_id: str,
        *,
        human_label: str,
        problem_type: str,
        note: str,
        add_to_golden: bool = False,
        ignore: bool = False,
    ) -> BadcaseRecord:
        record = self.get(badcase_id)
        record.human_label = human_label
        record.problem_type = problem_type
        record.note = note
        record.golden_candidate = add_to_golden
        if ignore:
            record.status = "ignored"
        elif add_to_golden:
            record.status = "accepted_to_golden"
        else:
            record.status = "corrected"
        record.updated_at = _now()
        self._save(record)
        return record

    def reopen(self, badcase_id: str) -> BadcaseRecord:
        record = self.get(badcase_id)
        record.status = "reopened"
        record.updated_at = _now()
        self._save(record)
        return record

    def bulk_correct(
        self,
        badcase_ids: list[str],
        *,
        human_label: str,
        problem_type: str,
        note: str,
        add_to_golden: bool = False,
        ignore: bool = False,
    ) -> list[BadcaseRecord]:
        """批量处理 Badcase，用于 P1 批量标记和加入错题本。"""

        return [
            self.correct_badcase(
                badcase_id,
                human_label=human_label,
                problem_type=problem_type,
                note=note,
                add_to_golden=add_to_golden,
                ignore=ignore,
            )
            for badcase_id in badcase_ids
        ]

    def cluster_badcases(self, *, method: str = "rule", text_field: str = "question", similarity_threshold: float = 0.35) -> list[dict[str, Any]]:
        """Badcase 聚类。

        `rule` 使用问题归类/失败原因做确定性分组；`embedding` 使用本地轻量文本向量
        做相似度聚类。这里不用外部 embedding 服务，是为了在离线环境中仍能验证 PRD
        的聚类闭环；生产环境可以把 `_text_vector` 替换成真实向量模型。
        """

        records = list(self._latest_records().values())
        if method == "embedding":
            return self._embedding_clusters(records, text_field=text_field, threshold=similarity_threshold)

        clusters: dict[str, list[BadcaseRecord]] = {}
        for record in records:
            key = record.problem_type or record.reason
            clusters.setdefault(key, []).append(record)
        return [
            {
                "cluster_id": index + 1,
                "cluster_summary": key,
                "method": "rule",
                "count": len(items),
                "badcase_ids": [record.badcase_id for record in items],
            }
            for index, (key, items) in enumerate(sorted(clusters.items(), key=lambda item: item[0]))
        ]

    def _embedding_clusters(self, records: list[BadcaseRecord], *, text_field: str, threshold: float) -> list[dict[str, Any]]:
        clusters: list[dict[str, Any]] = []
        for record in records:
            vector = _text_vector(str(record.payload.get(text_field, "")))
            assigned = False
            for cluster in clusters:
                if _jaccard(vector, cluster["vector"]) >= threshold:
                    cluster["records"].append(record)
                    cluster["vector"] |= vector
                    assigned = True
                    break
            if not assigned:
                clusters.append({"vector": set(vector), "records": [record]})
        return [
            {
                "cluster_id": index + 1,
                "cluster_summary": _cluster_summary(cluster["records"], text_field),
                "method": "embedding",
                "count": len(cluster["records"]),
                "badcase_ids": [record.badcase_id for record in cluster["records"]],
            }
            for index, cluster in enumerate(clusters)
        ]

    def export_badcases(self, output_path: str | Any) -> Any:
        path = output_path
        with path.open("w", encoding="utf-8") as handle:
            for record in self._latest_records().values():
                handle.write(json.dumps(record.model_dump(mode="json"), ensure_ascii=False) + "\n")
        return path

    def list_badcases(self) -> list[BadcaseRecord]:
        return list(self._latest_records().values())

    def filter_badcases(
        self,
        *,
        status: str | None = None,
        problem_type: str | None = None,
        reason: str | None = None,
        skill: str | None = None,
        query: str | None = None,
        min_score: float | None = None,
        max_score: float | None = None,
    ) -> list[BadcaseRecord]:
        """多条件筛选 Badcase。

        报告页需要按状态、问题归类、失败原因、Skill、样本文本和得分区间定位问题。
        这里把筛选逻辑放在服务层，API/UI 可以复用同一套行为。
        """

        records = self.list_badcases()
        filtered: list[BadcaseRecord] = []
        for record in records:
            if status and record.status != status:
                continue
            if problem_type and record.problem_type != problem_type:
                continue
            if reason and reason not in record.reason:
                continue
            if skill and record.payload.get("skill") != skill:
                continue
            if query and query not in json.dumps(record.payload, ensure_ascii=False):
                continue
            score = record.payload.get("score")
            if min_score is not None and (score is None or float(score) < min_score):
                continue
            if max_score is not None and (score is None or float(score) > max_score):
                continue
            filtered.append(record)
        return filtered

    def get(self, badcase_id: str) -> BadcaseRecord:
        payload = self.store.read_json(["badcases", f"{badcase_id}.json"])
        if not payload:
            raise KeyError(f"Badcase 不存在：{badcase_id}")
        return BadcaseRecord(**payload)

    def _save(self, record: BadcaseRecord) -> None:
        self.store.write_json(["badcases", f"{record.badcase_id}.json"], record.model_dump(mode="json"))
        # index 允许重复追加，读取列表用于演示；生产环境应使用数据库唯一键更新。
        self.store.append_jsonl(["badcases", "index.jsonl"], record.model_dump(mode="json"))

    def _latest_records(self) -> dict[str, BadcaseRecord]:
        latest: dict[str, BadcaseRecord] = {}
        for payload in self.store.iter_jsonl(["badcases", "index.jsonl"]):
            record = BadcaseRecord(**payload)
            latest[record.badcase_id] = record
        return latest


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validated_source(payload: dict[str, Any]) -> tuple[str, str, Any]:
    source = str(payload.get("source") or "").strip()
    source_id = str(payload.get("source_id") or "").strip()
    evidence = payload.get("evidence")
    if source not in ALLOWED_BADCASE_SOURCES or not source_id or evidence in (None, "", [], {}):
        raise AegisQAError(
            "BADCASE_SOURCE_INVALID",
            "Badcase 必须来自真实 step、quality_check、gate_rule 或 annotation，并携带 source_id 与 evidence。",
            details={"source": source or None, "source_id": source_id or None, "allowed_sources": sorted(ALLOWED_BADCASE_SOURCES)},
        )
    return source, source_id, evidence


def _text_vector(text: str) -> set[str]:
    """把文本转成轻量 token 集合。

    中文场景下没有分词依赖时，2-gram 能提供足够的局部相似度信号；英文和数字则按
    空白/标点切分。这个实现偏朴素，但可离线、可测试、可替换。
    """

    normalized = text.lower().strip()
    if not normalized:
        return set()
    words = {part for part in normalized.replace("，", " ").replace("。", " ").replace("?", " ").replace("？", " ").split() if part}
    grams = {normalized[index : index + 2] for index in range(max(0, len(normalized) - 1))}
    return words | grams


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _cluster_summary(records: list[BadcaseRecord], text_field: str) -> str:
    first_text = str(records[0].payload.get(text_field, records[0].reason)) if records else "empty"
    return first_text[:40]
