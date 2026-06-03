from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


QualityCheckStatus = Literal["passed", "failed", "skipped"]
GateDecision = Literal["passed", "failed", "skipped"]


class QualityCheckResult(BaseModel):
    check_id: str
    title: str = ""
    status: QualityCheckStatus
    metric: str | None = None
    operator: str | None = None
    threshold: float | int | None = None
    actual: float | int | None = None
    blocking: bool = True
    reason: str | None = None
    message: str = ""
    evidence: dict[str, Any] = Field(default_factory=dict)
    recommendation: str = ""


class GateRule(BaseModel):
    rule_id: str
    metric: str
    operator: str
    threshold: float
    blocking: bool = True
    title: str = ""


class GateTarget(BaseModel):
    kind: str
    id: str


class GateContext(BaseModel):
    metrics: dict[str, Any] = Field(default_factory=dict)
    target: GateTarget | dict[str, str] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GateEvaluationResult(BaseModel):
    decision: GateDecision
    status: GateDecision
    blocking_failures: int = 0
    quality_checks: list[QualityCheckResult] = Field(default_factory=list)
    target: GateTarget | dict[str, str] | None = None
    summary: str = ""
