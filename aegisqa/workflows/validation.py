"""Workflow 发布和任务预检共享的线性 Step 合约校验。"""

from __future__ import annotations

from typing import Any

from aegisqa.core.mapper import MappingPathError, TypeMismatchError, validate_json_schema
from aegisqa.core.security import redact_secrets
from aegisqa.skills.base import SkillManifest
from aegisqa.skills.registry import SkillRegistry


def validate_workflow_step_contracts(
    registry: SkillRegistry,
    steps: list[Any],
    *,
    include_skill_availability: bool = False,
) -> list[dict[str, Any]]:
    """校验线性 Workflow Step 是否满足 Skill manifest 合约。

    React Flow 图发布会走 `WorkflowGraphService`，但历史 Workflow 和兼容
    `/workflows/publish` 入口仍然以线性 Step 为事实源；这里把同类错误前移到发布
    和 Task Preflight 阶段，避免执行期才因缺少入参失败。
    """

    issues: list[dict[str, Any]] = []
    for step in steps:
        step_id = str(getattr(step, "step_id", ""))
        skill_ref = str(getattr(step, "skill_ref", ""))
        try:
            manifest = registry.get_manifest(skill_ref)
        except KeyError:
            if include_skill_availability:
                issues.append({"code": "SKILL_NOT_FOUND", "step_id": step_id, "skill_ref": skill_ref, "message": f"未注册的 Skill：{skill_ref}"})
            continue

        if include_skill_availability and (not manifest.enabled or manifest.status != "approved"):
            issues.append(
                {
                    "code": "SKILL_NOT_AVAILABLE",
                    "step_id": step_id,
                    "skill_ref": skill_ref,
                    "status": manifest.status,
                    "message": f"Skill 不允许被新 Workflow 引用：{skill_ref}",
                }
            )

        issues.extend(validate_static_skill_config(manifest, step_id, skill_ref, getattr(step, "config", {}) or {}))

        input_mapping = getattr(step, "input_mapping", {}) or {}
        output_mapping = getattr(step, "output_mapping", {}) or {}
        required_inputs = _string_list(manifest.input_schema.get("required", []))
        missing_inputs = [field for field in required_inputs if not _mapping_path(input_mapping.get(field))]
        if missing_inputs:
            issues.append(
                {
                    "code": "REQUIRED_INPUT_MAPPING_MISSING",
                    "step_id": step_id,
                    "skill_ref": skill_ref,
                    "missing_fields": missing_inputs,
                    "message": f"Skill 必填输入未配置字段映射：{', '.join(missing_inputs)}",
                }
            )

        # 可选输入留空代表“不传该字段”，只有 required 字段会通过
        # REQUIRED_INPUT_MAPPING_MISSING 阻断发布。

        empty_outputs = sorted(field for field, path in output_mapping.items() if not _mapping_path(path))
        if empty_outputs:
            issues.append(
                {
                    "code": "OUTPUT_MAPPING_PATH_EMPTY",
                    "step_id": step_id,
                    "skill_ref": skill_ref,
                    "fields": empty_outputs,
                    "message": f"输出写入路径不能为空：{', '.join(empty_outputs)}",
                }
            )
    return issues


