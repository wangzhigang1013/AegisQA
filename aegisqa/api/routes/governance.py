"""治理、健康检查与全局概览路由。"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI

from aegisqa.api.app import MAX_SKILL_PACKAGE_FILES, MAX_SKILL_PACKAGE_FILE_BYTES, MAX_SKILL_PACKAGE_TOTAL_BYTES
from aegisqa.api.experience import build_workbench_payload
from aegisqa.api.routes.context import RouteContext
from aegisqa.models.gateway import ModelGateway
from aegisqa.reports.aggregator import aggregate_run_report


_RUNTIME_STATUS_LABELS = {
    "available": "可用",
    "configured": "已配置",
    "demo": "演示",
    "not_configured": "未配置",
    "not_connected": "未接入",
}


def _runtime_component(
    component_id: str,
    *,
    name: str,
    backend: str,
    status: str,
    message: str,
    doc_url: str,
    config_url: str | None,
    risk_level: str,
) -> dict[str, Any]:
    """治理页用统一结构渲染运行态，避免前端猜测占位组件是否已接入。"""

    return {
        "component_id": component_id,
        "name": name,
        "backend": backend,
        "status": status,
        "status_label": _RUNTIME_STATUS_LABELS.get(status, status),
        "message": message,
        "doc_url": doc_url,
        "config_url": config_url,
        "risk_level": risk_level,
    }


def register_governance_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册不隶属于单一业务资源的治理类接口。"""

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "aegisqa"}

    @app.get("/dashboard/summary")
    def dashboard_summary() -> dict[str, Any]:
        runs = ctx.runner.list_run_summaries()
        completed = [run for run in runs if run.get("status") == "completed"]
        latest_run = runs[0] if runs else None
        latest_completed_run = ctx.runner.get_run(str(completed[0]["run_id"])) if completed else None
        latest_report = aggregate_run_report(latest_completed_run).model_dump(mode="json") if latest_completed_run else None
        datasets = ctx.dataset_service.list_datasets()
        pass_rate = float(latest_report.get("pass_rate", 0.0)) if latest_report else 0.0
        badcase_count = len(ctx.badcases.list_badcases())
        return {
            "dataset_count": len(datasets),
            "skill_count": len(ctx.registry.list_skills()),
            "workflow_count": len(ctx.workflow_service.list_versions()),
            "run_count": len(runs),
            "latest_run": latest_run,
            "pass_rate": pass_rate,
            "badcase_count": badcase_count,
            "runs": {"total": len(runs), "completed": len(completed), "running": len([run for run in runs if run.get("status") == "running"])},
            "datasets": {"total": len(datasets)},
            "skills": {"total": len(ctx.registry.list_skills())},
            "workflows": {"total": len(ctx.workflow_service.list_versions())},
            "badcases": {"total": badcase_count},
            "latest_report": latest_report,
        }

    @app.get("/overview/workbench")
    def overview_workbench() -> dict[str, Any]:
        return build_workbench_payload(ctx)

    @app.get("/access/check")
    def access_check(role: str, permission: str) -> dict[str, bool]:
        return {"allowed": ctx.access_control.can(role, permission)}

    @app.get("/governance/runtime-status")
    def runtime_status() -> dict[str, Any]:
        """返回当前运行边界的事实状态，避免把占位基础设施展示成已接入。"""

        storage_backend = str(getattr(ctx.store, "backend", getattr(ctx.store, "__class__", type(ctx.store)).__name__)).lower()
        storage_label = str(getattr(ctx.store, "__class__", type(ctx.store)).__name__)
        executor_backend = str(getattr(ctx.task_executor, "backend", type(ctx.task_executor).__name__))
        model_status = ModelGateway.from_env().status()
        model_provider = str(model_status.get("provider") or "mock")
        model_runtime_status = "demo" if model_provider in {"mock", "demo", "offline", ""} else ("available" if model_status.get("ready") else "not_configured")
        celery_configured = executor_backend == "celery"
        if "mysql" in storage_backend:
            storage_backend_normalized = "mysql"
        elif "sqlite" in storage_backend:
            storage_backend_normalized = "sqlite"
        else:
            storage_backend_normalized = "json"
        storage_message = {
            "mysql": "当前使用 MySQL Repository/文档适配器承载核心元数据。",
            "sqlite": "当前使用本地 SQLite 存储；MySQL adapter 未在本运行期启用。",
            "json": "当前使用本地 JSON 文件存储；MySQL adapter 未在本运行期启用。",
        }[storage_backend_normalized]
        executor_message = "Celery 已作为执行器后端配置。" if celery_configured else "当前使用本地线程执行器，适合本地试用和单进程评测。"
        model_message = "离线 mock 模型可用。" if model_runtime_status == "demo" else ("真实模型连接可用。" if model_runtime_status == "available" else "真实模型连接尚未完整配置。")
        skill_sandbox_message = "上传脚本型 Skill 在短生命周期子进程中执行，默认禁止网络和包外文件访问。"
        mysql_configured = storage_backend_normalized == "mysql"
        mysql_message = "MySQL Repository 已作为当前存储后端启用。" if mysql_configured else "MySQL schema 是生产适配资产，当前运行未使用 MySQL repository。"
        redis_configured = (os.getenv("AEGISQA_RATE_LIMIT_BACKEND") or "memory").lower() == "redis"
        redis_message = "Redis 已作为分布式限流后端配置。" if redis_configured else "Redis 是 Celery/分布式限流生产依赖，当前运行未连接 Redis。"
        celery_message = "API 已配置 Celery 执行器。" if celery_configured else "当前未使用 Celery worker 执行任务。"
        components = [
            _runtime_component(
                "storage",
                name="存储后端",
                backend=storage_backend_normalized,
                status="available",
                message=storage_message,
                doc_url="/docs/runtime/storage",
                config_url="/governance#runtime-storage",
                risk_level="low" if storage_backend_normalized in {"sqlite", "mysql"} else "medium",
            ),
            _runtime_component(
                "executor",
                name="执行器后端",
                backend=executor_backend,
                status="configured" if celery_configured else "demo",
                message=executor_message,
                doc_url="/docs/runtime/executor",
                config_url="/governance#runtime-executor",
                risk_level="low" if celery_configured else "medium",
            ),
            _runtime_component(
                "model_gateway",
                name="模型网关",
                backend=model_provider,
                status=model_runtime_status,
                message=model_message,
                doc_url="/docs/model-gateway",
                config_url="/governance#model-gateway",
                risk_level="low" if model_runtime_status == "available" else "medium",
            ),
            _runtime_component(
                "skill_sandbox",
                name="Skill 沙箱",
                backend="subprocess",
                status="available",
                message=skill_sandbox_message,
                doc_url="/docs/skills/sandbox",
                config_url="/governance#skill-sandbox",
                risk_level="medium",
            ),
            _runtime_component(
                "mysql",
                name="MySQL",
                backend="mysql",
                status="configured" if mysql_configured else "not_connected",
                message=mysql_message,
                doc_url="/docs/runtime/mysql",
                config_url="/governance#runtime-storage",
                risk_level="low" if mysql_configured else "info",
            ),
            _runtime_component(
                "redis",
                name="Redis",
                backend="redis",
                status="configured" if redis_configured else "not_connected",
                message=redis_message,
                doc_url="/docs/runtime/redis",
                config_url="/governance#runtime-executor",
                risk_level="low" if redis_configured else "info",
            ),
            _runtime_component(
                "celery",
                name="Celery",
                backend="celery",
                status="configured" if celery_configured else "not_connected",
                message=celery_message,
                doc_url="/docs/runtime/celery",
                config_url="/governance#runtime-executor",
                risk_level="low" if celery_configured else "info",
            ),
        ]
        return {
            "storage": {
                "backend": storage_backend_normalized,
                "adapter": storage_label,
                "status": "available",
                "scope": {"mysql": "mysql", "sqlite": "local_sqlite", "json": "local"}[storage_backend_normalized],
                "message": storage_message,
                "doc_url": "/docs/runtime/storage",
                "config_url": "/governance#runtime-storage",
            },
            "executor": {
                "backend": executor_backend,
                "status": "configured" if celery_configured else "demo",
                "message": executor_message,
                "doc_url": "/docs/runtime/executor",
                "config_url": "/governance#runtime-executor",
            },
            "model_gateway": {
                **model_status,
                "status": model_runtime_status,
                "message": model_message,
                "doc_url": "/docs/model-gateway",
                "config_url": "/governance#model-gateway",
            },
            "skill_sandbox": {
                "mode": "subprocess",
                "status": "available",
                "permissions_required": True,
                "network_default": "denied",
                "file_scope": "package_root_only",
                "limits": {
                    "max_files": MAX_SKILL_PACKAGE_FILES,
                    "max_file_size_bytes": MAX_SKILL_PACKAGE_FILE_BYTES,
                    "max_total_size_bytes": MAX_SKILL_PACKAGE_TOTAL_BYTES,
                },
                "message": skill_sandbox_message,
                "doc_url": "/docs/skills/sandbox",
                "config_url": "/governance#skill-sandbox",
            },
            "external_services": {
                "mysql": {"status": "configured" if mysql_configured else "not_connected", "message": mysql_message, "doc_url": "/docs/runtime/mysql", "config_url": "/governance#runtime-storage"},
                "redis": {"status": "configured" if redis_configured else "not_connected", "message": redis_message, "doc_url": "/docs/runtime/redis", "config_url": "/governance#runtime-executor"},
                "celery": {
                    "status": "configured" if celery_configured else "not_connected",
                    "message": celery_message,
                    "doc_url": "/docs/runtime/celery",
                    "config_url": "/governance#runtime-executor",
                },
            },
            "components": components,
        }

    @app.get("/audit-events")
    def list_audit_events(actor: str | None = None, action: str | None = None, target: str | None = None) -> list[dict[str, Any]]:
        events = ctx.audit_service.list_events(actor=actor, action=action, target=target)
        return [event.model_dump(mode="json") for event in events]
