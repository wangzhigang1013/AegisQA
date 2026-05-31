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

    def list_events(self, *, actor: str | None = None, action: str | None = None, target: str | None = None) -> list[AuditEvent]:
        events = [AuditEvent(**payload) for payload in self.store.iter_jsonl(["audit", "events.jsonl"])]
        # 过滤能力放在审计服务层，避免多个 API 入口各自实现一份筛选逻辑。
        if actor is not None:
            events = [event for event in events if event.actor == actor]
        if action is not None:
            events = [event for event in events if event.action == action]
        if target is not None:
            events = [event for event in events if event.target == target]
        return events
