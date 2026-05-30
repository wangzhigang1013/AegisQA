"""Skill 参数解析与来源追踪。

Workflow 节点配置、任务级覆盖、运行时表达式和 Secret 引用如果散落在各处处理，
Trace 和报告就无法解释“这个 Skill 到底用了什么参数”。本模块把解析规则收口，
并为每个最终参数生成可持久化的来源说明。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aegisqa.core.mapper import MappingPathError, get_by_path, validate_json_schema
from aegisqa.core.security import REDACTED, redact_secrets


@dataclass(slots=True)
class ResolvedSkillParameters:
    """Skill 最终参数和字段级来源。"""

    config: dict[str, Any]
    trace: dict[str, dict[str, Any]]


class SkillParameterResolver:
    """按固定优先级解析 Skill config。

    优先级固定为：
    schema default < workflow config < task override < runtime expression < secret ref。
    其中 expression 和 secret 是值级声明，因此会在覆盖合并后最后解析。
    """

    def __init__(self, config_schema: dict[str, Any]) -> None:
        self.config_schema = config_schema or {"type": "object", "properties": {}}

    def resolve(
        self,
        *,
        workflow_config: dict[str, Any] | None = None,
        task_override: dict[str, Any] | None = None,
        runtime_context: dict[str, Any] | None = None,
        secret_values: dict[str, str] | None = None,
    ) -> ResolvedSkillParameters:
        workflow_config = workflow_config or {}
        task_override = task_override or {}
        runtime_context = runtime_context or {}
        secret_values = secret_values or {}

        config, trace = self._schema_defaults()
        self._merge_values(config, trace, workflow_config, source="workflow_config")
        self._merge_values(config, trace, task_override, source="task_override")
        self._resolve_dynamic_values(config, trace, runtime_context, secret_values)
        validate_json_schema(config, self.config_schema)
        return ResolvedSkillParameters(config=config, trace=trace)

    def _schema_defaults(self) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        config: dict[str, Any] = {}
        trace: dict[str, dict[str, Any]] = {}
        for field, schema in self.config_schema.get("properties", {}).items():
            if isinstance(schema, dict) and "default" in schema:
                value = schema["default"]
                config[field] = value
                trace[field] = self._trace(source="schema_default", value=value)
        return config, trace

    def _merge_values(self, config: dict[str, Any], trace: dict[str, dict[str, Any]], values: dict[str, Any], *, source: str) -> None:
        for field, value in values.items():
            config[field] = value
            trace[field] = self._trace(source=source, value=value)

    def _resolve_dynamic_values(
        self,
        config: dict[str, Any],
        trace: dict[str, dict[str, Any]],
        runtime_context: dict[str, Any],
        secret_values: dict[str, str],
    ) -> None:
        for field, value in list(config.items()):
            if not isinstance(value, dict) or "type" not in value:
                continue
            value_type = value.get("type")
            if value_type == "expression":
                expression_path = str(value.get("path") or "")
                if not expression_path:
                    raise MappingPathError(f"参数 {field} 的表达式路径不能为空")
                resolved = get_by_path(runtime_context, expression_path)
                config[field] = resolved
                trace[field] = self._trace(source="runtime_expression", value=resolved, expression_path=expression_path)
            elif value_type == "secret":
                secret_name = str(value.get("name") or "")
                if not secret_name:
                    raise MappingPathError(f"参数 {field} 的 Secret 名称不能为空")
                config[field] = secret_values.get(secret_name, f"secret://{secret_name}")
                trace[field] = self._trace(source="secret_ref", value=REDACTED, secret_ref=secret_name, redacted=True)

    def _trace(
        self,
        *,
        source: str,
        value: Any,
        expression_path: str | None = None,
        secret_ref: str | None = None,
        redacted: bool = False,
    ) -> dict[str, Any]:
        preview = REDACTED if redacted else redact_secrets(value)
        trace: dict[str, Any] = {
            "source": source,
            "value_preview": preview,
            "redacted": redacted,
        }
        if expression_path:
            trace["expression_path"] = expression_path
        if secret_ref:
            trace["secret_ref"] = secret_ref
        return trace
