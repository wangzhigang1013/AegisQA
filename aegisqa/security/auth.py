"""JWT 认证模块。

提供 JWT token 生成、验证和用户管理功能。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

# JWT 配置
JWT_SECRET = os.getenv("AEGISQA_JWT_SECRET", "aegisqa-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_SECONDS = int(os.getenv("AEGISQA_JWT_ACCESS_EXPIRE", "3600"))  # 1 hour
JWT_REFRESH_TOKEN_EXPIRE_SECONDS = int(os.getenv("AEGISQA_JWT_REFRESH_EXPIRE", "604800"))  # 7 days

# 默认用户（开发环境）
DEFAULT_USERS: dict[str, dict[str, Any]] = {
    "admin": {
        "user_id": "user-admin-001",
        "username": "admin",
        "password_hash": hashlib.sha256("admin123".encode()).hexdigest(),
        "role": "Admin",
        "display_name": "管理员",
        "enabled": True,
    },
    "evaluator": {
        "user_id": "user-evaluator-001",
        "username": "evaluator",
        "password_hash": hashlib.sha256("evaluator123".encode()).hexdigest(),
        "role": "Evaluator",
        "display_name": "评测员",
        "enabled": True,
    },
    "viewer": {
        "user_id": "user-viewer-001",
        "username": "viewer",
        "password_hash": hashlib.sha256("viewer123".encode()).hexdigest(),
        "role": "Viewer",
        "display_name": "查看者",
        "enabled": True,
    },
}


@dataclass
class TokenPayload:
    """JWT Token 载荷。"""
    user_id: str
    username: str
    role: str
    display_name: str
    exp: float
    iat: float
    jti: str


@dataclass
class AuthResult:
    """认证结果。"""
    user_id: str
    username: str
    role: str
    display_name: str


def _base64url_encode(data: bytes) -> str:
    """Base64url 编码。"""
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_decode(s: str) -> bytes:
    """Base64url 解码。"""
    import base64
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def _create_jwt(payload: dict[str, Any], secret: str) -> str:
    """创建 JWT token。"""
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    header_b64 = _base64url_encode(json.dumps(header).encode())
    payload_b64 = _base64url_encode(json.dumps(payload).encode())
    message = f"{header_b64}.{payload_b64}"
    signature = hmac.new(
        secret.encode(),
        message.encode(),
        hashlib.sha256,
    ).digest()
    signature_b64 = _base64url_encode(signature)
    return f"{message}.{signature_b64}"


def _verify_jwt(token: str, secret: str) -> dict[str, Any] | None:
    """验证 JWT token 并返回载荷。"""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header_b64, payload_b64, signature_b64 = parts
        message = f"{header_b64}.{payload_b64}"

        # 验证签名
        expected_signature = hmac.new(
            secret.encode(),
            message.encode(),
            hashlib.sha256,
        ).digest()
        actual_signature = _base64url_decode(signature_b64)

        if not hmac.compare_digest(expected_signature, actual_signature):
            logger.warning("JWT signature verification failed")
            return None

        # 解析载荷
        payload = json.loads(_base64url_decode(payload_b64))

        # 验证过期时间
        if payload.get("exp", 0) < time.time():
            logger.warning("JWT token expired")
            return None

        return payload
    except Exception as exc:
        logger.warning("JWT verification failed: %s", exc)
        return None


def create_access_token(user: dict[str, Any]) -> str:
    """创建访问令牌。"""
    now = time.time()
    payload = {
        "user_id": user["user_id"],
        "username": user["username"],
        "role": user["role"],
        "display_name": user.get("display_name", user["username"]),
        "iat": now,
        "exp": now + JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
        "jti": uuid4().hex,
        "type": "access",
    }
    return _create_jwt(payload, JWT_SECRET)


def create_refresh_token(user: dict[str, Any]) -> str:
    """创建刷新令牌。"""
    now = time.time()
    payload = {
        "user_id": user["user_id"],
        "username": user["username"],
        "iat": now,
        "exp": now + JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
        "jti": uuid4().hex,
        "type": "refresh",
    }
    return _create_jwt(payload, JWT_SECRET)


def verify_token(token: str) -> TokenPayload | None:
    """验证 token 并返回载荷。"""
    payload = _verify_jwt(token, JWT_SECRET)
    if not payload:
        return None

    return TokenPayload(
        user_id=payload.get("user_id", ""),
        username=payload.get("username", ""),
        role=payload.get("role", "Viewer"),
        display_name=payload.get("display_name", payload.get("username", "")),
        exp=payload.get("exp", 0),
        iat=payload.get("iat", 0),
        jti=payload.get("jti", ""),
    )


def authenticate_user(username: str, password: str) -> dict[str, Any] | None:
    """验证用户名密码。"""
    user = DEFAULT_USERS.get(username)
    if not user:
        return None
    if not user.get("enabled", True):
        return None
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    if not hmac.compare_digest(user["password_hash"], password_hash):
        return None
    return user


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    """根据 user_id 获取用户。"""
    for user in DEFAULT_USERS.values():
        if user["user_id"] == user_id:
            return user
    return None
