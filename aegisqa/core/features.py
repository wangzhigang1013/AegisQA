from __future__ import annotations

import os
from typing import Final


FEATURE_FLAG_DEFAULTS: Final[dict[str, bool]] = {
    "ci_gate": True,
    "candidate_assets": True,
    "repair_tasks": True,
    "experiments": True,
    "annotation_queue": True,
    "judge_audit": True,
}

FEATURE_ENV_PREFIX: Final = "AEGISQA_ENABLE_"

_TRUE_VALUES: Final = {"1", "true", "yes", "y", "on", "enabled"}


def load_feature_flags(environ: dict[str, str] | None = None) -> dict[str, bool]:
    source = environ if environ is not None else os.environ
    flags = dict(FEATURE_FLAG_DEFAULTS)
    for feature in FEATURE_FLAG_DEFAULTS:
        env_value = source.get(f"{FEATURE_ENV_PREFIX}{feature.upper()}")
        if env_value is not None:
            flags[feature] = env_value.strip().lower() in _TRUE_VALUES
    return flags
