"""统一前后端动作契约。"""

from __future__ import annotations

from typing import Any


def action_descriptor(
    action: str,
    label: str,
    *,
    enabled: bool = True,
    disabled_reason: str | None = None,
    method: str = "GET",
    target_url: str | None = None,
    permission: str | None = None,
    priority: str | None = None,
    severity: str | None = None,
    evidence: list[Any] | None = None,
    payload: dict[str, Any] | None = None,
    target: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """构建统一动作对象，并保留旧字段兼容已有页面和测试。

    `action` 是历史字段，`id` 是新契约字段；两者短期保持一致，避免前端不同页面
    在迁移期分别解析不同名字。`target_url` 继续兼容旧页面，`target` 则给后续动作
    分发器使用。
    """

    normalized_enabled = bool(enabled) and not disabled_reason
    normalized_target = target
    if normalized_target is None and target_url:
        normalized_target = {"type": "route", "url": target_url}
    return {
        "id": action,
        "action": action,
        "label": label,
        "enabled": normalized_enabled,
        "disabled": not normalized_enabled,
        "disabled_reason": disabled_reason,
        "method": method,
        "permission": permission,
        "priority": priority,
        "severity": severity or priority,
        "target_url": target_url,
        "target": normalized_target,
        "payload": payload or {},
        "evidence": [str(item) for item in evidence or [] if item],
    }
