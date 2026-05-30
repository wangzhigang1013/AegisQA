"""字段映射与强类型校验。

PRD 明确要求：字段映射不是简单路径搬运。解析出下游 Skill 输入后，必须立刻
根据下游 `input_schema` 做强类型断言；失败时抛出 Step 级 TypeMismatchError，
并且不得调用 Skill。本模块就是这个硬约束的集中入口。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class MappingPathError(ValueError):
    """字段映射路径无法解析。"""


@dataclass(slots=True)
class TypeMismatchError(ValueError):
    """字段类型与 Skill schema 不匹配。"""

    field_path: str
    expected_type: str
    actual_type: str
    actual_value: Any

    def __post_init__(self) -> None:
        ValueError.__init__(
            self,
            f"字段 {self.field_path} 类型不匹配：期望 {self.expected_type}，实际 {self.actual_type}",
        )


def get_by_path(context: dict[str, Any], path: str) -> Any:
    """按 `row.xxx`、`context.xxx`、`metrics.xxx`、`steps.step.output.xxx` 读取值。"""

    current: Any = context
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        raise MappingPathError(f"路径不存在：{path}")
    return current


def set_by_path(context: dict[str, Any], path: str, value: Any) -> None:
    """把 Skill 输出写回 Context。

    输出路径在 Workflow DSL 中由用户配置。这里按需创建中间 dict，保证线性步骤
    可以把结果写到 `context`、`metrics` 或 `artifacts` 等命名空间。
    """

    parts = path.split(".")
    if not parts:
        raise MappingPathError("输出路径不能为空")
    current: dict[str, Any] = context
    for part in parts[:-1]:
        next_value = current.setdefault(part, {})
        if not isinstance(next_value, dict):
            raise MappingPathError(f"输出路径中间节点不是对象：{path}")
        current = next_value
    current[parts[-1]] = value


def _actual_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "null":
        return value is None
    # 未知 schema 类型默认不放行，避免类型擦除。
    return False


def validate_json_schema(value: Any, schema: dict[str, Any], field_path: str = "$") -> None:
    """校验最小 JSON Schema 子集。

    MVP 只需要覆盖 PRD 要求的 string、number、boolean、enum、json、array 等类型。
    不引入完整 jsonschema 依赖，是为了保持平台核心轻量；后续可以替换为标准库。
    """

    expected = schema.get("type")
    if isinstance(expected, list):
        if not any(_matches_type(value, item) for item in expected):
            raise TypeMismatchError(field_path, "/".join(expected), _actual_type(value), value)
    elif expected and not _matches_type(value, expected):
        raise TypeMismatchError(field_path, expected, _actual_type(value), value)

    enum_values = schema.get("enum")
    if enum_values is not None and value not in enum_values:
        raise TypeMismatchError(field_path, f"enum{enum_values}", repr(value), value)

    if expected == "object" or "properties" in schema:
        if not isinstance(value, dict):
            raise TypeMismatchError(field_path, "object", _actual_type(value), value)
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                raise TypeMismatchError(f"{field_path}.{key}", "required", "missing", None)
        for key, child_schema in schema.get("properties", {}).items():
            if key in value:
                child_path = key if field_path == "$" else f"{field_path}.{key}"
                validate_json_schema(value[key], child_schema, child_path)

    if expected == "array" and isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            validate_json_schema(item, schema["items"], f"{field_path}[{index}]")


def resolve_input_mapping(
    input_mapping: dict[str, str],
    context: dict[str, Any],
    input_schema: dict[str, Any],
) -> dict[str, Any]:
    """解析输入映射，并在返回前完成强类型校验。"""

    resolved = {field: get_by_path(context, source_path) for field, source_path in input_mapping.items()}
    validate_json_schema(resolved, input_schema)
    return resolved

