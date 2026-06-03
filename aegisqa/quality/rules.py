from __future__ import annotations

from typing import Any

from aegisqa.quality.models import GateRule


SUPPORTED_OPERATORS = {">=", ">", "<=", "<", "==", "!="}


def compare_metric(actual: float, operator: str, threshold: float) -> bool:
    if operator == ">=":
        return actual >= threshold
    if operator == ">":
        return actual > threshold
    if operator == "<=":
        return actual <= threshold
    if operator == "<":
        return actual < threshold
    if operator == "==":
        return actual == threshold
    if operator == "!=":
        return actual != threshold
    raise ValueError(f"Unsupported gate operator: {operator}")


def coerce_numeric_metric(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def build_standard_gate_rules(thresholds: dict[str, float] | None = None) -> list[GateRule]:
    values = thresholds or {}
    rules = [
        GateRule(rule_id="workflow_graph_valid", metric="workflow_graph_valid", operator="==", threshold=1.0, blocking=True, title="Workflow Graph Valid"),
        GateRule(rule_id="skill_approved", metric="skill_approved", operator="==", threshold=1.0, blocking=True, title="Skill Approved"),
        GateRule(rule_id="input_mapping_resolvable", metric="input_mapping_resolvable", operator="==", threshold=1.0, blocking=True, title="Input Mapping Resolvable"),
        GateRule(
            rule_id="skill_input_schema_compliance",
            metric="skill_input_schema_compliance",
            operator="==",
            threshold=1.0,
            blocking=True,
            title="Skill Input Schema Compliance",
        ),
        GateRule(
            rule_id="skill_output_schema_compliance",
            metric="skill_output_schema_compliance",
            operator="==",
            threshold=1.0,
            blocking=True,
            title="Skill Output Schema Compliance",
        ),
        GateRule(rule_id="step_error_rate", metric="step_error_rate", operator="<=", threshold=values.get("step_error_rate", 0.0), blocking=True, title="Step Error Rate"),
        GateRule(
            rule_id="run_item_failure_rate",
            metric="run_item_failure_rate",
            operator="<=",
            threshold=values.get("run_item_failure_rate", 0.0),
            blocking=True,
            title="RunItem Failure Rate",
        ),
        GateRule(
            rule_id="latency_threshold",
            metric="p95_latency_ms",
            operator="<=",
            threshold=values.get("p95_latency_ms", 1000.0),
            blocking=True,
            title="Latency Threshold",
        ),
        GateRule(
            rule_id="llm_json_parse_rate",
            metric="llm_json_parse_rate",
            operator=">=",
            threshold=values.get("llm_json_parse_rate", 1.0),
            blocking=True,
            title="LLM JSON Parse Rate",
        ),
        GateRule(
            rule_id="prompt_output_schema_rate",
            metric="prompt_output_schema_rate",
            operator=">=",
            threshold=values.get("prompt_output_schema_rate", 1.0),
            blocking=True,
            title="Prompt Output Schema Rate",
        ),
        GateRule(rule_id="cost_budget", metric="total_cost", operator="<=", threshold=values.get("cost_budget", 0.0), blocking=True, title="Cost Budget"),
        GateRule(
            rule_id="golden_accuracy",
            metric="golden_accuracy",
            operator=">=",
            threshold=values.get("golden_accuracy", 1.0),
            blocking=True,
            title="Golden Accuracy",
        ),
    ]
    if "cost_budget" not in values:
        return [rule for rule in rules if rule.rule_id != "cost_budget"]
    return rules
