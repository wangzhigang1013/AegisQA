"""基础 RBAC 权限。"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from aegisqa.core.errors import AegisQAError


class AccessControl:
    """Admin、Skill Developer、Evaluator、Viewer 四类角色的最小权限矩阵。"""

    ROLE_PERMISSIONS: dict[str, set[str]] = {
        "Admin": {"*"},
        "Skill Developer": {"skill:register", "skill:approve", "skill:contract_test", "workflow:publish", "run:create"},
        "Evaluator": {
            "dataset:create",
            "workflow:publish",
            "run:create",
            "run:control",
            "report:read",
            "report:export",
            "badcase:correct",
            "annotation:review",
            "candidate:govern",
            "redteam:scan",
            "experiment:create",
            "ci_gate:manage",
        },
        "Reviewer": {"report:read", "report:export", "badcase:correct", "judge:audit", "annotation:review", "candidate:govern"},
        "Viewer": {"skill:read", "dataset:read", "run:read", "report:read"},
    }

    def can(self, role: str, permission: str) -> bool:
        permissions = self.ROLE_PERMISSIONS.get(role, set())
        return "*" in permissions or permission in permissions


def require_permission(
    access_control: AccessControl,
    audit_service: Any,
    *,
    role: str,
    permission: str,
    action: str,
    target: str,
    actor: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """统一写操作权限门禁，并把拒绝结果写入审计日志。

    路由层只关心业务动作和权限名；错误响应、审计字段和 trace_id 在这里统一生成，
    避免不同接口各自返回不一致的 forbidden 结构。
    """

    if access_control.can(role, permission):
        return
    trace_id = f"trace_{uuid4().hex[:12]}"
    payload = {"role": role, "required_permission": permission, **(detail or {})}
    audit_service.record(
        actor=actor or role,
        role=role,
        action=action,
        target=target,
        result="forbidden",
        trace_id=trace_id,
        detail=payload,
    )
    raise AegisQAError(
        "FORBIDDEN",
        "当前角色没有权限执行该操作。",
        status_code=403,
        details={**payload, "trace_id": trace_id},
    )
