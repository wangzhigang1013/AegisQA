"""Prometheus 指标模块。

提供请求率、错误率、延迟、模型 token 使用等关键指标。
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from typing import Any

logger = logging.getLogger(__name__)

# 指标存储（简化版，生产环境应使用 prometheus_client）
_metrics: dict[str, Any] = {
    "http_requests_total": defaultdict(lambda: defaultdict(int)),
    "http_request_duration_seconds": defaultdict(list),
    "http_request_errors_total": defaultdict(int),
    "model_tokens_total": defaultdict(lambda: {"prompt": 0, "completion": 0}),
    "skill_executions_total": defaultdict(lambda: {"success": 0, "failure": 0}),
    "workflow_runs_total": defaultdict(lambda: {"success": 0, "failure": 0}),
}


def record_http_request(method: str, path: str, status_code: int, duration_seconds: float) -> None:
    """记录 HTTP 请求指标。"""
    _metrics["http_requests_total"][method][status_code] += 1
    _metrics["http_request_duration_seconds"][f"{method} {path}"].append(duration_seconds)

    if status_code >= 400:
        _metrics["http_request_errors_total"][f"{method} {path}"] += 1


def record_model_tokens(model: str, prompt_tokens: int, completion_tokens: int) -> None:
    """记录模型 token 使用。"""
    _metrics["model_tokens_total"][model]["prompt"] += prompt_tokens
    _metrics["model_tokens_total"][model]["completion"] += completion_tokens


def record_skill_execution(skill_id: str, success: bool) -> None:
    """记录 Skill 执行结果。"""
    key = "success" if success else "failure"
    _metrics["skill_executions_total"][skill_id][key] += 1


def record_workflow_run(workflow_id: str, success: bool) -> None:
    """记录 Workflow 运行结果。"""
    key = "success" if success else "failure"
    _metrics["workflow_runs_total"][workflow_id][key] += 1


def get_metrics_summary() -> dict[str, Any]:
    """获取指标摘要。"""
    summary: dict[str, Any] = {}

    # HTTP 请求统计
    total_requests = sum(
        count
        for method_counts in _metrics["http_requests_total"].values()
        for count in method_counts.values()
    )
    total_errors = sum(_metrics["http_request_errors_total"].values())

    summary["http"] = {
        "total_requests": total_requests,
        "total_errors": total_errors,
        "error_rate": total_errors / total_requests if total_requests > 0 else 0,
    }

    # 延迟统计
    all_durations = []
    for durations in _metrics["http_request_duration_seconds"].values():
        all_durations.extend(durations)

    if all_durations:
        all_durations.sort()
        n = len(all_durations)
        summary["latency"] = {
            "count": n,
            "mean_ms": sum(all_durations) / n * 1000,
            "p50_ms": all_durations[n // 2] * 1000,
            "p95_ms": all_durations[int(n * 0.95)] * 1000,
            "p99_ms": all_durations[int(n * 0.99)] * 1000,
        }

    # 模型 token 统计
    total_prompt = sum(v["prompt"] for v in _metrics["model_tokens_total"].values())
    total_completion = sum(v["completion"] for v in _metrics["model_tokens_total"].values())
    summary["model_tokens"] = {
        "total_prompt": total_prompt,
        "total_completion": total_completion,
        "total": total_prompt + total_completion,
    }

    # Skill 执行统计
    summary["skill_executions"] = dict(_metrics["skill_executions_total"])

    # Workflow 运行统计
    summary["workflow_runs"] = dict(_metrics["workflow_runs_total"])

    return summary


def get_prometheus_format() -> str:
    """导出 Prometheus 格式指标。"""
    lines: list[str] = []

    # HTTP 请求计数
    lines.append("# HELP http_requests_total Total HTTP requests")
    lines.append("# TYPE http_requests_total counter")
    for method, status_counts in _metrics["http_requests_total"].items():
        for status, count in status_counts.items():
            lines.append(f'http_requests_total{{method="{method}",status="{status}"}} {count}')

    # HTTP 错误计数
    lines.append("# HELP http_request_errors_total Total HTTP request errors")
    lines.append("# TYPE http_request_errors_total counter")
    for endpoint, count in _metrics["http_request_errors_total"].items():
        lines.append(f'http_request_errors_total{{endpoint="{endpoint}"}} {count}')

    # 模型 token 使用
    lines.append("# HELP model_tokens_total Total model tokens used")
    lines.append("# TYPE model_tokens_total counter")
    for model, tokens in _metrics["model_tokens_total"].items():
        lines.append(f'model_tokens_total{{model="{model}",type="prompt"}} {tokens["prompt"]}')
        lines.append(f'model_tokens_total{{model="{model}",type="completion"}} {tokens["completion"]}')

    # Skill 执行统计
    lines.append("# HELP skill_executions_total Total skill executions")
    lines.append("# TYPE skill_executions_total counter")
    for skill_id, counts in _metrics["skill_executions_total"].items():
        lines.append(f'skill_executions_total{{skill_id="{skill_id}",result="success"}} {counts["success"]}')
        lines.append(f'skill_executions_total{{skill_id="{skill_id}",result="failure"}} {counts["failure"]}')

    # Workflow 运行统计
    lines.append("# HELP workflow_runs_total Total workflow runs")
    lines.append("# TYPE workflow_runs_total counter")
    for workflow_id, counts in _metrics["workflow_runs_total"].items():
        lines.append(f'workflow_runs_total{{workflow_id="{workflow_id}",result="success"}} {counts["success"]}')
        lines.append(f'workflow_runs_total{{workflow_id="{workflow_id}",result="failure"}} {counts["failure"]}')

    return "\n".join(lines) + "\n"


def reset_metrics() -> None:
    """重置所有指标（用于测试）。"""
    _metrics["http_requests_total"].clear()
    _metrics["http_request_duration_seconds"].clear()
    _metrics["http_request_errors_total"].clear()
    _metrics["model_tokens_total"].clear()
    _metrics["skill_executions_total"].clear()
    _metrics["workflow_runs_total"].clear()
