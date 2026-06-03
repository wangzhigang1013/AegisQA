from __future__ import annotations

from aegisqa.quality.models import GateContext, GateEvaluationResult, GateRule, QualityCheckResult
from aegisqa.quality.rules import compare_metric, coerce_numeric_metric


class GateEvaluator:
    """Evaluate deterministic gate rules without inventing unavailable metrics."""

    def evaluate(self, context: GateContext, rules: list[GateRule]) -> GateEvaluationResult:
        checks = [self._evaluate_rule(context, rule) for rule in rules]
        blocking_failures = sum(1 for check in checks if check.status == "failed" and check.blocking)
        if blocking_failures:
            decision = "failed"
        elif checks and all(check.status == "skipped" for check in checks):
            decision = "skipped"
        else:
            decision = "passed"
        return GateEvaluationResult(
            decision=decision,
            status=decision,
            blocking_failures=blocking_failures,
            quality_checks=checks,
            target=context.target,
            summary=self._summary(decision, checks, blocking_failures),
        )

    def _evaluate_rule(self, context: GateContext, rule: GateRule) -> QualityCheckResult:
        raw_actual = context.metrics.get(rule.metric)
        actual = coerce_numeric_metric(raw_actual)
        if actual is None:
            return QualityCheckResult(
                check_id=rule.rule_id,
                title=rule.title or rule.rule_id,
                status="skipped",
                metric=rule.metric,
                operator=rule.operator,
                threshold=rule.threshold,
                blocking=rule.blocking,
                reason="metric_unavailable",
                message=f"质量门禁跳过：{rule.metric} 缺少真实指标。",
                evidence={"metric": rule.metric},
            )
        try:
            passed = compare_metric(actual, rule.operator, rule.threshold)
        except ValueError as exc:
            return QualityCheckResult(
                check_id=rule.rule_id,
                title=rule.title or rule.rule_id,
                status="skipped",
                metric=rule.metric,
                operator=rule.operator,
                threshold=rule.threshold,
                actual=actual,
                blocking=rule.blocking,
                reason="unsupported_operator",
                message=str(exc),
                evidence={"metric": rule.metric, "actual": actual},
            )
        return QualityCheckResult(
            check_id=rule.rule_id,
            title=rule.title or rule.rule_id,
            status="passed" if passed else "failed",
            metric=rule.metric,
            operator=rule.operator,
            threshold=rule.threshold,
            actual=actual,
            blocking=rule.blocking,
            message=(
                f"质量门禁通过：{rule.metric}={actual} {rule.operator} {rule.threshold}"
                if passed
                else f"质量门禁未通过：{rule.metric}={actual} 不满足 {rule.operator} {rule.threshold}"
            ),
            evidence={"metric": rule.metric, "actual": actual, "threshold": rule.threshold},
        )

    @staticmethod
    def _summary(decision: str, checks: list[QualityCheckResult], blocking_failures: int) -> str:
        if decision == "failed":
            return f"{blocking_failures} 条阻断规则未通过。"
        if decision == "skipped":
            return "质量门禁缺少真实可计算指标，已跳过。"
        passed = sum(1 for check in checks if check.status == "passed")
        skipped = sum(1 for check in checks if check.status == "skipped")
        return f"{passed} 条规则通过，{skipped} 条规则跳过。"
