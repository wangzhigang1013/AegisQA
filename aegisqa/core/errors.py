"""跨 API、Service、Worker 复用的业务错误类型。"""

from __future__ import annotations

from typing import Any


class AegisQAError(Exception):
    """带错误码、HTTP 状态和详情的业务异常。

    Service 层不能直接依赖 FastAPI 的 `HTTPException`，否则后续替换成 CLI、Worker
    或 Celery 调用时会把 Web 框架细节泄漏进去。这个轻量异常作为稳定边界，由
    API 层统一转换为 `{code, message, details, trace_id}`。
    """

    def __init__(self, code: str, message: str, *, status_code: int = 400, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
