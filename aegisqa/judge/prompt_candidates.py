"""Prompt 优化候选池。"""

from __future__ import annotations

from datetime import datetime, timezone
from aegisqa.core.time import now_beijing_str, now_beijing
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.badcases.service import BadcaseRecord
from aegisqa.storage.json_store import JsonStore


class PromptCandidate(BaseModel):
    candidate_id: str
    source_badcase_id: str
    judge_profile_id: str
    prompt_version: str
    sample: dict[str, Any] = Field(default_factory=dict)
    reason: str
    status: str = "pending_review"
    reviewer: str | None = None
    decision: str | None = None
    created_at: str
    updated_at: str


class PromptCandidateService:
    """把人工纠错后的 Badcase 沉淀为裁判 Prompt 优化候选。"""

    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def create_from_badcase(self, badcase: BadcaseRecord, *, judge_profile_id: str, prompt_version: str) -> PromptCandidate:
        now = _now()
        candidate = PromptCandidate(
            candidate_id=f"prompt-candidate-{uuid4().hex[:12]}",
            source_badcase_id=badcase.badcase_id,
            judge_profile_id=judge_profile_id,
            prompt_version=prompt_version,
            sample=badcase.payload,
            reason=badcase.note or badcase.reason,
            created_at=now,
            updated_at=now,
        )
        self._save(candidate)
        return candidate

    def mark_reviewed(self, candidate_id: str, *, decision: str, reviewer: str) -> PromptCandidate:
        candidate = self.get(candidate_id)
        candidate.status = decision
        candidate.decision = decision
        candidate.reviewer = reviewer
        candidate.updated_at = _now()
        self._save(candidate)
        return candidate

    def list_candidates(self, *, judge_profile_id: str | None = None, status: str | None = None) -> list[PromptCandidate]:
        candidates = [PromptCandidate(**payload) for payload in self.store.iter_jsonl(["prompt_candidates", "index.jsonl"])]
        latest = {candidate.candidate_id: candidate for candidate in candidates}
        values = list(latest.values())
        if judge_profile_id:
            values = [candidate for candidate in values if candidate.judge_profile_id == judge_profile_id]
        if status:
            values = [candidate for candidate in values if candidate.status == status]
        return values

    def get(self, candidate_id: str) -> PromptCandidate:
        payload = self.store.read_json(["prompt_candidates", f"{candidate_id}.json"])
        if not payload:
            raise KeyError(f"Prompt 候选不存在：{candidate_id}")
        return PromptCandidate(**payload)

    def _save(self, candidate: PromptCandidate) -> None:
        self.store.write_json(["prompt_candidates", f"{candidate.candidate_id}.json"], candidate.model_dump(mode="json"))
        self.store.append_jsonl(["prompt_candidates", "index.jsonl"], candidate.model_dump(mode="json"))


def _now() -> str:
    return now_beijing_str()

