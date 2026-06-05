"""字段映射与强类型校验。

PRD 明确要求：字段映射不是简单路径搬运。解析出下游 Skill 输入后，必须立刻
根据下游 `input_schema` 做强类型断言；失败时抛出 Step 级 TypeMismatchError，
并且不得调用 Skill。本模块就是这个硬约束的集中入口。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any


class MappingPathError(ValueError):
    """字段映射路径无法解析。"""


_PATH_PATTERN = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$")
_ROOT_PATHS = {"row", "context", "metrics", "artifacts", "steps", "errors"}
_TEMPLATE_PATTERN = re.compile(r"{{\s*(.*?)\s*}}")
_NUMBER_PATTERN = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?$")
_ROW_PATH_PATTERN = re.compile(r"\brow\.([A-Za-z_]\w*)")
_UNSAFE_TOKENS = {
    "__",
    ";",
    "open(",
    "compile(",
    "globals(",
    "locals(",
    "getattr(",
    "setattr(",
    "delattr(",
}
_UNSAFE_WORDS = {"import", "eval", "exec", "lambda"}
_COMPARISON_OPERATORS = ("==", "!=", ">=", "<=", ">", "<")


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


def evaluate_mapping_expression(expression: str, context: dict[str, Any]) -> Any:
    """求值受控 input_mapping 表达式。

    表达式语言只覆盖 Workflow 映射场景需要的最小能力：路径读取、默认值、三元
    条件和字符串模板。这里显式拒绝任意 Python/JS 语法，避免把用户配置变成代码
    执行入口。
    """

    return _evaluate_expression(expression, context, validate_only=False)


def validate_mapping_expression(expression: str) -> None:
    """静态校验 input_mapping 表达式语法，不要求实际数据路径存在。"""

    _evaluate_expression(expression, {}, validate_only=True)


def collect_mapping_row_fields(expression: Any) -> set[str]:
    """收集表达式中确定依赖的 `row.xxx` 字段。

    `row.scene ?? "general"` 左侧路径允许缺失，所以不会把 `scene` 计入必需字段；
    模板和条件表达式中的路径仍会被 Preflight 用真实样本继续校验。
    """

    if not isinstance(expression, str) or not expression.strip():
        return set()
    try:
        return _collect_row_fields(expression.strip(), required=True)
    except MappingPathError:
        return set()


def _evaluate_expression(expression: str, context: dict[str, Any], *, validate_only: bool) -> Any:
    expression = expression.strip()
    if not expression:
        raise MappingPathError("表达式不能为空")
    if "{{" in expression or "}}" in expression:
        if not _balanced_template(expression):
            raise MappingPathError(f"不支持的表达式语法：{expression}")
        return _evaluate_template(expression, context, validate_only=validate_only)
    return _evaluate_atom(expression, context, validate_only=validate_only)


def _evaluate_template(template: str, context: dict[str, Any], *, validate_only: bool) -> str:
    rendered: list[str] = []
    cursor = 0
    matched = False
    for match in _TEMPLATE_PATTERN.finditer(template):
        matched = True
        rendered.append(template[cursor : match.start()])
        value = _evaluate_atom(match.group(1), context, validate_only=validate_only)
        rendered.append("" if validate_only or value is None else str(value))
        cursor = match.end()
    if not matched or "{{" in template[cursor:] or "}}" in template[cursor:]:
        raise MappingPathError(f"不支持的表达式语法：{template}")
    rendered.append(template[cursor:])
    return "".join(rendered)


def _evaluate_atom(expression: str, context: dict[str, Any], *, validate_only: bool) -> Any:
    expression = expression.strip()
    _ensure_safe_expression_fragment(expression)

    default_index = _find_top_level_operator(expression, "??")
    if default_index >= 0:
        left = expression[:default_index]
        right = expression[default_index + 2 :]
        try:
            value = _evaluate_atom(left, context, validate_only=validate_only)
        except MappingPathError as exc:
            if not _is_missing_path_error(exc):
                raise
            value = None
        if validate_only:
            _evaluate_atom(right, context, validate_only=True)
            return None
        if value in (None, ""):
            return _evaluate_atom(right, context, validate_only=False)
        return value

    if expression.startswith("if(") and expression.endswith(")"):
        parts = _split_top_level(expression[3:-1], ",")
        if len(parts) != 3:
            raise MappingPathError(f"不支持的表达式语法：{expression}")
        condition = _evaluate_condition(parts[0], context, validate_only=validate_only)
        if validate_only:
            _evaluate_atom(parts[1], context, validate_only=True)
            _evaluate_atom(parts[2], context, validate_only=True)
            return None
        return _evaluate_atom(parts[1], context, validate_only=False) if condition else _evaluate_atom(parts[2], context, validate_only=False)

    if any(expression.startswith(f"{name}(") for name in ("if",)) is False and "(" in expression:
        raise MappingPathError(f"不支持的表达式语法：{expression}")

    literal = _literal_value(expression)
    if literal is not _NO_LITERAL:
        return literal

    if expression in _ROOT_PATHS or _PATH_PATTERN.match(expression):
        return None if validate_only else get_by_path(context, expression)

    raise MappingPathError(f"不支持的表达式语法：{expression}")


def _evaluate_condition(expression: str, context: dict[str, Any], *, validate_only: bool) -> bool:
    expression = expression.strip()
    _ensure_safe_expression_fragment(expression)
    for operator in _COMPARISON_OPERATORS:
        operator_index = _find_top_level_operator(expression, operator)
        if operator_index < 0:
            continue
        left = expression[:operator_index]
        right = expression[operator_index + len(operator) :]
        left_value = _evaluate_atom(left, context, validate_only=validate_only)
        right_value = _evaluate_atom(right, context, validate_only=validate_only)
        if validate_only:
            return False
        if operator == "==":
            return left_value == right_value
        if operator == "!=":
            return left_value != right_value
        try:
            if operator == ">=":
                return left_value >= right_value
            if operator == "<=":
                return left_value <= right_value
            if operator == ">":
                return left_value > right_value
            if operator == "<":
                return left_value < right_value
        except TypeError as exc:
            raise MappingPathError(f"条件表达式类型不可比较：{expression}") from exc
    value = _evaluate_atom(expression, context, validate_only=validate_only)
    return bool(value)


class _NoLiteral:
    pass


_NO_LITERAL = _NoLiteral()


def _literal_value(expression: str) -> Any:
    if expression in {"true", "false"}:
        return expression == "true"
    if expression == "null":
        return None
    if _NUMBER_PATTERN.match(expression):
        return float(expression) if "." in expression else int(expression)
    if len(expression) >= 2 and expression[0] == expression[-1] and expression[0] in {'"', "'"}:
        try:
            return json.loads(expression) if expression[0] == '"' else expression[1:-1]
        except json.JSONDecodeError as exc:
            raise MappingPathError(f"不支持的表达式语法：{expression}") from exc
    return _NO_LITERAL


def _ensure_safe_expression_fragment(expression: str) -> None:
    lowered = expression.lower()
    if any(token in lowered for token in _UNSAFE_TOKENS):
        raise MappingPathError(f"不支持的表达式语法：{expression}")
    for word in _UNSAFE_WORDS:
        if re.search(rf"\b{word}\b", lowered):
            raise MappingPathError(f"不支持的表达式语法：{expression}")


def _balanced_template(template: str) -> bool:
    return template.count("{{") == template.count("}}")


def _find_top_level_operator(expression: str, operator: str) -> int:
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(expression):
        char = expression[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
            index += 1
            continue
        if char == "(":
            depth += 1
            index += 1
            continue
        if char == ")":
            depth -= 1
            if depth < 0:
                raise MappingPathError(f"不支持的表达式语法：{expression}")
            index += 1
            continue
        if depth == 0 and expression.startswith(operator, index):
            return index
        index += 1
    if depth != 0 or quote:
        raise MappingPathError(f"不支持的表达式语法：{expression}")
    return -1


def _split_top_level(expression: str, separator: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    quote: str | None = None
    start = 0
    index = 0
    while index < len(expression):
        char = expression[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
            index += 1
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise MappingPathError(f"不支持的表达式语法：{expression}")
        elif depth == 0 and expression.startswith(separator, index):
            parts.append(expression[start:index].strip())
            index += len(separator)
            start = index
            continue
        index += 1
    if depth != 0 or quote:
        raise MappingPathError(f"不支持的表达式语法：{expression}")
    parts.append(expression[start:].strip())
    return parts


def _is_missing_path_error(exc: MappingPathError) -> bool:
    return "路径不存在：" in str(exc)


def _collect_row_fields(expression: str, *, required: bool) -> set[str]:
    if "{{" in expression or "}}" in expression:
        fields: set[str] = set()
        for match in _TEMPLATE_PATTERN.finditer(expression):
            fields.update(_collect_row_fields(match.group(1), required=required))
        return fields
    default_index = _find_top_level_operator(expression, "??")
    if default_index >= 0:
        # 默认值表达式左侧允许缺字段，右侧如果引用 row 字段则仍是硬依赖。
        return _collect_row_fields(expression[default_index + 2 :], required=required)
    if expression.startswith("if(") and expression.endswith(")"):
        fields: set[str] = set()
        for part in _split_top_level(expression[3:-1], ","):
            fields.update(_collect_row_fields(part, required=required))
        return fields
    for operator in _COMPARISON_OPERATORS:
        operator_index = _find_top_level_operator(expression, operator)
        if operator_index >= 0:
            fields = _collect_row_fields(expression[:operator_index], required=required)
            fields.update(_collect_row_fields(expression[operator_index + len(operator) :], required=required))
            return fields
    return {match.group(1) for match in _ROW_PATH_PATTERN.finditer(expression)}


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


def _coerce_json_container_string(value: Any, schema: dict[str, Any]) -> Any:
    """把 CSV/JSONL 中的 JSON 字符串按 schema 还原为对象或数组。

    数据集上传后，CSV 单元格天然容易把 `{"k": "v"}` 这类对象保成字符串。
    这里仅在 schema 明确要求 object/array 时尝试解析，避免把普通 string 类型
    悄悄改写成别的值。
    """

    if not isinstance(value, str):
        return value
    expected = schema.get("type")
    expected_values = expected if isinstance(expected, list) else [expected]
    expects_object = "object" in expected_values or "properties" in schema
    expects_array = "array" in expected_values
    if not expects_object and not expects_array:
        return value
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return value
    if expects_object and isinstance(parsed, dict):
        return parsed
    if expects_array and isinstance(parsed, list):
        return parsed
    return value


def _schema_properties(schema: dict[str, Any]) -> dict[str, Any]:
    properties = schema.get("properties", {})
    return properties if isinstance(properties, dict) else {}


def _schema_required_fields(schema: dict[str, Any]) -> set[str]:
    required = schema.get("required", [])
    return {str(item) for item in required} if isinstance(required, list) else set()


def _has_mapping_path(path: Any) -> bool:
    return isinstance(path, str) and bool(path.strip())


def _is_optional_blank_container_value(field: str, value: Any, input_schema: dict[str, Any]) -> bool:
    """可选 object/array 字段为空时按未提供处理。

    CSV 单元格和前端可选映射经常会把未填写值表示成空字符串；如果该字段不是
    required，继续拿空字符串做 object 校验只会制造误报。
    """

    if field in _schema_required_fields(input_schema):
        return False
    if value not in ("", None):
        return False
    field_schema = _schema_properties(input_schema).get(field)
    if not isinstance(field_schema, dict):
        return False
    expected = field_schema.get("type")
    expected_values = expected if isinstance(expected, list) else [expected]
    return "object" in expected_values or "array" in expected_values or "properties" in field_schema


def validate_json_schema(value: Any, schema: dict[str, Any], field_path: str = "$") -> Any:
    """校验最小 JSON Schema 子集。

    MVP 只需要覆盖 PRD 要求的 string、number、boolean、enum、json、array 等类型。
    不引入完整 jsonschema 依赖，是为了保持平台核心轻量；后续可以替换为标准库。
    """

    value = _coerce_json_container_string(value, schema)
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
        for key, child_schema in _schema_properties(schema).items():
            if key in value:
                child_path = key if field_path == "$" else f"{field_path}.{key}"
                value[key] = validate_json_schema(value[key], child_schema, child_path)

    if expected == "array" and isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            value[index] = validate_json_schema(item, schema["items"], f"{field_path}[{index}]")
    return value


def resolve_input_mapping(
    input_mapping: dict[str, str],
    context: dict[str, Any],
    input_schema: dict[str, Any],
) -> dict[str, Any]:
    """解析输入映射，并在返回前完成强类型校验。"""

    resolved: dict[str, Any] = {}
    for field, source_path in input_mapping.items():
        if not _has_mapping_path(source_path):
            continue
        value = evaluate_mapping_expression(source_path, context)
        if _is_optional_blank_container_value(field, value, input_schema):
            continue
        resolved[field] = value
    validated = validate_json_schema(resolved, input_schema)
    return validated if isinstance(validated, dict) else resolved
