"""实验与统计检验路由。"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from aegisqa.api.routes.context import RouteContext
from aegisqa.reports.statistical_test import t_test, chi_squared_test, mann_whitney_u


class StatisticalTestRequest(BaseModel):
    """统计检验请求。"""
    metric_name: str
    test_type: str = "t-test"  # t-test / chi-squared / mann-whitney-u
    group_a_values: list[float] = Field(default_factory=list)
    group_b_values: list[float] = Field(default_factory=list)
    group_a_distribution: dict[str, int] = Field(default_factory=dict)
    group_b_distribution: dict[str, int] = Field(default_factory=dict)
    group_a_name: str = "A"
    group_b_name: str = "B"
    significance_level: float = 0.05


def register_experiment_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/experiments")
    def list_experiments() -> list[dict[str, Any]]:
        """列出所有实验。"""
        from aegisqa.api.app import _list_records
        return _list_records(ctx.store, "experiments")

    @app.get("/experiments/{experiment_id}")
    def get_experiment(experiment_id: str) -> dict[str, Any]:
        """获取实验详情。"""
        from aegisqa.api.app import _find_record
        record = _find_record(ctx.store, "experiments", experiment_id)
        if not record:
            raise HTTPException(status_code=404, detail=f"实验 {experiment_id} 不存在")
        return record

    @app.post("/experiments/statistical-test")
    def run_statistical_test(request: StatisticalTestRequest) -> dict[str, Any]:
        """运行统计检验。"""
        if request.test_type == "t-test":
            if len(request.group_a_values) < 2 or len(request.group_b_values) < 2:
                raise HTTPException(status_code=400, detail="t-test 需要每组至少 2 个样本")
            result = t_test(
                group_a=request.group_a_values,
                group_b=request.group_b_values,
                metric_name=request.metric_name,
                group_a_name=request.group_a_name,
                group_b_name=request.group_b_name,
                significance_level=request.significance_level,
            )
        elif request.test_type == "chi-squared":
            if not request.group_a_distribution or not request.group_b_distribution:
                raise HTTPException(status_code=400, detail="chi-squared 需要分布数据")
            result = chi_squared_test(
                observed_a=request.group_a_distribution,
                observed_b=request.group_b_distribution,
                metric_name=request.metric_name,
                group_a_name=request.group_a_name,
                group_b_name=request.group_b_name,
                significance_level=request.significance_level,
            )
        elif request.test_type == "mann-whitney-u":
            if len(request.group_a_values) < 1 or len(request.group_b_values) < 1:
                raise HTTPException(status_code=400, detail="mann-whitney-u 需要每组至少 1 个样本")
            result = mann_whitney_u(
                group_a=request.group_a_values,
                group_b=request.group_b_values,
                metric_name=request.metric_name,
                group_a_name=request.group_a_name,
                group_b_name=request.group_b_name,
                significance_level=request.significance_level,
            )
        else:
            raise HTTPException(status_code=400, detail=f"不支持的检验类型：{request.test_type}")

        return result.model_dump(mode="json")

    @app.post("/experiments/{experiment_id}/compare")
    def compare_experiment_runs(experiment_id: str, metric_name: str = "pass_rate") -> dict[str, Any]:
        """对比实验中的两个 Run。"""
        from aegisqa.api.app import _find_record
        from aegisqa.engine.runner import WorkflowRunner

        experiment = _find_record(ctx.store, "experiments", experiment_id)
        if not experiment:
            raise HTTPException(status_code=404, detail=f"实验 {experiment_id} 不存在")

        baseline_run_id = experiment.get("baseline_run_id")
        compare_run_id = experiment.get("run_id")

        if not baseline_run_id or not compare_run_id:
            raise HTTPException(status_code=400, detail="实验缺少 baseline 或 compare run")

        # 获取两个 Run 的指标
        baseline_run = ctx.run_repository.get(baseline_run_id) if ctx.run_repository else None
        compare_run = ctx.run_repository.get(compare_run_id) if ctx.run_repository else None

        if not baseline_run or not compare_run:
            raise HTTPException(status_code=404, detail="Run 不存在")

        # 提取指标值
        baseline_values = []
        compare_values = []
        for item in baseline_run.items:
            val = item.metrics.get(metric_name)
            if val is not None:
                baseline_values.append(float(val))
        for item in compare_run.items:
            val = item.metrics.get(metric_name)
            if val is not None:
                compare_values.append(float(val))

        if len(baseline_values) < 2 or len(compare_values) < 2:
            return {"error": "样本量不足，无法进行统计检验"}

        result = t_test(
            group_a=baseline_values,
            group_b=compare_values,
            metric_name=metric_name,
            group_a_name="Baseline",
            group_b_name="Compare",
        )

        return {
            "experiment_id": experiment_id,
            "metric_name": metric_name,
            "baseline_run_id": baseline_run_id,
            "compare_run_id": compare_run_id,
            "test_result": result.model_dump(mode="json"),
        }
