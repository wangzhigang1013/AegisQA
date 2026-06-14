"""认证中间件。

从 JWT token 中提取用户信息，注入到请求上下文。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from aegisqa.security.auth import verify_token

logger = logging.getLogger(__name__)

# 不需要认证的路径
PUBLIC_PATHS = {
    "/",
    "/health",
    "/healthz",
    "/readyz",
    "/features",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/auth/login",
    "/auth/refresh",
}


def _is_public_path(path: str) -> bool:
    """检查路径是否为公开路径。"""
    if path in PUBLIC_PATHS:
        return True
    # 静态资源
    if path.startswith("/static") or path.startswith("/assets"):
        return True
    # OpenAPI 文档
    if path.startswith("/docs") or path.startswith("/redoc"):
        return True
    return False


class AuthenticationMiddleware(BaseHTTPMiddleware):
    """JWT 认证中间件。

    从 Authorization header 中提取 JWT token，验证后将用户信息注入到 request.state。
    对于公开路径，跳过认证。
    """

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        # 公开路径跳过认证
        if _is_public_path(request.url.path):
            request.state.user = None
            return await call_next(request)

        # 提取 token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            request.state.user = None
            # 允许无认证访问（向后兼容），但标记为未认证
            return await call_next(request)

        token = auth_header[7:]
        payload = verify_token(token)

        if payload:
            request.state.user = {
                "user_id": payload.user_id,
                "username": payload.username,
                "role": payload.role,
                "display_name": payload.display_name,
            }
        else:
            request.state.user = None
            # token 无效但不阻止访问（向后兼容）
            logger.debug("Invalid JWT token, proceeding without auth context")

        return await call_next(request)


def get_current_user(request: Request) -> dict[str, Any] | None:
    """从请求中获取当前用户信息。"""
    return getattr(request.state, "user", None)


def require_authenticated(request: Request) -> dict[str, Any]:
    """要求用户已认证，否则抛出 401。"""
    user = get_current_user(request)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="需要登录才能访问此资源")
    return user
