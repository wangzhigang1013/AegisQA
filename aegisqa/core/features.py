"""Feature flag definitions for reality-first product gating."""

from __future__ import annotations

import os
from dataclasses import dataclass


DISABLED_REASON = "Reality-first rebuild: hidden until backed by verified runtime behavior."


@dataclass(frozen=True)
class FeatureFlag:
    key: str
    label: str
    enabled: bool
    reason: str

    def as_dict(self) -> dict[str, object]:
        return {
            "key": self.key,
            "label": self.label,
            "enabled": self.enabled,
            "reason": self.reason,
        }


EXPERIMENTAL_FEATURES: dict[str, str] = {
    "ci_gate": "CI Gate",
    "candidate_assets": "Candidate Assets",
    "repair_tasks": "Repair Tasks",
    "experiments": "Experiments",
    "annotation_queue": "Annotation Queue",
    "judge_audit": "Judge Audit",
}


def resolve_feature_flags() -> dict[str, dict[str, object]]:
    """Resolve public feature flags from environment variables.

    Experimental modules default to disabled. Enabling requires an explicit
    `AEGISQA_ENABLE_<FEATURE>=1|true|yes|on` value so unfinished governance
    surfaces do not appear in the primary workflow by accident.
    """

    return {
        key: FeatureFlag(
            key=key,
            label=label,
            enabled=_enabled_from_env(key),
            reason="" if _enabled_from_env(key) else DISABLED_REASON,
        ).as_dict()
        for key, label in EXPERIMENTAL_FEATURES.items()
    }


def _enabled_from_env(feature_key: str) -> bool:
    value = os.getenv(f"AEGISQA_ENABLE_{feature_key.upper()}", "")
    return value.strip().lower() in {"1", "true", "yes", "on"}
