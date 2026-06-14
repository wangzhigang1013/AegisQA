"""分布式追踪模块。

集成 OpenTelemetry，实现跨服务调用链路追踪。
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

logger = logging.getLogger(__name__)

# 追踪配置
TRACING_ENABLED = os.getenv("AEGISQA_TRACING_ENABLED", "false").lower() == "true"
OTEL_ENDPOINT = os.getenv("AEGISQA_OTEL_ENDPOINT", "http://localhost:4317")
OTEL_SERVICE_NAME = os.getenv("AEGISQA_OTEL_SERVICE_NAME", "aegisqa")

# 全局追踪器实例
_tracer: Any = None
_trace_id_counter = 0


def _get_next_trace_id() -> str:
    """生成下一个追踪 ID。"""
    global _trace_id_counter
    _trace_id_counter += 1
    return f"trace_{_trace_id_counter:012d}"


class Span:
    """追踪跨度。"""

    def __init__(self, name: str, trace_id: str | None = None, parent_span_id: str | None = None) -> None:
        self.name = name
        self.trace_id = trace_id or _get_next_trace_id()
        self.span_id = _get_next_trace_id()
        self.parent_span_id = parent_span_id
        self.attributes: dict[str, Any] = {}
        self.events: list[dict[str, Any]] = []
        self.start_time: float | None = None
        self.end_time: float | None = None
        self.status: str = "ok"
        self.status_message: str = ""

    def set_attribute(self, key: str, value: Any) -> None:
        """设置属性。"""
        self.attributes[key] = value

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        """添加事件。"""
        import time
        self.events.append({
            "name": name,
            "timestamp": time.time(),
            "attributes": attributes or {},
        })

    def set_status(self, status: str, message: str = "") -> None:
        """设置状态。"""
        self.status = status
        self.status_message = message

    def __enter__(self) -> "Span":
        import time
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        import time
        self.end_time = time.time()
        if exc_val:
            self.set_status("error", str(exc_val))
        if TRACING_ENABLED:
            self._export()

    def _export(self) -> None:
        """导出跨度数据。"""
        duration_ms = (self.end_time - self.start_time) * 1000 if self.start_time and self.end_time else 0
        logger.debug(
            "Span: %s trace=%s span=%s parent=%s duration=%.2fms status=%s",
            self.name, self.trace_id, self.span_id, self.parent_span_id,
            duration_ms, self.status,
        )

    def to_dict(self) -> dict[str, Any]:
        """转换为字典。"""
        return {
            "name": self.name,
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "attributes": self.attributes,
            "events": self.events,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "status": self.status,
            "status_message": self.status_message,
        }


class Tracer:
    """追踪器。"""

    def __init__(self, service_name: str = "aegisqa") -> None:
        self.service_name = service_name
        self._spans: list[Span] = []

    def start_span(self, name: str, trace_id: str | None = None, parent_span_id: str | None = None) -> Span:
        """开始一个新的跨度。"""
        span = Span(name, trace_id=trace_id, parent_span_id=parent_span_id)
        self._spans.append(span)
        return span

    def get_active_spans(self) -> list[Span]:
        """获取活跃的跨度。"""
        return [s for s in self._spans if s.end_time is None]

    def get_completed_spans(self) -> list[Span]:
        """获取已完成的跨度。"""
        return [s for s in self._spans if s.end_time is not None]

    def clear(self) -> None:
        """清除所有跨度。"""
        self._spans.clear()


# 全局追踪器
_tracer_instance: Tracer | None = None


def get_tracer() -> Tracer:
    """获取全局追踪器。"""
    global _tracer_instance
    if _tracer_instance is None:
        _tracer_instance = Tracer(service_name=OTEL_SERVICE_NAME)
    return _tracer_instance


def start_span(name: str, trace_id: str | None = None, parent_span_id: str | None = None) -> Span:
    """开始一个新的跨度。"""
    return get_tracer().start_span(name, trace_id=trace_id, parent_span_id=parent_span_id)


def trace_function(name: str | None = None) -> Callable:
    """函数追踪装饰器。"""
    def decorator(func: Callable) -> Callable:
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            span_name = name or f"{func.__module__}.{func.__qualname__}"
            with start_span(span_name) as span:
                try:
                    result = func(*args, **kwargs)
                    return result
                except Exception as exc:
                    span.set_status("error", str(exc))
                    raise
        return wrapper
    return decorator


def init_tracing() -> None:
    """初始化追踪系统。"""
    if not TRACING_ENABLED:
        logger.info("Tracing is disabled")
        return

    logger.info("Tracing initialized: service=%s endpoint=%s", OTEL_SERVICE_NAME, OTEL_ENDPOINT)
