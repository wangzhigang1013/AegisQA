"""A/B 测试统计检验模块。

支持 t-test、chi-squared 和 Mann-Whitney U 检验。
"""

from __future__ import annotations

import math
from typing import Any
from pydantic import BaseModel, Field


class StatisticalTestResult(BaseModel):
    """统计检验结果。"""
    test_name: str
    metric_name: str
    group_a_name: str
    group_b_name: str
    group_a_mean: float
    group_b_mean: float
    group_a_std: float = 0.0
    group_b_std: float = 0.0
    group_a_n: int
    group_b_n: int
    statistic: float
    p_value: float
    effect_size: float = 0.0
    confidence_interval: tuple[float, float] = (0.0, 0.0)
    is_significant: bool
    significance_level: float = 0.05
    recommendation: str = ""


def t_test(
    group_a: list[float],
    group_b: list[float],
    metric_name: str = "score",
    group_a_name: str = "A",
    group_b_name: str = "B",
    significance_level: float = 0.05,
) -> StatisticalTestResult:
    """独立样本 t 检验。

    Args:
        group_a: A 组数据。
        group_b: B 组数据。
        metric_name: 指标名称。
        group_a_name: A 组名称。
        group_b_name: B 组名称。
        significance_level: 显著性水平。

    Returns:
        统计检验结果。
    """
    n_a = len(group_a)
    n_b = len(group_b)

    if n_a < 2 or n_b < 2:
        return StatisticalTestResult(
            test_name="t-test",
            metric_name=metric_name,
            group_a_name=group_a_name,
            group_b_name=group_b_name,
            group_a_mean=sum(group_a) / n_a if n_a > 0 else 0.0,
            group_b_mean=sum(group_b) / n_b if n_b > 0 else 0.0,
            group_a_n=n_a,
            group_b_n=n_b,
            statistic=0.0,
            p_value=1.0,
            is_significant=False,
            significance_level=significance_level,
            recommendation="样本量不足，无法进行 t 检验。",
        )

    mean_a = sum(group_a) / n_a
    mean_b = sum(group_b) / n_b
    var_a = sum((x - mean_a) ** 2 for x in group_a) / (n_a - 1)
    var_b = sum((x - mean_b) ** 2 for x in group_b) / (n_b - 1)
    std_a = math.sqrt(var_a)
    std_b = math.sqrt(var_b)

    # Welch's t-test
    se = math.sqrt(var_a / n_a + var_b / n_b)
    t_stat = (mean_a - mean_b) / se if se > 0 else 0.0

    # 自由度（Welch-Satterthwaite 方程）
    numerator = (var_a / n_a + var_b / n_b) ** 2
    denominator = ((var_a / n_a) ** 2 / (n_a - 1)) + ((var_b / n_b) ** 2 / (n_b - 1))
    df = numerator / denominator if denominator > 0 else 1.0

    # 近似 p 值（使用正态近似）
    p_value = _t_to_p(abs(t_stat), df)

    # 效应量（Cohen's d）
    pooled_std = math.sqrt(((n_a - 1) * var_a + (n_b - 1) * var_b) / (n_a + n_b - 2))
    effect_size = (mean_a - mean_b) / pooled_std if pooled_std > 0 else 0.0

    # 置信区间
    t_crit = _t_quantile(1 - significance_level / 2, df)
    ci_lower = (mean_a - mean_b) - t_crit * se
    ci_upper = (mean_a - mean_b) + t_crit * se

    is_significant = p_value < significance_level

    # 推荐
    if is_significant:
        if mean_a > mean_b:
            recommendation = f"{group_a_name} 显著优于 {group_b_name}（p={p_value:.4f}）。"
        else:
            recommendation = f"{group_b_name} 显著优于 {group_a_name}（p={p_value:.4f}）。"
    else:
        recommendation = f"两组无显著差异（p={p_value:.4f}）。"

    return StatisticalTestResult(
        test_name="t-test",
        metric_name=metric_name,
        group_a_name=group_a_name,
        group_b_name=group_b_name,
        group_a_mean=mean_a,
        group_b_mean=mean_b,
        group_a_std=std_a,
        group_b_std=std_b,
        group_a_n=n_a,
        group_b_n=n_b,
        statistic=t_stat,
        p_value=p_value,
        effect_size=effect_size,
        confidence_interval=(ci_lower, ci_upper),
        is_significant=is_significant,
        significance_level=significance_level,
        recommendation=recommendation,
    )


