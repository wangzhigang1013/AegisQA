from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class RouteContext:
    """路由层共享上下文。

    FastAPI 的 `create_app()` 负责创建服务实例；各领域路由只通过这个上下文访问依赖，
    避免在路由模块里重新初始化存储、Runner 或 Registry。
    """

    store: Any
    registry: Any
    audit_service: Any
    dataset_service: Any
    template_service: Any
    workflow_service: Any
    graph_service: Any
    runner: Any
    badcases: Any
    judge_profiles: Any
    access_control: Any
    workflows: dict[str, Any]
