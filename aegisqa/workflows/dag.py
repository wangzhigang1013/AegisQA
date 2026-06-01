"""P2 DAG 工作流模型与执行器。"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from typing import Any

from pydantic import BaseModel, Field

from aegisqa.core.mapper import MappingPathError, get_by_path, resolve_input_mapping, set_by_path
from aegisqa.skills.registry import SkillRegistry


class DAGWorkflowStep(BaseModel):
    step_id: str
    skill_ref: str
    depends_on: list[str] = Field(default_factory=list)
    condition: str | None = None
    input_mapping: dict[str, str] = Field(default_factory=dict)
    output_mapping: dict[str, str] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    cacheable: bool = False


class DAGWorkflow(BaseModel):
    name: str
    steps: list[DAGWorkflowStep]

    def topological_order(self) -> list[str]:
        remaining = {step.step_id: set(step.depends_on) for step in self.steps}
        ordered: list[str] = []
        while remaining:
            ready = sorted(step_id for step_id, deps in remaining.items() if not deps)
            if not ready:
                raise ValueError("DAG 存在循环依赖")
            for step_id in ready:
                ordered.append(step_id)
                remaining.pop(step_id)
                for deps in remaining.values():
                    deps.discard(step_id)
        return ordered

    def execution_levels(self) -> list[list[str]]:
        """按依赖关系计算可并行执行的层级。"""

        remaining = {step.step_id: set(step.depends_on) for step in self.steps}
        levels: list[list[str]] = []
        while remaining:
            ready = sorted(step_id for step_id, deps in remaining.items() if not deps)
            if not ready:
                raise ValueError("DAG 存在循环依赖")
            levels.append(ready)
            for step_id in ready:
                remaining.pop(step_id)
                for deps in remaining.values():
                    deps.discard(step_id)
        return levels


class DAGWorkflowExecutor:
    """按层级执行 DAG。

    同一层级中的步骤没有依赖关系，可以并发执行。为了避免并发写 Context 造成竞态，
    每个步骤读取进入该层级时的 Context 快照，完成后再统一合并输出。
    """

    def __init__(self, registry: SkillRegistry, max_workers: int = 4) -> None:
        self.registry = registry
        self.max_workers = max_workers

    def execute_row(self, workflow: DAGWorkflow, row: dict[str, Any]) -> dict[str, Any]:
        context: dict[str, Any] = {"row": row, "context": {}, "metrics": {}, "artifacts": {}, "errors": [], "steps": {}}
        steps_by_id = {step.step_id: step for step in workflow.steps}
        for level_index, level in enumerate(workflow.execution_levels()):
            level_snapshot = deepcopy(context)
            with ThreadPoolExecutor(max_workers=min(self.max_workers, max(1, len(level)))) as pool:
                futures = [pool.submit(self._run_step, steps_by_id[step_id], level_snapshot, level_index) for step_id in level]
                for future in futures:
                    step_id, result = future.result()
                    context["steps"][step_id] = result
                    if result["status"] == "succeeded":
                        # DAG 执行器同样暴露 `step_id.field` 标准输出命名空间，
                        # 让下游节点不必依赖手写 output_mapping 别名。
                        context[step_id] = result.get("output", {})
                        for target_path, value in result["writes"].items():
                            set_by_path(context, target_path, value)
                        context["metrics"].update(result.get("metrics", {}))
                    elif result["status"] == "failed":
                        context["errors"].append(result["error"])
        return context

    def _run_step(self, step: DAGWorkflowStep, context: dict[str, Any], level_index: int) -> tuple[str, dict[str, Any]]:
        if not _condition_matches(step.condition, context):
            return step.step_id, {"status": "skipped", "level": level_index, "writes": {}, "reason": "condition_false"}
        try:
            skill = self.registry.get(step.skill_ref)
            inputs = resolve_input_mapping(step.input_mapping, context, skill.manifest.input_schema)
            result, latency_ms = skill.execute(inputs, step.config)
            writes = {target_path: result.output[field] for field, target_path in step.output_mapping.items() if field in result.output}
            return (
                step.step_id,
                {
                    "status": "succeeded",
                    "level": level_index,
                    "input": inputs,
                    "output": result.output,
                    "metrics": result.metrics,
                    "latency_ms": latency_ms,
                    "writes": writes,
                },
            )
        except Exception as exc:  # noqa: BLE001 - DAG 步骤边界需要结构化落错。
            return step.step_id, {"status": "failed", "level": level_index, "writes": {}, "error": {"type": type(exc).__name__, "message": str(exc)}}


def _condition_matches(condition: str | None, context: dict[str, Any]) -> bool:
    """评估最小条件表达式。

    当前支持 `path exists` / `path not exists`，覆盖 PRD 中条件分支的最小需求，
    同时避免在平台里执行任意 Python 表达式带来的安全风险。
    """

    if not condition:
        return True
    text = condition.strip()
    if text.endswith(" not exists"):
        path = text[: -len(" not exists")].strip()
        try:
            get_by_path(context, path)
        except MappingPathError:
            return True
        return False
    if text.endswith(" exists"):
        path = text[: -len(" exists")].strip()
        try:
            get_by_path(context, path)
        except MappingPathError:
            return False
        return True
    raise ValueError(f"不支持的 DAG 条件表达式：{condition}")
