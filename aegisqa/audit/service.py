"""操作审计日志。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.storage.json_store import JsonStore


class AuditEvent(BaseModel):
    event_id: str
    actor: str
    action: str
    target: str
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class AuditService:
    """记录 Workflow 发布、Skill 审批、Run 启动、人工纠错等操作。"""

    def __init__(self, store: JsonStore) -> None:
        self.store = store

    def record(self, *, actor: str, action: str, target: str, detail: dict[str, Any] | None = None) -> AuditEvent:
        event = AuditEvent(
            event_id=f"audit-{uuid4().hex[:12]}",
            actor=actor,
            action=action,
            target=target,
            detail=detail or {},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.store.append_jsonl(["audit", "events.jsonl"], event.model_dump(mode="json"))
        return event

    def list_events(self) -> list[AuditEvent]:
        return [AuditEvent(**payload) for payload in self.store.iter_jsonl(["audit", "events.jsonl"])]

