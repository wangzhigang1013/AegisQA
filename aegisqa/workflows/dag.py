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
    """评估条件表达式。

    支持：
    - `path exists` / `path not exists`：路径存在性检查
    - `path >= value` / `path <= value` / `path > value` / `path < value`：比较运算
    - `path == value` / `path != value`：相等比较
    - `path matches "pattern"`：正则匹配
    - `cond1 AND cond2` / `cond1 OR cond2`：逻辑组合
    """

    if not condition:
        return True

    text = condition.strip()

    # 处理 AND/OR 逻辑组合
    if " AND " in text:
        parts = text.split(" AND ", 1)
        return _condition_matches(parts[0].strip(), context) and _condition_matches(parts[1].strip(), context)
    if " OR " in text:
        parts = text.split(" OR ", 1)
        return _condition_matches(parts[0].strip(), context) or _condition_matches(parts[1].strip(), context)

    # 处理 exists/not exists
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

    # 处理比较运算
    for op in [">=", "<=", "!=", "==", ">", "<"]:
        if f" {op} " in text:
            left, right = text.split(f" {op} ", 1)
            left_path = left.strip()
            right_val = right.strip().strip('"').strip("'")
            try:
                left_val = get_by_path(context, left_path)
            except MappingPathError:
                return False
            try:
                left_num = float(left_val)
                right_num = float(right_val)
                if op == ">=": return left_num >= right_num
                if op == "<=": return left_num <= right_num
                if op == ">": return left_num > right_num
                if op == "<": return left_num < right_num
                if op == "==": return left_num == right_num
                if op == "!=": return left_num != right_num
            except (TypeError, ValueError):
                str_left = str(left_val)
                if op == "==": return str_left == right_val
                if op == "!=": return str_left != right_val
                return False

    # 处理正则匹配
    if " matches " in text:
        import re
        left, pattern = text.split(" matches ", 1)
        left_path = left.strip()
        pattern = pattern.strip().strip('"').strip("'")
        try:
            left_val = str(get_by_path(context, left_path))
        except MappingPathError:
            return False
        return bool(re.search(pattern, left_val))

    raise ValueError(f"不支持的 DAG 条件表达式：{condition}")


class LoopNode(BaseModel):
    """循环节点定义。"""
    step_id: str
    items_path: str  # 数据源路径，如 "row.questions"
    item_alias: str = "item"  # 迭代变量名
    substeps: list[DAGWorkflowStep] = Field(default_factory=list)
    output_mapping: dict[str, str] = Field(default_factory=dict)


class SubWorkflowNode(BaseModel):
    """子工作流节点定义。"""
    step_id: str
    workflow_version_id: str  # 引用的 Workflow 版本 ID
    input_mapping: dict[str, str] = Field(default_factory=dict)
    output_mapping: dict[str, str] = Field(default_factory=dict)
    condition: str | None = None


def execute_subworkflow(
    node: SubWorkflowNode,
    context: dict[str, Any],
    registry: Any,
    runner: Any,
) -> dict[str, Any]:
    """执行子工作流。

    Args:
        node: 子工作流节点定义。
        context: 当前上下文。
        registry: Skill 注册表。
        runner: WorkflowRunner 实例。

    Returns:
        子工作流执行结果。
    """
    # 解析输入
    inputs = {}
    for target_path, source_path in node.input_mapping.items():
        try:
            inputs[target_path] = get_by_path(context, source_path)
        except MappingPathError:
            inputs[target_path] = None

    # 获取子工作流版本
    workflow = runner.get_workflow(node.workflow_version_id)
    if not workflow:
        return {
            "status": "failed",
            "error": {"type": "WorkflowNotFound", "message": f"子工作流 {node.workflow_version_id} 不存在"},
        }

    # 构建子工作流上下文
    sub_context = {
        "row": inputs,
        "context": context.get("context", {}),
        "metrics": {},
        "artifacts": {},
        "errors": [],
        "steps": {},
    }

    # 执行子工作流步骤
    for step in workflow.steps:
        skill = registry.get(step.skill_ref)
        if not skill:
            sub_context["errors"].append({"type": "SkillNotFound", "message": f"Skill {step.skill_ref} 不存在"})
            continue

        try:
            step_inputs = resolve_input_mapping(step.input_mapping, sub_context, skill.manifest.input_schema)
            result, latency_ms = skill.execute(step_inputs, step.config)
            sub_context["steps"][step.step_id] = {
                "status": "succeeded",
                "input": step_inputs,
                "output": result.output,
                "metrics": result.metrics,
                "latency_ms": latency_ms,
            }
            sub_context[step.step_id] = result.output
            for target_path, value in step.output_mapping.items():
                if value in result.output:
                    set_by_path(sub_context, target_path, result.output[value])
            sub_context["metrics"].update(result.metrics)
        except Exception as exc:
            sub_context["steps"][step.step_id] = {
                "status": "failed",
                "error": {"type": type(exc).__name__, "message": str(exc)},
            }
            sub_context["errors"].append({"type": type(exc).__name__, "message": str(exc)})

    # 解析输出
    outputs = {}
    for target_path, source_path in node.output_mapping.items():
        try:
            outputs[target_path] = get_by_path(sub_context, source_path)
        except MappingPathError:
            outputs[target_path] = None

    return {
        "status": "succeeded" if not sub_context["errors"] else "failed",
        "outputs": outputs,
        "metrics": sub_context.get("metrics", {}),
        "steps": sub_context.get("steps", {}),
        "errors": sub_context.get("errors", []),
    }


def execute_loop(
    loop: LoopNode,
    context: dict[str, Any],
    registry: Any,
    max_workers: int = 4,
) -> list[dict[str, Any]]:
    """执行循环节点。

    Args:
        loop: 循环节点定义。
        context: 当前上下文。
        registry: Skill 注册表。
        max_workers: 最大并行数。

    Returns:
        所有迭代的结果列表。
    """
    # 获取迭代数据
    try:
        items = get_by_path(context, loop.items_path)
    except MappingPathError:
        return []

    if not isinstance(items, list):
        return []

    results = []
    from concurrent.futures import ThreadPoolExecutor

    def run_iteration(item_data: Any, index: int) -> dict[str, Any]:
        # 为每次迭代创建独立上下文
        iter_context = {
            **context,
            loop.item_alias: item_data,
            "loop_index": index,
        }
        iter_results = {}
        for substep in loop.substeps:
            if not _condition_matches(substep.condition, iter_context):
                continue
            try:
                skill = registry.get(substep.skill_ref)
                inputs = resolve_input_mapping(substep.input_mapping, iter_context, skill.manifest.input_schema)
                result, _ = skill.execute(inputs, substep.config)
                iter_results[substep.step_id] = {
                    "status": "succeeded",
                    "output": result.output,
                    "metrics": result.metrics,
                }
                # 更新上下文供下一个子步骤使用
                iter_context[substep.step_id] = result.output
                for target_path, value in substep.output_mapping.items():
                    if value in result.output:
                        set_by_path(iter_context, target_path, result.output[value])
            except Exception as exc:
                iter_results[substep.step_id] = {
                    "status": "failed",
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                }
        return {"index": index, "item": item_data, "steps": iter_results}

    with ThreadPoolExecutor(max_workers=min(max_workers, len(items))) as pool:
        futures = [pool.submit(run_iteration, item, i) for i, item in enumerate(items)]
        for future in futures:
            results.append(future.result())

    return results
