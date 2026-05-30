"""生产就绪适配清单。

本地 MVP 默认使用 JSON 文件存储和内存限速器；PRD 同时要求保留 MySQL、Redis、
Celery 的生产形态。这个清单把生产依赖、替换点和本仓库中的基础设施资产集中
声明出来，便于部署脚本、验收脚本和文档引用同一份事实。
"""

from __future__ import annotations

from typing import Any


def production_readiness_manifest() -> dict[str, Any]:
    return {
        "database": {
            "default": "mysql8",
            "schema": "infra/mysql/schema.sql",
            "runtime_adapter": "aegisqa.storage.json_store.JsonStore",
            "production_adapter": "MySQL 8.0 schema + repository layer extension point",
        },
        "queue": {
            "broker": "redis",
            "message_contract": {"required_fields": ["item_id"], "forbidden_fields": ["row_json", "context"]},
            "local_adapter": "aegisqa.engine.runner.RunRecord.queue_messages",
        },
        "worker": {
            "engine": "celery",
            "readme": "infra/celery/README.md",
            "task_payload": "item_id",
            "rate_limit_strategy": ["Skill Adapter", "Celery rate_limit", "Redis semaphore", "dynamic dispatch throttling"],
        },
        "security": {
            "trusted_skill_sources": ["local trusted manifest directory", "internal Git", "package repository"],
            "secret_policy": "Secret 引用注入，日志和报告统一脱敏",
        },
    }

