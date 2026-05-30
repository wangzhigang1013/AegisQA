"""敏感信息脱敏工具。

平台会持久化 Step 输入、输出、日志和 Context 摘要。如果这里不做统一脱敏，
API Key、密码、Bearer Token 很容易被报告页或日志泄露，所以所有进入持久化
边界的数据都应先经过本模块处理。
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


REDACTED = "***REDACTED***"

# 字段名维度的敏感关键词。使用包含判断，是为了覆盖 api_key、db_password 等常见写法。
SENSITIVE_KEYWORDS = (
    "secret",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "authorization",
    "credential",
)

SENSITIVE_EXACT_KEYS = {
    "token",
    "access_token",
    "refresh_token",
    "auth_token",
    "bearer_token",
    "session_token",
}

# 文本维度兜底：即使调用方把 Bearer Token 写进普通日志字符串，也要做基本屏蔽。
BEARER_PATTERN = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.IGNORECASE)
# 只在 token 边界匹配 OpenAI 风格密钥，避免把 task-model 这类普通词里的 "sk-" 误脱敏。
OPENAI_KEY_PATTERN = re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]+")


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    if normalized in SENSITIVE_EXACT_KEYS:
        return True
    return any(keyword in normalized for keyword in SENSITIVE_KEYWORDS)


def _redact_string(value: str) -> str:
    value = BEARER_PATTERN.sub(r"\1" + REDACTED, value)
    return OPENAI_KEY_PATTERN.sub(REDACTED, value)


def redact_secrets(payload: Any) -> Any:
    """递归脱敏任意 JSON-like 结构。

    这里返回深拷贝后的新对象，避免调用者传入的运行时 Context 被意外修改。
    """

    value = deepcopy(payload)
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if _is_sensitive_key(str(key)):
                redacted[key] = REDACTED
            else:
                redacted[key] = redact_secrets(item)
        return redacted
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secrets(item) for item in value)
    if isinstance(value, str):
        return _redact_string(value)
    return value
