"""操作审计日志。"""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.storage.json_store import JsonStore

# 请求级上下文变量，由中间件设置，供审计服务自动读取
_current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)


def set_current_request_id(request_id: str | None) -> None:
    """设置当前请求 ID（由中间件调用）。"""
    _current_request_id.set(request_id)


def get_current_request_id() -> str | None:
    """获取当前请求 ID。"""
    return _current_request_id.get()


class AuditEvent(BaseModel):
    event_id: str
    actor: str
    role: str = "System"
    action: str
    target: str
    result: str = "success"
    trace_id: str = Field(default_factory=lambda: f"trace_{uuid4().hex[:12]}")
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class AuditService:
    """记录 Workflow 发布、Skill 审批、Run 启动、人工纠错等操作。"""

    def __init__(self, store: JsonStore, audit_repository: Any | None = None) -> None:
        self.store = store
        self.audit_repository = audit_repository

    def record(
        self,
        *,
        actor: str,
        action: str,
        target: str,
        detail: dict[str, Any] | None = None,
        role: str | None = None,
        result: str = "success",
        trace_id: str | None = None,
    ) -> AuditEvent:
        # 自动从上下文变量获取 request_id，无需每个调用方手动传递
        effective_trace_id = trace_id or get_current_request_id() or f"trace_{uuid4().hex[:12]}"
        event = AuditEvent(
            event_id=f"audit-{uuid4().hex[:12]}",
            actor=actor,
            role=role or actor,
            action=action,
            target=target,
            result=result,
            trace_id=effective_trace_id,
            detail=detail or {},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        if self.audit_repository:
            self.audit_repository.append(event.model_dump(mode="json"))
        else:
            self.store.append_jsonl(["audit", "events.jsonl"], event.model_dump(mode="json"))
        return event

    def list_events(self, *, actor: str | None = None, action: str | None = None, target: str | None = None) -> list[AuditEvent]:
        payloads = self.audit_repository.list() if self.audit_repository else self.store.iter_jsonl(["audit", "events.jsonl"])
        events = [AuditEvent(**payload) for payload in payloads]
        # 过滤能力放在审计服务层，避免多个 API 入口各自实现一份筛选逻辑。
        if actor is not None:
            events = [event for event in events if event.actor == actor]
        if action is not None:
            events = [event for event in events if event.action == action]
        if target is not None:
            events = [event for event in events if event.target == target]
        return events