def chi_squared_test(
    observed_a: dict[str, int],
    observed_b: dict[str, int],
    metric_name: str = "distribution",
    group_a_name: str = "A",
    group_b_name: str = "B",
    significance_level: float = 0.05,
) -> StatisticalTestResult:
    """卡方检验。

    Args:
        observed_a: A 组观测频数。
        observed_b: B 组观测频数。
        metric_name: 指标名称。
        group_a_name: A 组名称。
        group_b_name: B 组名称。
        significance_level: 显著性水平。

    Returns:
        统计检验结果。
    """
    # 合并所有类别
    all_categories = sorted(set(list(observed_a.keys()) + list(observed_b.keys())))

    total_a = sum(observed_a.values())
    total_b = sum(observed_b.values())
    total = total_a + total_b

    if total == 0:
        return StatisticalTestResult(
            test_name="chi-squared",
            metric_name=metric_name,
            group_a_name=group_a_name,
            group_b_name=group_b_name,
            group_a_mean=0.0,
            group_b_mean=0.0,
            group_a_n=0,
            group_b_n=0,
            statistic=0.0,
            p_value=1.0,
            is_significant=False,
            significance_level=significance_level,
            recommendation="数据为空，无法进行卡方检验。",
        )

    # 计算卡方统计量
    chi2 = 0.0
    for cat in all_categories:
        o_a = observed_a.get(cat, 0)
        o_b = observed_b.get(cat, 0)
        # 期望频数
        row_total = o_a + o_b
        e_a = row_total * total_a / total if total > 0 else 0
        e_b = row_total * total_b / total if total > 0 else 0

        if e_a > 0:
            chi2 += (o_a - e_a) ** 2 / e_a
        if e_b > 0:
            chi2 += (o_b - e_b) ** 2 / e_b

    # 自由度
    df = len(all_categories) - 1

    # 近似 p 值
    p_value = _chi2_to_p(chi2, df)

    # 效应量（Cramér's V）
    effect_size = math.sqrt(chi2 / total) if total > 0 else 0.0

    is_significant = p_value < significance_level

    # 推荐
    if is_significant:
        recommendation = f"两组分布存在显著差异（p={p_value:.4f}）。"
    else:
        recommendation = f"两组分布无显著差异（p={p_value:.4f}）。"

    return StatisticalTestResult(
        test_name="chi-squared",
        metric_name=metric_name,
        group_a_name=group_a_name,
        group_b_name=group_b_name,
        group_a_mean=total_a / len(all_categories) if all_categories else 0.0,
        group_b_mean=total_b / len(all_categories) if all_categories else 0.0,
        group_a_n=total_a,
        group_b_n=total_b,
        statistic=chi2,
        p_value=p_value,
        effect_size=effect_size,
        confidence_interval=(0.0, 0.0),
        is_significant=is_significant,
        significance_level=significance_level,
        recommendation=recommendation,
    )


def mann_whitney_u(
    group_a: list[float],
    group_b: list[float],
    metric_name: str = "score",
    group_a_name: str = "A",
    group_b_name: str = "B",
    significance_level: float = 0.05,
) -> StatisticalTestResult:
    """Mann-Whitney U 检验。

    Args:
        group_a: A 组数据。
        group_b: B 组数据。
        metric_name: 指标名称。
        group_a_name: A 组名称。
        group_b_name: B 组名称。
        significance_level: 显著性水平。

    Returns:
        统计检验结果。
    """
    n_a = len(group_a)
    n_b = len(group_b)

    if n_a == 0 or n_b == 0:
        return StatisticalTestResult(
            test_name="mann-whitney-u",
            metric_name=metric_name,
            group_a_name=group_a_name,
            group_b_name=group_b_name,
            group_a_mean=sum(group_a) / n_a if n_a > 0 else 0.0,
            group_b_mean=sum(group_b) / n_b if n_b > 0 else 0.0,
            group_a_n=n_a,
            group_b_n=n_b,
            statistic=0.0,
            p_value=1.0,
            is_significant=False,
            significance_level=significance_level,
            recommendation="样本量不足，无法进行 Mann-Whitney U 检验。",
        )

    mean_a = sum(group_a) / n_a
    mean_b = sum(group_b) / n_b

    # 计算 U 统计量
    u_a = 0.0
    for a in group_a:
        for b in group_b:
            if a > b:
                u_a += 1.0
            elif a == b:
                u_a += 0.5
    u_b = n_a * n_b - u_a
    u_stat = min(u_a, u_b)

    # 正态近似
    mu_u = n_a * n_b / 2
    sigma_u = math.sqrt(n_a * n_b * (n_a + n_b + 1) / 12)
    z = (u_stat - mu_u) / sigma_u if sigma_u > 0 else 0.0

    # 近似 p 值
    p_value = 2 * (1 - _norm_cdf(abs(z)))

    # 效应量（r = Z / sqrt(N)）
    effect_size = abs(z) / math.sqrt(n_a + n_b) if (n_a + n_b) > 0 else 0.0

    is_significant = p_value < significance_level

    if is_significant:
        if mean_a > mean_b:
            recommendation = f"{group_a_name} 显著优于 {group_b_name}（p={p_value:.4f}）。"
        else:
            recommendation = f"{group_b_name} 显著优于 {group_a_name}（p={p_value:.4f}）。"
    else:
        recommendation = f"两组无显著差异（p={p_value:.4f}）。"

    return StatisticalTestResult(
        test_name="mann-whitney-u",
        metric_name=metric_name,
        group_a_name=group_a_name,
        group_b_name=group_b_name,
        group_a_mean=mean_a,
        group_b_mean=mean_b,
        group_a_n=n_a,
        group_b_n=n_b,
        statistic=u_stat,
        p_value=p_value,
        effect_size=effect_size,
        confidence_interval=(0.0, 0.0),
        is_significant=is_significant,
        significance_level=significance_level,
        recommendation=recommendation,
    )


