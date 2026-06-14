"""API 端点限流中间件。

基于滑动窗口的速率限制，支持按 IP 或用户限制请求频率。
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# 限流配置
RATE_LIMIT_ENABLED = os.getenv("AEGISQA_RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_REQUESTS = int(os.getenv("AEGISQA_RATE_LIMIT_REQUESTS", "100"))  # 请求数
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("AEGISQA_RATE_LIMIT_WINDOW", "60"))  # 窗口秒数

# 不限流的路径
RATE_LIMIT_EXEMPT_PATHS = {
    "/health",
    "/healthz",
    "/readyz",
    "/features",
}


class RateLimitExceeded(Exception):
    """速率限制超出异常。"""
    pass


class SlidingWindowRateLimiter:
    """滑动窗口速率限制器。"""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str) -> bool:
        """检查请求是否允许。"""
        now = time.time()
        window_start = now - self.window_seconds

        # 清理过期记录
        self._requests[key] = [
            ts for ts in self._requests[key]
            if ts > window_start
        ]

        # 检查是否超过限制
        if len(self._requests[key]) >= self.max_requests:
            return False

        # 记录请求
        self._requests[key].append(now)
        return True

    def get_remaining(self, key: str) -> int:
        """获取剩余请求次数。"""
        now = time.time()
        window_start = now - self.window_seconds
        valid_requests = [
            ts for ts in self._requests[key]
            if ts > window_start
        ]
        return max(0, self.max_requests - len(valid_requests))

    def get_reset_time(self, key: str) -> float:
        """获取窗口重置时间。"""
        if not self._requests[key]:
            return 0
        oldest = min(self._requests[key])
        return max(0, oldest + self.window_seconds - time.time())


# 全局限流器实例
_rate_limiter = SlidingWindowRateLimiter(
    max_requests=RATE_LIMIT_REQUESTS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """API 速率限制中间件。

    基于客户端 IP 地址进行速率限制。
    """

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        if not RATE_LIMIT_ENABLED:
            return await call_next(request)

        # 免限流路径
        if request.url.path in RATE_LIMIT_EXEMPT_PATHS:
            return await call_next(request)

        # 获取客户端 IP
        client_ip = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        # 检查速率限制
        if not _rate_limiter.is_allowed(client_ip):
            remaining = _rate_limiter.get_remaining(client_ip)
            reset_time = _rate_limiter.get_reset_time(client_ip)

            logger.warning("Rate limit exceeded for IP: %s", client_ip)

            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "请求过于频繁，请稍后再试。",
                    "details": {
                        "limit": RATE_LIMIT_REQUESTS,
                        "window_seconds": RATE_LIMIT_WINDOW_SECONDS,
                        "retry_after_seconds": int(reset_time),
                    },
                },
                headers={
                    "Retry-After": str(int(reset_time)),
                    "X-RateLimit-Limit": str(RATE_LIMIT_REQUESTS),
                    "X-RateLimit-Remaining": str(remaining),
                    "X-RateLimit-Reset": str(int(time.time() + reset_time)),
                },
            )

        # 添加限流响应头
        response = await call_next(request)
        remaining = _rate_limiter.get_remaining(client_ip)
        response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_REQUESTS)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(time.time() + RATE_LIMIT_WINDOW_SECONDS))

        return response
