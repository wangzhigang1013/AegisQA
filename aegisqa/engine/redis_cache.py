"""Redis 缓存模块。

提供 Redis 缓存实现，支持跨 Worker 共享。
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Redis 配置
REDIS_URL = os.getenv("AEGISQA_REDIS_URL", "redis://localhost:6379/0")
CACHE_KEY_PREFIX = os.getenv("AEGISQA_CACHE_PREFIX", "aegisqa:cache:")


class RedisCache:
    """Redis 缓存实现。"""

    def __init__(self, redis_url: str = REDIS_URL, prefix: str = CACHE_KEY_PREFIX) -> None:
        self._redis_url = redis_url
        self._prefix = prefix
        self._client = None
        self._connected = False

    def _ensure_connected(self) -> bool:
        """确保 Redis 连接。"""
        if self._connected and self._client:
            return True

        try:
            import redis
            self._client = redis.Redis.from_url(
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            # 测试连接
            self._client.ping()
            self._connected = True
            logger.info("Redis cache connected: %s", self._redis_url)
            return True
        except Exception as exc:
            logger.warning("Redis cache connection failed: %s", exc)
            self._connected = False
            return False

    def _make_key(self, key: str) -> str:
        """生成完整的 Redis key。"""
        return f"{self._prefix}{key}"

    def get(self, key: str) -> Any | None:
        """获取缓存值。"""
        if not self._ensure_connected():
            return None

        try:
            full_key = self._make_key(key)
            value = self._client.get(full_key)
            if value is None:
                return None
            return json.loads(value)
        except Exception as exc:
            logger.warning("Redis cache get failed for key %s: %s", key, exc)
            return None

    def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> bool:
        """设置缓存值。"""
        if not self._ensure_connected():
            return False

        try:
            full_key = self._make_key(key)
            serialized = json.dumps(value, ensure_ascii=False, default=str)
            self._client.setex(full_key, ttl_seconds, serialized)
            return True
        except Exception as exc:
            logger.warning("Redis cache set failed for key %s: %s", key, exc)
            return False

    def delete(self, key: str) -> bool:
        """删除缓存值。"""
        if not self._ensure_connected():
            return False

        try:
            full_key = self._make_key(key)
            self._client.delete(full_key)
            return True
        except Exception as exc:
            logger.warning("Redis cache delete failed for key %s: %s", key, exc)
            return False

    def exists(self, key: str) -> bool:
        """检查 key 是否存在。"""
        if not self._ensure_connected():
            return False

        try:
            full_key = self._make_key(key)
            return bool(self._client.exists(full_key))
        except Exception as exc:
            logger.warning("Redis cache exists check failed for key %s: %s", key, exc)
            return False

    def clear_prefix(self, prefix: str = "") -> int:
        """清除指定前缀的所有 key。"""
        if not self._ensure_connected():
            return 0

        try:
            pattern = f"{self._prefix}{prefix}*"
            keys = self._client.keys(pattern)
            if keys:
                return self._client.delete(*keys)
            return 0
        except Exception as exc:
            logger.warning("Redis cache clear_prefix failed: %s", exc)
            return 0

    def clear_all(self) -> int:
        """清除所有缓存。"""
        return self.clear_prefix()

    def get_stats(self) -> dict[str, Any]:
        """获取缓存统计信息。"""
        if not self._ensure_connected():
            return {"connected": False, "error": "Not connected"}

        try:
            info = self._client.info("memory")
            keys_count = self._client.dbsize()
            return {
                "connected": True,
                "keys_count": keys_count,
                "used_memory_mb": round(info.get("used_memory", 0) / (1024 * 1024), 2),
                "used_memory_peak_mb": round(info.get("used_memory_peak", 0) / (1024 * 1024), 2),
            }
        except Exception as exc:
            logger.warning("Redis cache stats failed: %s", exc)
            return {"connected": False, "error": str(exc)}


class HybridCache:
    """混合缓存：内存 + Redis。

    优先使用内存缓存，Redis 作为共享缓存层。
    """

    def __init__(self, redis_cache: RedisCache | None = None, ttl_seconds: int = 3600) -> None:
        self._memory_cache: dict[str, dict[str, Any]] = {}
        self._memory_timestamps: dict[str, float] = {}
        self._redis_cache = redis_cache
        self._ttl_seconds = ttl_seconds

    def get(self, key: str) -> Any | None:
        """获取缓存值。"""
        import time

        # 先检查内存缓存
        if key in self._memory_cache:
            timestamp = self._memory_timestamps.get(key, 0)
            if time.time() - timestamp < self._ttl_seconds:
                return self._memory_cache[key]
            # 过期，删除
            del self._memory_cache[key]
            del self._memory_timestamps[key]

        # 尝试从 Redis 获取
        if self._redis_cache:
            value = self._redis_cache.get(key)
            if value is not None:
                # 写入内存缓存
                self._memory_cache[key] = value
                self._memory_timestamps[key] = time.time()
                return value

        return None

    def set(self, key: str, value: Any, ttl_seconds: int | None = None) -> bool:
        """设置缓存值。"""
        import time

        ttl = ttl_seconds or self._ttl_seconds

        # 写入内存缓存
        self._memory_cache[key] = value
        self._memory_timestamps[key] = time.time()

        # 写入 Redis
        if self._redis_cache:
            return self._redis_cache.set(key, value, ttl_seconds=ttl)

        return True

    def delete(self, key: str) -> bool:
        """删除缓存值。"""
        # 从内存缓存删除
        self._memory_cache.pop(key, None)
        self._memory_timestamps.pop(key, None)

        # 从 Redis 删除
        if self._redis_cache:
            return self._redis_cache.delete(key)

        return True

    def clear_all(self) -> None:
        """清除所有缓存。"""
        self._memory_cache.clear()
        self._memory_timestamps.clear()

        if self._redis_cache:
            self._redis_cache.clear_all()

    def get_stats(self) -> dict[str, Any]:
        """获取缓存统计信息。"""
        import time

        # 清理过期的内存缓存
        expired_keys = [
            key for key, timestamp in self._memory_timestamps.items()
            if time.time() - timestamp >= self._ttl_seconds
        ]
        for key in expired_keys:
            self._memory_cache.pop(key, None)
            self._memory_timestamps.pop(key, None)

        stats = {
            "memory_cache_size": len(self._memory_cache),
            "ttl_seconds": self._ttl_seconds,
        }

        if self._redis_cache:
            stats["redis"] = self._redis_cache.get_stats()

        return stats