# 辅助函数

def _norm_cdf(x: float) -> float:
    """标准正态分布累积分布函数（近似）。"""
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _t_to_p(t: float, df: float) -> float:
    """t 统计量转 p 值（近似）。"""
    # 使用正态近似
    z = t * math.sqrt(df / (df - 2)) if df > 2 else t
    return 2 * (1 - _norm_cdf(abs(z)))


def _t_quantile(p: float, df: float) -> float:
    """t 分布分位数（近似）。"""
    # 使用正态近似
    z = _norm_quantile(p)
    return z * math.sqrt(df / (df - 2)) if df > 2 else z


def _norm_quantile(p: float) -> float:
    """标准正态分布分位数（近似）。"""
    if p <= 0:
        return float('-inf')
    if p >= 1:
        return float('inf')
    # 使用 Rational Approximation
    if p < 0.5:
        return -_rational_approx(math.sqrt(-2 * math.log(p)))
    return _rational_approx(math.sqrt(-2 * math.log(1 - p)))


def _rational_approx(t: float) -> float:
    """有理近似辅助函数。"""
    c0, c1, c2 = 2.515517, 0.802853, 0.010328
    d1, d2, d3 = 1.432788, 0.189269, 0.001308
    return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t)


def _chi2_to_p(chi2: float, df: int) -> float:
    """卡方统计量转 p 值（近似）。"""
    if df <= 0:
        return 1.0
    # 使用正态近似
    z = math.sqrt(2 * chi2) - math.sqrt(2 * df - 1)
    return 1 - _norm_cdf(z)


class ExperimentRecommendation(BaseModel):
    """实验推荐结果。"""
    recommended_group: str
    confidence: str  # high / medium / low
    reason: str
    metrics_summary: list[dict[str, Any]] = Field(default_factory=list)


def recommend_optimal_config(
    results: list[StatisticalTestResult],
    group_a_name: str = "A",
    group_b_name: str = "B",
) -> ExperimentRecommendation:
    """基于多个统计检验结果推荐最优配置。

    Args:
        results: 多个指标的统计检验结果。
        group_a_name: A 组名称。
        group_b_name: B 组名称。

    Returns:
        推荐结果。
    """
    if not results:
        return ExperimentRecommendation(
            recommended_group="unknown",
            confidence="low",
            reason="无检验结果，无法推荐。",
        )

    significant_results = [r for r in results if r.is_significant]
    a_wins = sum(1 for r in significant_results if r.group_a_mean > r.group_b_mean)
    b_wins = sum(1 for r in significant_results if r.group_b_mean > r.group_a_mean)

    metrics_summary = []
    for r in results:
        better = r.group_a_name if r.group_a_mean > r.group_b_mean else r.group_b_name
        metrics_summary.append({
            "metric": r.metric_name,
            "group_a_mean": r.group_a_mean,
            "group_b_mean": r.group_b_mean,
            "is_significant": r.is_significant,
            "p_value": r.p_value,
            "better_group": better,
        })

    if not significant_results:
        return ExperimentRecommendation(
            recommended_group="none",
            confidence="low",
            reason="所有指标均无显著差异，建议保持当前配置或增加样本量。",
            metrics_summary=metrics_summary,
        )

    total_significant = len(significant_results)
    win_rate = max(a_wins, b_wins) / total_significant if total_significant > 0 else 0

    if win_rate >= 0.8:
        confidence = "high"
    elif win_rate >= 0.6:
        confidence = "medium"
    else:
        confidence = "low"

    if a_wins > b_wins:
        recommended = group_a_name
        reason = f"{group_a_name} 在 {a_wins}/{total_significant} 个显著指标上优于 {group_b_name}。"
    elif b_wins > a_wins:
        recommended = group_b_name
        reason = f"{group_b_name} 在 {b_wins}/{total_significant} 个显著指标上优于 {group_a_name}。"
    else:
        recommended = "tie"
        reason = f"两组各在 {a_wins} 个指标上胜出，无明显优劣。"

    return ExperimentRecommendation(
        recommended_group=recommended,
        confidence=confidence,
        reason=reason,
        metrics_summary=metrics_summary,
    )
