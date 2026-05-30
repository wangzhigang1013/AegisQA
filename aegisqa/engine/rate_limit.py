"""限速管理器。

MVP 不依赖 Redis/Celery，但仍然把“并发不等于外部 API QPS”的规则固化在接口中。
后续接入 Redis 信号量或 Celery rate_limit 时，只需要替换本模块实现。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from time import monotonic


@dataclass
class RateLimitDecision:
    """一次限速判断的结果。"""

    wait_ms: float = 0.0
    rate_limited_count: int = 0


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

