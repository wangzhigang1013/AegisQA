"""限速管理器。

本地默认使用内存限速；生产多 worker 模式可以切换到 Redis token bucket。
两种实现都只返回应等待时间，不主动 sleep，执行器负责把等待证据写入 Step trace。
"""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from time import monotonic, time
from typing import Any, Callable, Protocol


@dataclass
class RateLimitDecision:
    """一次限速判断的结果。"""

    wait_ms: float = 0.0
    rate_limited_count: int = 0


class RateLimiter(Protocol):
    def acquire(self, skill_ref: str) -> RateLimitDecision: ...


@dataclass
class InMemoryRateLimiter:
    """按 Skill 维度做简单 QPS 平滑。

    为了让测试和演示不变慢，默认只计算应等待时间，不真正 sleep。生产环境可在
    `acquire` 后由 Worker 按 wait_ms 进行等待或延迟派发。
    """

    qps_by_skill: dict[str, float] = field(default_factory=dict)
    _next_allowed_at: dict[str, float] = field(default_factory=dict)

    def acquire(self, skill_ref: str) -> RateLimitDecision:
        qps = self.qps_by_skill.get(skill_ref)
        if not qps or qps <= 0:
            return RateLimitDecision()

        now = monotonic()
        min_interval = 1.0 / qps
        next_allowed = self._next_allowed_at.get(skill_ref, now)
        if now < next_allowed:
            wait_ms = (next_allowed - now) * 1000
            self._next_allowed_at[skill_ref] = next_allowed + min_interval
            return RateLimitDecision(wait_ms=wait_ms, rate_limited_count=1)

        self._next_allowed_at[skill_ref] = now + min_interval
        return RateLimitDecision()


class RedisRateLimiter:
    """基于 Redis 的跨 worker token bucket。

    Lua 脚本把“读取当前 next_allowed、计算等待、写回下一次可用时间”放到 Redis
    单条命令里完成，避免多个 worker 同时调用同一 Skill 时绕过 QPS 限制。
    """

    _ACQUIRE_SCRIPT = """
    local key = KEYS[1]
    local now_ms = tonumber(ARGV[1])
    local interval_ms = tonumber(ARGV[2])
    local ttl_ms = tonumber(ARGV[3])
    local current = tonumber(redis.call('GET', key) or now_ms)
    local wait_ms = 0
    local next_allowed = 0
    if now_ms < current then
      wait_ms = current - now_ms
      next_allowed = current + interval_ms
    else
      next_allowed = now_ms + interval_ms
    end
    redis.call('SET', key, next_allowed, 'PX', ttl_ms)
    return {wait_ms, next_allowed}
    """

    def __init__(
        self,
        qps_by_skill: dict[str, float] | None = None,
        *,
        redis_client: Any | None = None,
        redis_url: str | None = None,
        key_prefix: str = "aegisqa:rate-limit",
        clock: Callable[[], float] = time,
    ) -> None:
        self.qps_by_skill = qps_by_skill or {}
        self.redis_client = redis_client or _redis_client_from_url(redis_url)
        self.key_prefix = key_prefix.rstrip(":")
        self.clock = clock

    def acquire(self, skill_ref: str) -> RateLimitDecision:
        qps = self.qps_by_skill.get(skill_ref)
        if not qps or qps <= 0:
            return RateLimitDecision()

        now_ms = self.clock() * 1000
        interval_ms = 1000.0 / float(qps)
        ttl_ms = max(60_000, int(interval_ms * 10))
        key = f"{self.key_prefix}:{skill_ref}"
        result = self.redis_client.eval(self._ACQUIRE_SCRIPT, 1, key, now_ms, interval_ms, ttl_ms)
        wait_ms = float(result[0]) if result else 0.0
        return RateLimitDecision(wait_ms=wait_ms, rate_limited_count=1 if wait_ms > 0 else 0)


def create_rate_limiter(
    qps_by_skill: dict[str, float] | None = None,
    *,
    backend: str | None = None,
    redis_client: Any | None = None,
    redis_url: str | None = None,
) -> RateLimiter:
    resolved_backend = (backend or os.getenv("AEGISQA_RATE_LIMIT_BACKEND") or "memory").lower()
    if resolved_backend in {"memory", "local", "in_memory"}:
        return InMemoryRateLimiter(qps_by_skill=qps_by_skill or {})
    if resolved_backend == "redis":
        return RedisRateLimiter(qps_by_skill or {}, redis_client=redis_client, redis_url=redis_url)
    raise ValueError(f"不支持的限流后端：{resolved_backend}")


def _redis_client_from_url(redis_url: str | None = None) -> Any:
    try:
        import redis
    except ImportError as exc:  # pragma: no cover - 只有启用 Redis 后端但未安装依赖时触发。
        raise RuntimeError("Redis 限流后端需要安装 redis：pip install redis") from exc
    url = redis_url or os.getenv("AEGISQA_REDIS_URL") or os.getenv("CELERY_BROKER_URL") or "redis://127.0.0.1:6379/0"
    return redis.Redis.from_url(url)
