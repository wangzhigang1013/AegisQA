"""基础 RBAC 权限。"""

from __future__ import annotations


class AccessControl:
    """Admin、Skill Developer、Evaluator、Viewer 四类角色的最小权限矩阵。"""

    ROLE_PERMISSIONS: dict[str, set[str]] = {
        "Admin": {"*"},
        "Skill Developer": {"skill:register", "skill:approve", "workflow:publish", "run:create"},
        "Evaluator": {"dataset:create", "workflow:publish", "run:create", "badcase:correct"},
        "Viewer": {"skill:read", "dataset:read", "run:read", "report:read"},
    }

    def can(self, role: str, permission: str) -> bool:
        permissions = self.ROLE_PERMISSIONS.get(role, set())
        return "*" in permissions or permission in permissions

