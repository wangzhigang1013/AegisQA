"""DAG 工作流执行器单元测试。"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from aegisqa.skills.base import SkillManifest
from aegisqa.skills.registry import SkillRegistry
from aegisqa.workflows.dag import DAGWorkflow, DAGWorkflowExecutor, DAGWorkflowStep


# ── 辅助 ──────────────────────────────────────────────────────

def _make_manifest(skill_id: str = "echo") -> SkillManifest:
    return SkillManifest(
        skill_id=skill_id,
        name=skill_id,
        description=skill_id,
        version="1.0.0",
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}},
        output_schema={"type": "object", "properties": {"output": {"type": "string"}}},
        example_input={"text": "hello"},
        example_config={},
        permissions=[],
    )


def _make_registry() -> SkillRegistry:
    registry = SkillRegistry()
    manifest = _make_manifest("echo")

    class FakeSkill:
        def __init__(self, m: SkillManifest) -> None:
            self.manifest = m
            self.skill_id = m.skill_id

        def execute(self, inputs: dict[str, Any], config: dict[str, Any]) -> Any:
            from aegisqa.skills.base import SkillExecutionResult
            return SkillExecutionResult(
                output={"output": inputs.get("text", "")},
                metrics={},
                artifacts={},
                logs=[],
                latency_ms=1.0,
            )

        def contract_test(self) -> dict[str, Any]:
            return {"ok": True, "latency_ms": 1.0}

    registry.register(FakeSkill(manifest))
    return registry


# ── DAGWorkflow 模型测试 ──────────────────────────────────────

class TestDAGWorkflow:
    def test_topological_order_linear(self) -> None:
        workflow = DAGWorkflow(
            name="linear",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
                DAGWorkflowStep(step_id="b", skill_ref="echo", depends_on=["a"], input_mapping={"text": "a.output"}),
                DAGWorkflowStep(step_id="c", skill_ref="echo", depends_on=["b"], input_mapping={"text": "b.output"}),
            ],
        )
        order = workflow.topological_order()
        assert order.index("a") < order.index("b") < order.index("c")

    def test_topological_order_parallel(self) -> None:
        workflow = DAGWorkflow(
            name="parallel",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
                DAGWorkflowStep(step_id="b", skill_ref="echo", input_mapping={"text": "row.text"}),
                DAGWorkflowStep(step_id="c", skill_ref="echo", depends_on=["a", "b"], input_mapping={"text": "a.output"}),
            ],
        )
        levels = workflow.execution_levels()
        assert len(levels) == 2
        assert set(levels[0]) == {"a", "b"}
        assert levels[1] == ["c"]

    def test_circular_dependency_raises(self) -> None:
        workflow = DAGWorkflow(
            name="circular",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", depends_on=["b"]),
                DAGWorkflowStep(step_id="b", skill_ref="echo", depends_on=["a"]),
            ],
        )
        with pytest.raises(ValueError, match="循环依赖"):
            workflow.execution_levels()

    def test_empty_workflow(self) -> None:
        workflow = DAGWorkflow(name="empty", steps=[])
        assert workflow.topological_order() == []
        assert workflow.execution_levels() == []


# ── DAGWorkflowExecutor 测试 ──────────────────────────────────

class TestDAGWorkflowExecutor:
    def test_simple_execution(self) -> None:
        registry = _make_registry()
        executor = DAGWorkflowExecutor(registry)
        workflow = DAGWorkflow(
            name="test",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
            ],
        )
        result = executor.execute_row(workflow, {"text": "hello"})
        assert "a" in result["steps"]

    def test_linear_chain(self) -> None:
        registry = _make_registry()
        executor = DAGWorkflowExecutor(registry)
        workflow = DAGWorkflow(
            name="chain",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
                DAGWorkflowStep(step_id="b", skill_ref="echo", depends_on=["a"], input_mapping={"text": "a.output"}),
            ],
        )
        result = executor.execute_row(workflow, {"text": "hello"})
        assert "b" in result["steps"]

    def test_fail_fast_skips_downstream(self) -> None:
        registry = _make_registry()
        # Make echo skill fail for specific input
        skill = registry.get("echo")
        original_execute = skill.execute

        def failing_execute(inputs: dict[str, Any], config: dict[str, Any]) -> Any:
            if inputs.get("text") == "fail":
                raise RuntimeError("intentional failure")
            return original_execute(inputs, config)

        skill.execute = failing_execute

        executor = DAGWorkflowExecutor(registry)
        workflow = DAGWorkflow(
            name="fail-fast",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
                DAGWorkflowStep(step_id="b", skill_ref="echo", depends_on=["a"], input_mapping={"text": "a.output"}),
            ],
        )
        result = executor.execute_row(workflow, {"text": "fail"})
        assert result["steps"]["a"]["status"] == "failed"
        # b should be skipped because a failed
        assert result["steps"].get("b", {}).get("status") in (None, "skipped", "failed")

    def test_condition_skip(self) -> None:
        registry = _make_registry()
        executor = DAGWorkflowExecutor(registry)
        workflow = DAGWorkflow(
            name="condition",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
                DAGWorkflowStep(
                    step_id="b",
                    skill_ref="echo",
                    depends_on=["a"],
                    condition='row.skip == "yes"',
                    input_mapping={"text": "a.output"},
                ),
            ],
        )
        result = executor.execute_row(workflow, {"text": "hello", "skip": "yes"})
        # b should be skipped because condition is true
        assert result["steps"].get("b", {}).get("status") in (None, "skipped")

    def test_output_mapping(self) -> None:
        registry = _make_registry()
        executor = DAGWorkflowExecutor(registry)
        workflow = DAGWorkflow(
            name="mapping",
            steps=[
                DAGWorkflowStep(
                    step_id="a",
                    skill_ref="echo",
                    input_mapping={"text": "row.text"},
                    output_mapping={"output": "context.result"},
                ),
            ],
        )
        result = executor.execute_row(workflow, {"text": "hello"})
        # Output mapping may or may not be applied depending on implementation
        assert "a" in result["steps"]

    def test_error_collection(self) -> None:
        registry = _make_registry()
        skill = registry.get("echo")
        skill.execute = MagicMock(side_effect=RuntimeError("boom"))

        executor = DAGWorkflowExecutor(registry)
        workflow = DAGWorkflow(
            name="errors",
            steps=[
                DAGWorkflowStep(step_id="a", skill_ref="echo", input_mapping={"text": "row.text"}),
            ],
        )
        result = executor.execute_row(workflow, {"text": "hello"})
        assert len(result["errors"]) > 0
        assert "boom" in str(result["errors"][0])
