"""Judge Profile 管理与审计持久化。"""

from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.judge.audit import JudgeAuditResult, audit_judge_profile
from aegisqa.storage.json_store import JsonStore


class JudgeProfile(BaseModel):
    profile_id: str
    name: str
    version: int
    model: str
    prompt: str
    rubric: dict[str, Any]
    threshold: float
    output_schema: dict[str, Any]
    status: str = "approved"
    created_at: str


class StoredJudgeAudit(JudgeAuditResult):
    audit_id: str
    created_at: str


class JudgeProfileService:
    """管理 Judge Profile 与审计结果。"""

    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def create_profile(
        self,
        *,
        name: str,
        model: str,
        prompt: str,
        rubric: dict[str, Any],
        threshold: float,
        output_schema: dict[str, Any],
    ) -> JudgeProfile:
        profile = JudgeProfile(
            profile_id=f"judge-{uuid4().hex[:12]}",
            name=name,
            version=1,
            model=model,
            prompt=prompt,
            rubric=rubric,
            threshold=threshold,
            output_schema=output_schema,
            created_at=_now(),
        )
        self.store.write_json(["judge_profiles", f"{profile.profile_id}.json"], profile.model_dump(mode="json"))
        return profile

    def get_profile(self, profile_id: str) -> JudgeProfile:
        payload = self.store.read_json(["judge_profiles", f"{profile_id}.json"])
        if not payload:
            raise KeyError(f"Judge Profile 不存在：{profile_id}")
        return JudgeProfile(**payload)

    def list_profiles(self) -> list[JudgeProfile]:
        """列出 Judge Profile，供审计页面选择和治理页面查看状态。"""

        return [JudgeProfile(**payload) for payload in self.store.list_json(["judge_profiles"])]

    def audit_and_store(
        self,
        profile_id: str,
        *,
        dataset_version_id: str,
        human_labels: list[str],
        judge_labels: list[str],
        positive_label: str = "pass",
    ) -> StoredJudgeAudit:
        self.get_profile(profile_id)
        result = audit_judge_profile(
            judge_profile_id=profile_id,
            dataset_version_id=dataset_version_id,
            human_labels=human_labels,
            judge_labels=judge_labels,
            positive_label=positive_label,
        )
        audit = StoredJudgeAudit(
            **result.model_dump(mode="json"),
            audit_id=f"audit-{uuid4().hex[:12]}",
            created_at=_now(),
        )
        self.store.write_json(["judge_audits", f"{audit.audit_id}.json"], audit.model_dump(mode="json"))
        self.store.append_jsonl(["judge_audits", f"{profile_id}.jsonl"], audit.model_dump(mode="json"))
        return audit

    def list_audits(self, profile_id: str) -> list[StoredJudgeAudit]:
        return [StoredJudgeAudit(**payload) for payload in self.store.iter_jsonl(["judge_audits", f"{profile_id}.jsonl"])]

    def list_all_audits(self) -> list[StoredJudgeAudit]:
        """列出全部审计结果，避免前端必须先知道 profile_id 才能展示历史。"""

        return [
            StoredJudgeAudit(**payload)
            for payload in self.store.list_json(["judge_audits"])
            if isinstance(payload, dict) and str(payload.get("audit_id", "")).startswith("audit-")
        ]

    def bias_analysis(self, audit_id: str) -> dict[str, Any]:
        audit = StoredJudgeAudit(**self.store.read_json(["judge_audits", f"{audit_id}.json"]))
        labels = sorted(audit.confusion_matrix)
        label_bias: dict[str, dict[str, int]] = {}
        for label in labels:
            false_positive = sum(audit.confusion_matrix[actual].get(label, 0) for actual in labels if actual != label)
            false_negative = sum(audit.confusion_matrix[label].get(predicted, 0) for predicted in labels if predicted != label)
            label_bias[label] = {"false_positive": false_positive, "false_negative": false_negative}
        return {
            "audit_id": audit_id,
            "label_bias": label_bias,
            "high_confidence_misclassified": audit.misclassified_items,
        }

    def cross_validate(
        self,
        *,
        dataset_version_id: str,
        human_labels: list[str],
        judge_outputs_by_profile: dict[str, list[str]],
    ) -> dict[str, Any]:
        profile_ids = sorted(judge_outputs_by_profile)
        pairwise: dict[str, float] = {}
        for index, left_id in enumerate(profile_ids):
            for right_id in profile_ids[index + 1 :]:
                left = judge_outputs_by_profile[left_id]
                right = judge_outputs_by_profile[right_id]
                if len(left) != len(right):
                    raise ValueError("不同 Judge 输出长度必须一致")
                agreement = sum(1 for a, b in zip(left, right, strict=True) if a == b) / len(left) if left else 0.0
                pairwise[f"{left_id}|{right_id}"] = agreement
        audits = {
            profile_id: audit_judge_profile(
                judge_profile_id=profile_id,
                dataset_version_id=dataset_version_id,
                human_labels=human_labels,
                judge_labels=labels,
            ).model_dump(mode="json")
            for profile_id, labels in judge_outputs_by_profile.items()
        }
        return {"dataset_version_id": dataset_version_id, "profile_count": len(profile_ids), "pairwise_agreement": pairwise, "audits": audits}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
