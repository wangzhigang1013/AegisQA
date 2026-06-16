"""前端 Workflow 画布使用的图模型与校验服务。"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from typing import Any

from pydantic import BaseModel, Field

from aegisqa.core.mapper import MappingPathError, TypeMismatchError, resolve_input_mapping, set_by_path, validate_mapping_expression
from aegisqa.skills.registry import SkillRegistry
from aegisqa.workflows.models import RuntimeConfig, WorkflowDraft, WorkflowStep
from aegisqa.workflows.validation import validate_static_skill_config


STRUCTURAL_NODE_TYPES = {"source", "branch", "join", "aggregator", "output"}
EXECUTABLE_NODE_TYPES = {"skill"}
MULTI_INPUT_NODE_TYPES = {"join", "aggregator"}


class WorkflowGraphNode(BaseModel):
    node_id: str
    node_type: str
    label: str | None = None
    skill_ref: str | None = None
    condition: str | None = None
    input_mapping: dict[str, str] = Field(default_factory=dict)
    output_mapping: dict[str, str] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    cacheable: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowGraphEdge(BaseModel):
    source: str
    target: str
    condition: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowGraph(BaseModel):
    name: str
    nodes: list[WorkflowGraphNode]
    edges: list[WorkflowGraphEdge] = Field(default_factory=list)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)


class GraphIssue(BaseModel):
    code: str
    message: str
    node_id: str | None = None
    edge: dict[str, str] | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class GraphTip(BaseModel):
    title: str
    message: str
    node_id: str | None = None


class WorkflowGraphValidationResult(BaseModel):
    ok: bool
    errors: list[GraphIssue] = Field(default_factory=list)
    warnings: list[GraphIssue] = Field(default_factory=list)
    execution_levels: list[list[str]] = Field(default_factory=list)
    graph_tips: list[GraphTip] = Field(default_factory=list)
    node_count: int = 0
    edge_count: int = 0


class WorkflowGraphService:
    """把前端图形化 Workflow 转成后端可发布、可试运行的结构。

    画布支持 Source/Skill/Branch/Join/Aggregator/Output 等节点；当前执行引擎仍以
    Skill Step 为执行单元，所以结构节点主要用于发布前校验、前端回显和解释数据流。
    """

    def __init__(self, registry: SkillRegistry) -> None:
        self.registry = registry

    def validate(self, graph: WorkflowGraph, *, sample_row: dict[str, Any] | None = None) -> WorkflowGraphValidationResult:
        errors: list[GraphIssue] = []
        warnings: list[GraphIssue] = []
        nodes_by_id = self._nodes_by_id(graph, errors)
        incoming = _incoming_edges(graph)
        outgoing = _outgoing_edges(graph)

        if nodes_by_id:
            self._validate_edges(graph, nodes_by_id, errors)
            self._validate_node_shapes(graph, nodes_by_id, incoming, outgoing, errors, warnings)
            self._validate_skill_references(nodes_by_id, errors)
            self._validate_skill_mappings(nodes_by_id, errors)

        try:
            levels = _execution_levels(graph, nodes_by_id) if not errors else []
        except ValueError as exc:
            levels = []
            errors.append(GraphIssue(code="DAG_CYCLE", message=str(exc)))

        if sample_row is not None and not errors:
            self._validate_sample_types(graph, nodes_by_id, levels, sample_row, errors)

        return WorkflowGraphValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            execution_levels=levels if not errors else [],
            graph_tips=self._tips(graph, incoming, outgoing),
            node_count=len(graph.nodes),
            edge_count=len(graph.edges),
        )

    def to_workflow_draft(self, graph: WorkflowGraph) -> WorkflowDraft:
        """把图转换为线性 WorkflowDraft。

        后端当前 Run 引擎执行的是线性 Step；因此这里按拓扑层级展开 Skill 节点。
        Join/Aggregator/Output 等结构节点保存在 `graph` 快照里，供前端和审计回放。
        """

        nodes_by_id = {node.node_id: node for node in graph.nodes}
        steps: list[WorkflowStep] = []
        for level in _execution_levels(graph, nodes_by_id):
            for node_id in level:
                node = nodes_by_id[node_id]
                if node.node_type != "skill":
                    continue
                steps.append(
                    WorkflowStep(
                        step_id=node.node_id,
                        skill_ref=node.skill_ref or "",
                        input_mapping=node.input_mapping,
                        output_mapping=node.output_mapping,
                        config=node.config,
                        cacheable=node.cacheable,
                    )
                )
        return WorkflowDraft(name=graph.name, steps=steps, runtime=graph.runtime, graph=graph.model_dump(mode="json"))

    def _nodes_by_id(self, graph: WorkflowGraph, errors: list[GraphIssue]) -> dict[str, WorkflowGraphNode]:
        nodes_by_id: dict[str, WorkflowGraphNode] = {}
        for node in graph.nodes:
            if node.node_id in nodes_by_id:
                errors.append(GraphIssue(code="DUPLICATE_NODE", message=f"节点 ID 重复：{node.node_id}", node_id=node.node_id))
                continue
            nodes_by_id[node.node_id] = node
        if not nodes_by_id:
            errors.append(GraphIssue(code="EMPTY_GRAPH", message="Workflow 至少需要一个节点"))
        return nodes_by_id

    def _validate_edges(self, graph: WorkflowGraph, nodes_by_id: dict[str, WorkflowGraphNode], errors: list[GraphIssue]) -> None:
        for edge in graph.edges:
            edge_payload = {"source": edge.source, "target": edge.target}
            if edge.source not in nodes_by_id:
                errors.append(GraphIssue(code="EDGE_SOURCE_MISSING", message=f"连线来源节点不存在：{edge.source}", edge=edge_payload))
            if edge.target not in nodes_by_id:
                errors.append(GraphIssue(code="EDGE_TARGET_MISSING", message=f"连线目标节点不存在：{edge.target}", edge=edge_payload))

    def _validate_node_shapes(
        self,
        graph: WorkflowGraph,
        nodes_by_id: dict[str, WorkflowGraphNode],
        incoming: dict[str, list[WorkflowGraphEdge]],
        outgoing: dict[str, list[WorkflowGraphEdge]],
        errors: list[GraphIssue],
        warnings: list[GraphIssue],
    ) -> None:
        allowed_types = STRUCTURAL_NODE_TYPES | EXECUTABLE_NODE_TYPES
        for node in graph.nodes:
            if node.node_type not in allowed_types:
                errors.append(GraphIssue(code="UNKNOWN_NODE_TYPE", message=f"不支持的节点类型：{node.node_type}", node_id=node.node_id))
            if node.node_type == "skill" and not node.skill_ref:
                errors.append(GraphIssue(code="SKILL_REF_REQUIRED", message="Skill 节点必须配置 skill_ref", node_id=node.node_id))
            if node.node_type != "skill" and node.skill_ref:
                warnings.append(GraphIssue(code="STRUCTURAL_SKILL_REF_IGNORED", message="结构节点上的 skill_ref 不参与执行", node_id=node.node_id))
            # 孤立节点检测: 没有任何连线的节点
            has_edges = bool(incoming.get(node.node_id)) or bool(outgoing.get(node.node_id))
            if not has_edges and node.node_type in EXECUTABLE_NODE_TYPES:
                warnings.append(GraphIssue(
                    code="ORPHAN_NODE",
                    message=f"节点 '{node.node_id}' 没有连接到任何其他节点，将不会参与工作流执行。",
                    node_id=node.node_id,
                ))
            if len(incoming.get(node.node_id, [])) > 1 and node.node_type not in MULTI_INPUT_NODE_TYPES:
                errors.append(
                    GraphIssue(
                        code="JOIN_REQUIRED",
                        message="多对一输入必须显式使用 Join 或 Aggregator 节点，避免多个上游隐式覆盖 Context。",
                        node_id=node.node_id,
                        details={"incoming_count": len(incoming[node.node_id]), "allowed_node_types": sorted(MULTI_INPUT_NODE_TYPES)},
                    )
                )
            if node.node_type == "branch":
                missing_conditions = [edge for edge in outgoing.get(node.node_id, []) if not edge.condition and not node.condition]
                for edge in missing_conditions:
                    errors.append(
                        GraphIssue(
                            code="BRANCH_CONDITION_REQUIRED",
                            message="条件分支必须在节点或连线上配置条件表达式。",
                            node_id=node.node_id,
                            edge={"source": edge.source, "target": edge.target},
                        )
                    )

    def _validate_skill_references(self, nodes_by_id: dict[str, WorkflowGraphNode], errors: list[GraphIssue]) -> None:
        for node in nodes_by_id.values():
            if node.node_type != "skill" or not node.skill_ref:
                continue
            try:
                manifest = self.registry.get_manifest(node.skill_ref)
            except KeyError:
                errors.append(GraphIssue(code="SKILL_NOT_FOUND", message=f"未注册的 Skill：{node.skill_ref}", node_id=node.node_id, details={"skill_ref": node.skill_ref}))
                continue
            if not manifest.enabled or manifest.status != "approved":
                errors.append(GraphIssue(code="SKILL_NOT_AVAILABLE", message=f"Skill 不允许被新 Workflow 引用：{node.skill_ref}", node_id=node.node_id))

    def _validate_skill_mappings(self, nodes_by_id: dict[str, WorkflowGraphNode], errors: list[GraphIssue]) -> None:
        for node in nodes_by_id.values():
            if node.node_type != "skill" or not node.skill_ref:
                continue
            try:
                manifest = self.registry.get_manifest(node.skill_ref)
            except KeyError:
                continue
            if not manifest.enabled or manifest.status != "approved":
                continue
            for issue in validate_static_skill_config(manifest, node.node_id, node.skill_ref, node.config):
                errors.append(GraphIssue(code=str(issue["code"]), message=str(issue["message"]), node_id=node.node_id, details=issue))
            for field, source in node.input_mapping.items():
                if not _mapping_path(source):
                    continue
                try:
                    validate_mapping_expression(str(source))
                except MappingPathError as exc:
                    errors.append(
                        GraphIssue(
                            code="INPUT_MAPPING_EXPRESSION_INVALID",
                            message=str(exc),
                            node_id=node.node_id,
                            details={
                                "skill_ref": node.skill_ref,
                                "field_path": str(field),
                                "expression": str(source),
                            },
                        )
                    )
            required_inputs = _string_list(manifest.input_schema.get("required", []))
            missing_inputs = [field for field in required_inputs if not _mapping_path(node.input_mapping.get(field))]
            if missing_inputs:
                errors.append(
                    GraphIssue(
                        code="REQUIRED_INPUT_MAPPING_MISSING",
                        message=f"Skill 必填输入未配置字段映射：{', '.join(missing_inputs)}",
                        node_id=node.node_id,
                        details={"skill_ref": node.skill_ref, "missing_fields": missing_inputs},
                    )
                )
            # 可选输入留空代表“不传该字段”，只有 required 字段会通过
            # REQUIRED_INPUT_MAPPING_MISSING 阻断发布。
            empty_outputs = sorted(field for field, path in node.output_mapping.items() if not _mapping_path(path))
            if empty_outputs:
                errors.append(
                    GraphIssue(
                        code="OUTPUT_MAPPING_PATH_EMPTY",
                        message=f"输出写入路径不能为空：{', '.join(empty_outputs)}",
                        node_id=node.node_id,
                        details={"skill_ref": node.skill_ref, "fields": empty_outputs},
                    )
                )

    def _validate_sample_types(
        self,
        graph: WorkflowGraph,
        nodes_by_id: dict[str, WorkflowGraphNode],
        levels: list[list[str]],
        sample_row: dict[str, Any],
        errors: list[GraphIssue],
    ) -> None:
        context: dict[str, Any] = {"row": sample_row, "context": {}, "metrics": {}, "artifacts": {}, "steps": {}}
        for level in levels:
            snapshot = deepcopy(context)
            for node_id in level:
                node = nodes_by_id[node_id]
                if node.node_type != "skill" or not node.skill_ref:
                    continue
                skill = self.registry.get(node.skill_ref)
                try:
                    inputs = resolve_input_mapping(node.input_mapping, snapshot, skill.manifest.input_schema)
                except TypeMismatchError as exc:
                    errors.append(
                        GraphIssue(
                            code="TYPE_MISMATCH",
                            message=str(exc),
                            node_id=node.node_id,
                            details={
                                "field_path": exc.field_path,
                                "expected_type": exc.expected_type,
                                "actual_type": exc.actual_type,
                            },
                        )
                    )
                    continue  # 收集所有类型错误后一次性返回
                except MappingPathError as exc:
                    missing_path = _missing_path_from_error(str(exc))
                    upstream_issue = _disconnected_upstream_output_issue(graph, nodes_by_id, node, missing_path)
                    if upstream_issue:
                        errors.append(upstream_issue)
                    else:
                        errors.append(
                            GraphIssue(
                                code="MAPPING_PATH_MISSING",
                                message=str(exc),
                                node_id=node.node_id,
                                details={"missing_path": missing_path} if missing_path else {},
                            )
                        )
                    return

                # 校验阶段不调用真实 Skill，而是用 schema 占位输出驱动下游类型检查。
                # 这样前端能在发布前发现映射问题，同时不会产生外部调用成本或副作用。
                output = {field: _placeholder_for_schema(schema) for field, schema in skill.manifest.output_schema.get("properties", {}).items()}
                # 每个节点的标准输出命名空间固定为 `node_id.field`，output_mapping 只作为
                # 兼容旧 Workflow 的额外别名，不再要求用户为每个输出手写路径。
                context[node.node_id] = deepcopy(output)
                for output_field, target_path in node.output_mapping.items():
                    if output_field in output:
                        set_by_path(context, target_path, output[output_field])
                context["steps"][node.node_id] = {"input": inputs, "output": output}

    def _tips(self, graph: WorkflowGraph, incoming: dict[str, list[WorkflowGraphEdge]], outgoing: dict[str, list[WorkflowGraphEdge]]) -> list[GraphTip]:
        tips: list[GraphTip] = []
        for node in graph.nodes:
            if len(outgoing.get(node.node_id, [])) > 1:
                tips.append(GraphTip(title="点对多", message="该节点的输出会同时提供给多个下游节点，可用于并行评测或多裁判审计。", node_id=node.node_id))
            if len(incoming.get(node.node_id, [])) > 1 and node.node_type in MULTI_INPUT_NODE_TYPES:
                tips.append(GraphTip(title="多对一", message="该节点显式等待多个上游结果，适合做 Join、投票、均值或一致性聚合。", node_id=node.node_id))
        return tips


def _incoming_edges(graph: WorkflowGraph) -> dict[str, list[WorkflowGraphEdge]]:
    incoming: dict[str, list[WorkflowGraphEdge]] = defaultdict(list)
    for edge in graph.edges:
        incoming[edge.target].append(edge)
    return incoming


def _outgoing_edges(graph: WorkflowGraph) -> dict[str, list[WorkflowGraphEdge]]:
    outgoing: dict[str, list[WorkflowGraphEdge]] = defaultdict(list)
    for edge in graph.edges:
        outgoing[edge.source].append(edge)
    return outgoing


def _mapping_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _execution_levels(graph: WorkflowGraph, nodes_by_id: dict[str, WorkflowGraphNode]) -> list[list[str]]:
    remaining = {node_id: set() for node_id in nodes_by_id}
    for edge in graph.edges:
        if edge.source in nodes_by_id and edge.target in nodes_by_id:
            remaining[edge.target].add(edge.source)

    levels: list[list[str]] = []
    while remaining:
        ready = sorted(node_id for node_id, deps in remaining.items() if not deps)
        if not ready:
            raise ValueError("DAG 存在循环依赖")
        levels.append(ready)
        for node_id in ready:
            remaining.pop(node_id)
            for deps in remaining.values():
                deps.discard(node_id)
    return levels


def _missing_path_from_error(message: str) -> str | None:
    prefix = "路径不存在："
    if prefix not in message:
        return None
    return message.split(prefix, 1)[1].strip() or None


def _disconnected_upstream_output_issue(
    graph: WorkflowGraph,
    nodes_by_id: dict[str, WorkflowGraphNode],
    current_node: WorkflowGraphNode,
    missing_path: str | None,
) -> GraphIssue | None:
    """把“路径不存在”细分为缺少数据依赖线。

    用户在输入绑定里写 `answer.answer` 时，语义上是“读取 answer 节点的输出”。
    如果画布没有从 answer 到当前节点的上游路径，执行器不会保证 answer 先运行，
    这时继续返回泛化的路径不存在会误导用户去改字段名，所以在校验层提前说明缺线。
    """

    if not missing_path or "." not in missing_path:
        return None
    referenced_node_id = missing_path.split(".", 1)[0]
    if referenced_node_id not in nodes_by_id or referenced_node_id == current_node.node_id:
        return None
    upstream_node_ids = _collect_upstream_node_ids(graph, current_node.node_id)
    if referenced_node_id in upstream_node_ids:
        return None
    return GraphIssue(
        code="UPSTREAM_OUTPUT_NOT_CONNECTED",
        message=f"输入绑定引用了非上游节点输出：{missing_path}。请先从 {referenced_node_id} 连接到 {current_node.node_id}，再使用该输出。",
        node_id=current_node.node_id,
        details={
            "missing_path": missing_path,
            "referenced_node_id": referenced_node_id,
            "current_node_id": current_node.node_id,
        },
    )


def _collect_upstream_node_ids(graph: WorkflowGraph, selected_node_id: str) -> set[str]:
    reverse_edges: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges:
        reverse_edges[edge.target].append(edge.source)

    visited: set[str] = set()
    queue = list(reverse_edges.get(selected_node_id, []))
    while queue:
        node_id = queue.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)
        queue.extend(reverse_edges.get(node_id, []))
    return visited


def _placeholder_for_schema(schema: dict[str, Any]) -> Any:
    expected = schema.get("type")
    if isinstance(expected, list):
        expected = expected[0] if expected else None
    if "enum" in schema and schema["enum"]:
        return schema["enum"][0]
    if expected == "string":
        return "__schema_string__"
    if expected == "number":
        return 1.0
    if expected == "integer":
        return 1
    if expected == "boolean":
        return True
    if expected == "array":
        return []
    if expected == "object":
        return {}
    return None