def validate_static_skill_config(
    manifest: SkillManifest,
    step_id: str,
    skill_ref: str,
    workflow_config: dict[str, Any],
    *,
    task_override: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """静态校验 Skill 参数声明。

    这里不解析 `runtime_expression`，因为 Workflow 发布时还没有绑定具体 Dataset；
    但必填参数、固定值类型和动态声明语法必须提前检查，避免坏 Workflow 被发布。
    """

    schema = manifest.config_schema or {"type": "object", "properties": {}}
    properties = schema.get("properties", {}) if isinstance(schema.get("properties", {}), dict) else {}
    task_override = task_override or {}
    issues: list[dict[str, Any]] = []
    configured_fields = set(_schema_default_fields(schema)) | set(workflow_config) | set(task_override)
    missing_fields = [field for field in _string_list(schema.get("required", [])) if field not in configured_fields]
    if missing_fields:
        issues.append(
            {
                "code": "CONFIG_REQUIRED_MISSING",
                "step_id": step_id,
                "skill_ref": skill_ref,
                "missing_fields": missing_fields,
                "message": f"Skill 必填参数未配置：{', '.join(missing_fields)}",
            }
        )

    for source, values in (("workflow_config", workflow_config), ("task_override", task_override)):
        for field, value in values.items():
            field_schema = properties.get(field)
            if not isinstance(field_schema, dict):
                continue
            dynamic_issue = _validate_dynamic_config_declaration(step_id, skill_ref, field, value, source)
            if dynamic_issue:
                issues.append(dynamic_issue)
                continue
            if _is_dynamic_config_value(value):
                continue
            try:
                validate_json_schema(value, field_schema, field)
            except TypeMismatchError as exc:
                issues.append(config_issue_from_exception(step_id, skill_ref, exc, source=source))
    return issues


def config_issue_from_exception(step_id: str, skill_ref: str, exc: Exception, *, source: str = "resolved_config") -> dict[str, Any]:
    """把参数解析异常转换成前端和 Preflight 都能展示的结构化问题。"""

    if isinstance(exc, TypeMismatchError):
        field_path = _normalise_field_path(exc.field_path)
        if exc.expected_type == "required" and exc.actual_type == "missing":
            return {
                "code": "CONFIG_REQUIRED_MISSING",
                "step_id": step_id,
                "skill_ref": skill_ref,
                "source": source,
                "missing_fields": [field_path],
                "message": f"Skill 必填参数未配置：{field_path}",
            }
        return {
            "code": "CONFIG_VALUE_INVALID",
            "step_id": step_id,
            "skill_ref": skill_ref,
            "source": source,
            "field_path": field_path,
            "expected_type": exc.expected_type,
            "actual_type": exc.actual_type,
            "actual_value_preview": redact_secrets(exc.actual_value),
            "message": f"Skill 参数 {field_path} 类型不匹配：期望 {exc.expected_type}，实际 {exc.actual_type}",
        }
    if isinstance(exc, MappingPathError):
        message = str(exc)
        code = "CONFIG_DYNAMIC_VALUE_INVALID"
        if "表达式路径不能为空" in message:
            code = "CONFIG_EXPRESSION_PATH_EMPTY"
        elif "Secret 名称不能为空" in message:
            code = "CONFIG_SECRET_REF_EMPTY"
        elif "路径不存在" in message:
            code = "CONFIG_EXPRESSION_PATH_MISSING"
        return {"code": code, "step_id": step_id, "skill_ref": skill_ref, "source": source, "message": message}
    return {"code": "CONFIG_SCHEMA_INVALID", "step_id": step_id, "skill_ref": skill_ref, "source": source, "message": str(exc)}


def _schema_default_fields(schema: dict[str, Any]) -> list[str]:
    properties = schema.get("properties", {}) if isinstance(schema.get("properties", {}), dict) else {}
    return [field for field, child_schema in properties.items() if isinstance(child_schema, dict) and "default" in child_schema]


def _validate_dynamic_config_declaration(step_id: str, skill_ref: str, field: str, value: Any, source: str) -> dict[str, Any] | None:
    if not _is_dynamic_config_value(value):
        return None
    value_type = value.get("type")
    if value_type == "expression" and not _mapping_path(value.get("path")):
        return {
            "code": "CONFIG_EXPRESSION_PATH_EMPTY",
            "step_id": step_id,
            "skill_ref": skill_ref,
            "source": source,
            "field_path": field,
            "message": f"Skill 参数 {field} 的表达式路径不能为空",
        }
    if value_type == "secret" and not _mapping_path(value.get("name")):
        return {
            "code": "CONFIG_SECRET_REF_EMPTY",
            "step_id": step_id,
            "skill_ref": skill_ref,
            "source": source,
            "field_path": field,
            "message": f"Skill 参数 {field} 的 Secret 名称不能为空",
        }
    return None


def _is_dynamic_config_value(value: Any) -> bool:
    return isinstance(value, dict) and value.get("type") in {"expression", "secret"}


def _mapping_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _normalise_field_path(field_path: str) -> str:
    return field_path.removeprefix("$.")
