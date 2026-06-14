"""Schema 自动推导引擎。

从函数签名、AST 分析、示例值自动推导 JSON Schema。
无需 Skill 创作者手动编写 schema 定义。
"""

from __future__ import annotations

import ast
import inspect
import logging
from pathlib import Path
from typing import Any, Callable, get_type_hints

logger = logging.getLogger(__name__)

# Python 类型到 JSON Schema 类型的映射
TYPE_MAP = {
    "str": {"type": "string"},
    "int": {"type": "integer"},
    "float": {"type": "number"},
    "bool": {"type": "boolean"},
    "list": {"type": "array"},
    "dict": {"type": "object"},
    "List": {"type": "array"},
    "Dict": {"type": "object"},
    "Optional": {"type": "object", "nullable": True},
    "Any": {},
    "None": {"type": "null"},
}


class SchemaInferenceEngine:
    """Schema 自动推导引擎。"""

    def infer_from_function(self, func: Callable) -> tuple[dict, dict]:
        """从函数签名推导 input/output schema。

        Args:
            func: 要分析的函数

        Returns:
            (input_schema, output_schema) 元组
        """
        try:
            sig = inspect.signature(func)
            hints = get_type_hints(func)
        except Exception as exc:
            logger.warning("Failed to get function signature: %s", exc)
            return {"type": "object"}, {"type": "object"}

        # 推导输入 schema
        properties = {}
        required = []
        for name, param in sig.parameters.items():
            if name in ("self", "cls"):
                continue

            # 从类型注解推导
            type_hint = hints.get(name)
            prop_schema = self._type_hint_to_schema(type_hint)

            # 从默认值推导
            if param.default is not inspect.Parameter.empty:
                prop_schema["default"] = param.default
            else:
                required.append(name)

            properties[name] = prop_schema

        input_schema: dict[str, Any] = {
            "type": "object",
            "properties": properties,
        }
        if required:
            input_schema["required"] = required

        # 推导输出 schema
        return_hint = hints.get("return")
        output_schema = self._type_hint_to_schema(return_hint)

        return input_schema, output_schema

    def infer_from_ast(self, file_path: Path) -> tuple[dict, dict, str | None]:
        """从 AST 分析推导 schema（不需要执行代码）。

        Args:
            file_path: Python 文件路径

        Returns:
            (input_schema, output_schema, function_name) 元组
        """
        try:
            content = file_path.read_text(encoding="utf-8")
            tree = ast.parse(content)
        except Exception as exc:
            logger.warning("Failed to parse AST: %s", exc)
            return {"type": "object"}, {"type": "object"}, None

        # 查找主函数
        main_func = self._find_main_function(tree)
        if not main_func:
            return {"type": "object"}, {"type": "object"}, None

        # 推导输入 schema
        properties = {}
        required = []
        for arg in main_func.args.args:
            if arg.arg in ("self", "cls"):
                continue

            prop_schema = self._ast_annotation_to_schema(arg.annotation)
            properties[arg.arg] = prop_schema

            # 检查是否有默认值
            defaults = main_func.args.defaults
            args_count = len(main_func.args.args)
            defaults_count = len(defaults)
            arg_index = main_func.args.args.index(arg)
            default_index = arg_index - (args_count - defaults_count)
            if default_index < 0:
                required.append(arg.arg)

        input_schema: dict[str, Any] = {
            "type": "object",
            "properties": properties,
        }
        if required:
            input_schema["required"] = required

        # 推导输出 schema
        output_schema = self._ast_annotation_to_schema(main_func.returns)

        return input_schema, output_schema, main_func.name

    def infer_from_sample_value(self, value: Any) -> dict:
        """从示例值推导 schema。

        Args:
            value: 示例值

        Returns:
            JSON Schema 字典
        """
        return self._value_to_schema(value)

    def infer_from_sample_execution(self, func: Callable, sample_input: dict) -> dict:
        """通过执行一次推导 output schema。

        Args:
            func: 要执行的函数
            sample_input: 示例输入

        Returns:
            output JSON Schema
        """
        try:
            result = func(**sample_input)
            return self._value_to_schema(result)
        except Exception as exc:
            logger.warning("Failed to execute function for schema inference: %s", exc)
            return {"type": "object"}

    def _type_hint_to_schema(self, type_hint: Any) -> dict:
        """将 Python 类型注解转换为 JSON Schema。"""
        if type_hint is None:
            return {}

        # 处理字符串类型的注解
        if isinstance(type_hint, str):
            return TYPE_MAP.get(type_hint, {"type": "string"})

        # 处理类型对象
        type_name = getattr(type_hint, "__name__", None)
        if type_name:
            return TYPE_MAP.get(type_name, {"type": "string"})

        # 处理泛型类型
        origin = getattr(type_hint, "__origin__", None)
        if origin:
            if origin is list:
                args = getattr(type_hint, "__args__", None)
                if args:
                    return {"type": "array", "items": self._type_hint_to_schema(args[0])}
                return {"type": "array"}
            if origin is dict:
                args = getattr(type_hint, "__args__", None)
                if args and len(args) >= 2:
                    return {"type": "object", "additionalProperties": self._type_hint_to_schema(args[1])}
                return {"type": "object"}

        return {}

    def _ast_annotation_to_schema(self, annotation: Any) -> dict:
        """将 AST 类型注解转换为 JSON Schema。"""
        if annotation is None:
            return {}

        if isinstance(annotation, ast.Name):
            return TYPE_MAP.get(annotation.id, {"type": "string"})

        if isinstance(annotation, ast.Constant):
            return {"type": "string", "const": annotation.value}

        if isinstance(annotation, ast.Subscript):
            # 处理 List[X], Dict[K, V] 等
            if isinstance(annotation.value, ast.Name):
                if annotation.value.id in ("List", "list"):
                    if isinstance(annotation.slice, ast.Name):
                        return {"type": "array", "items": self._ast_annotation_to_schema(annotation.slice)}
                    return {"type": "array"}
                if annotation.value.id in ("Dict", "dict"):
                    return {"type": "object"}

        return {}

    def _value_to_schema(self, value: Any, depth: int = 0) -> dict:
        """将值转换为 JSON Schema。"""
        if depth > 10:
            return {}

        if value is None:
            return {"type": "null"}

        if isinstance(value, bool):
            return {"type": "boolean"}

        if isinstance(value, int):
            return {"type": "integer"}

        if isinstance(value, float):
            return {"type": "number"}

        if isinstance(value, str):
            return {"type": "string"}

        if isinstance(value, list):
            if not value:
                return {"type": "array"}
            # 推导第一个元素的 schema
            items_schema = self._value_to_schema(value[0], depth + 1)
            return {"type": "array", "items": items_schema}

        if isinstance(value, dict):
            if not value:
                return {"type": "object"}
            properties = {}
            for key, val in value.items():
                if isinstance(key, str):
                    properties[key] = self._value_to_schema(val, depth + 1)
            return {"type": "object", "properties": properties}

        # 其他类型转为字符串
        return {"type": "string"}

    def _find_main_function(self, tree: ast.Module) -> ast.FunctionDef | None:
        """查找主函数。"""
        # 优先查找常见名称
        priority_names = {"run", "main", "predict", "query", "chat", "invoke", "execute", "call"}

        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.FunctionDef) and node.name in priority_names:
                return node

        # 查找第一个公开函数
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                return node

        return None
