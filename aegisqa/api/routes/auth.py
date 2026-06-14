"""认证路由。

提供登录、刷新令牌和用户信息端点。
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from aegisqa.api.routes.context import RouteContext
from aegisqa.security.auth import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    verify_token,
    get_user_by_id,
)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class UserInfo(BaseModel):
    user_id: str
    username: str
    role: str
    display_name: str


def register_auth_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.post("/auth/login")
    def login(request: LoginRequest) -> TokenResponse:
        """用户登录，返回 JWT 令牌。"""
        user = authenticate_user(request.username, request.password)
        if not user:
            raise HTTPException(status_code=401, detail="用户名或密码错误")

        access_token = create_access_token(user)
        refresh_token = create_refresh_token(user)

        ctx.audit_service.record(
            actor=user["username"],
            role=user["role"],
            action="auth.login",
            target=user["user_id"],
            detail={"username": request.username},
        )

        from aegisqa.security.auth import JWT_ACCESS_TOKEN_EXPIRE_SECONDS
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
        )

    @app.post("/auth/refresh")
    def refresh_token(request: RefreshRequest) -> TokenResponse:
        """刷新访问令牌。"""
        payload = verify_token(request.refresh_token)
        if not payload:
            raise HTTPException(status_code=401, detail="无效或过期的刷新令牌")

        user = get_user_by_id(payload.user_id)
        if not user:
            raise HTTPException(status_code=401, detail="用户不存在")

        access_token = create_access_token(user)
        refresh_token = create_refresh_token(user)

        from aegisqa.security.auth import JWT_ACCESS_TOKEN_EXPIRE_SECONDS
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
        )

    @app.get("/auth/me")
    def get_current_user(request: Request) -> UserInfo:
        """获取当前用户信息。"""
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="未提供认证令牌")

        token = auth_header[7:]
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="无效或过期的访问令牌")

        return UserInfo(
            user_id=payload.user_id,
            username=payload.username,
            role=payload.role,
            display_name=payload.display_name,
        )

    @app.get("/auth/users")
    def list_users() -> list[dict[str, Any]]:
        """列出所有用户（仅 Admin 可用）。"""
        from aegisqa.security.auth import DEFAULT_USERS
        return [
            {
                "user_id": user["user_id"],
                "username": user["username"],
                "role": user["role"],
                "display_name": user.get("display_name", user["username"]),
                "enabled": user.get("enabled", True),
            }
            for user in DEFAULT_USERS.values()
        ]
