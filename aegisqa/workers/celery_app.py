"""Celery Worker 入口占位。

本文件不强制本地安装 Celery；生产镜像会安装 `celery` 和 `redis` 后使用这里的
入口创建 Worker。这样本地测试仍保持轻量，部署形态也有稳定挂载点。
"""

from __future__ import annotations


try:
    from celery import Celery
except ImportError:  # pragma: no cover - 本地测试环境默认不安装 Celery。
    Celery = None  # type: ignore[assignment]


if Celery is not None:
    app = Celery("aegisqa", broker="redis://redis:6379/0", backend="redis://redis:6379/1")

    @app.task(name="aegisqa.execute_item", rate_limit="10/s")
    def execute_item(item_id: str) -> dict[str, str]:
        """生产 Worker 的任务壳。

        真正执行时应通过 item_id 查询数据库并调用 WorkflowRunner 的 item 级执行逻辑。
        当前 MVP 的单进程 Runner 已验证相同轻量消息契约。
        """

        return {"item_id": item_id, "status": "accepted"}
else:
    app = None

