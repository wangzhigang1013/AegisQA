"""Task 后台执行器抽象。

API 层只负责把 Task/Run 状态推进到可观察的 `running`，真正的后台提交由
执行器负责。这样本地开发可以继续使用线程池，生产部署则可以切换到 Celery。
"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass
import os
from pathlib import Path
from typing import Any, Protocol

from aegisqa.core.errors import AegisQAError


TaskCallable = Callable[[], None]


@dataclass(frozen=True)
class TaskExecutionSubmission:
    """后台执行提交结果，便于 Task 记录 executor 证据。"""

    backend: str
    job_id: str | None = None


class TaskExecutor(Protocol):
    """后台 Task 执行器接口。"""

    backend: str

    def submit(self, *, task_id: str, run_id: str, execute: TaskCallable) -> TaskExecutionSubmission | dict[str, Any]:
        """提交后台执行。"""


class LocalThreadTaskExecutor:
    """本地线程池执行器，保持当前单进程开发体验。"""

    backend = "local_thread"

    def __init__(self, max_workers: int = 4) -> None:
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="aegisqa-task")

    def submit(self, *, task_id: str, run_id: str, execute: TaskCallable) -> TaskExecutionSubmission:
        future: Future[None] = self._executor.submit(execute)
        return TaskExecutionSubmission(backend=self.backend, job_id=f"future-{id(future)}")


class CeleryTaskExecutor:
    """Celery 执行器。

    Celery 不接收 API 进程里的闭包，而是把 Task ID、存储根目录和存储后端发送给
    Worker；Worker 会在自己的进程里重新创建应用依赖并执行同一个 Run。
    """

    backend = "celery"

    def __init__(self, *, store_root: Path | str, storage_backend: str) -> None:
        self.store_root = str(store_root)
        self.storage_backend = storage_backend

    def submit(self, *, task_id: str, run_id: str, execute: TaskCallable) -> TaskExecutionSubmission:
        from aegisqa.workers.celery_app import app as celery_app

        if celery_app is None:
            raise AegisQAError(
                "TASK_EXECUTOR_CELERY_UNAVAILABLE",
                "当前环境未安装 Celery，无法使用 celery 任务执行器。",
                status_code=503,
                details={"executor_backend": self.backend},
            )
        result = celery_app.send_task(
            "aegisqa.execute_task",
            kwargs={"task_id": task_id, "store_root": self.store_root, "storage_backend": self.storage_backend},
        )
        return TaskExecutionSubmission(backend=self.backend, job_id=str(result.id))


def create_task_executor(
    *,
    task_executor: TaskExecutor | None = None,
    backend: str | None = None,
    store_root: Path | str,
    storage_backend: str,
) -> TaskExecutor:
    """创建 Task 执行器。

    测试可以直接注入 `task_executor`；运行期默认使用本地线程池，也可以通过
    `AEGISQA_TASK_EXECUTOR=celery` 切换到 Celery。
    """

    if task_executor is not None:
        return task_executor
    resolved_backend = (backend or os.getenv("AEGISQA_TASK_EXECUTOR") or "local_thread").lower()
    if resolved_backend in {"local", "local_thread", "thread", "threadpool"}:
        return LocalThreadTaskExecutor()
    if resolved_backend == "celery":
        return CeleryTaskExecutor(store_root=store_root, storage_backend=storage_backend)
    raise ValueError(f"不支持的 Task 执行器：{resolved_backend}")


def normalize_task_submission(submission: TaskExecutionSubmission | dict[str, Any] | None, *, default_backend: str) -> dict[str, Any]:
    """把执行器返回值归一化为可写入 Task 的 JSON 结构。"""

    if submission is None:
        return {"backend": default_backend, "job_id": None}
    if isinstance(submission, TaskExecutionSubmission):
        return asdict(submission)
    return {"backend": submission.get("backend") or default_backend, "job_id": submission.get("job_id")}
