"""Celery Worker 入口占位。

本文件不强制本地安装 Celery；生产镜像会安装 `celery` 和 `redis` 后使用这里的
入口创建 Worker。这样本地测试仍保持轻量，部署形态也有稳定挂载点。
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

try:
    from celery import Celery
except ImportError:  # pragma: no cover - 本地测试环境默认不安装 Celery。
    Celery = None  # type: ignore[assignment]


# Worker 级单例应用实例
_worker_app = None
_worker_store = None
_worker_runner = None
_worker_audit_service = None


def _get_worker_app(store_root: str = "data/aegisqa_store", storage_backend: str = "json"):
    """获取 Worker 级单例应用实例。"""
    global _worker_app, _worker_store, _worker_runner, _worker_audit_service

    if _worker_app is None:
        logger.info("Creating worker app instance (store_root=%s, backend=%s)", store_root, storage_backend)
        from aegisqa.api.app import create_app
        _worker_app = create_app(store_root=store_root, storage_backend=storage_backend, task_executor_backend="local_thread")
        _worker_store = _worker_app.state.store
        _worker_runner = _worker_app.state.runner
        _worker_audit_service = _worker_app.state.audit_service

    return _worker_app, _worker_store, _worker_runner, _worker_audit_service


if Celery is not None:
    app = Celery("aegisqa", broker="redis://redis:6379/0", backend="redis://redis:6379/1")

    @app.task(name="aegisqa.execute_task", rate_limit="10/s")
    def execute_task(task_id: str, store_root: str = "data/aegisqa_store", storage_backend: str = "json") -> dict[str, str]:
        """在 Worker 进程里执行一个 Task 绑定的 Run。"""

        from aegisqa.api.app import _get_record, _now, _refresh_task_from_run, _save_record

        # 使用单例应用实例
        worker_app, store, runner, audit_service = _get_worker_app(store_root, storage_backend)
        task = _get_record(store, "tasks", task_id)

        def refresh_progress(current_run) -> None:  # noqa: ANN001 - Worker 只透传 RunRecord 给共享刷新函数。
            latest_task = _get_record(store, "tasks", task_id)
            _refresh_task_from_run(store, latest_task, current_run)

        try:
            run = runner.execute_run(task["run_id"], progress_callback=refresh_progress)
        except Exception as exc:  # noqa: BLE001 - Worker 边界必须把失败落库，避免 Task 永远 running。
            failed_run = runner.get_run(task["run_id"])
            failed_run.status = "failed"
            failed_run.finished_at = _now()
            runner._save_run(failed_run)
            latest_task = _get_record(store, "tasks", task_id)
            refreshed = _refresh_task_from_run(store, latest_task, failed_run)
            refreshed["last_error"] = str(exc)
            _save_record(store, "tasks", "task_id", refreshed)
            audit_service.record(actor="worker", action="task.execute.failed", target=task_id, detail={"error": str(exc)})
            return {"task_id": task_id, "run_id": failed_run.run_id, "status": "failed"}
        return {"task_id": task_id, "run_id": run.run_id, "status": run.status}

    @app.task(name="aegisqa.execute_item", rate_limit="10/s")
    def execute_item(item_id: str) -> dict[str, str]:
        """兼容旧的 item 级消息契约。

        当前 API 侧已经按 Task 提交 Celery 任务；保留该任务名，避免旧 worker 配置启动失败。
        """

        return {"item_id": item_id, "status": "accepted", "message": "请使用 aegisqa.execute_task 提交完整 Task。"}
else:
    app = None
