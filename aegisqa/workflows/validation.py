"""Workflow 发布和任务预检共享的线性 Step 合约校验。"""

from __future__ import annotations

from typing import Any

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

        empty_inputs = sorted(field for field, path in input_mapping.items() if not _mapping_path(path))
        if empty_inputs:
            issues.append(
                {
                    "code": "INPUT_MAPPING_PATH_EMPTY",
                    "step_id": step_id,
                    "skill_ref": skill_ref,
                    "fields": empty_inputs,
                    "message": f"输入映射路径不能为空：{', '.join(empty_inputs)}",
                }
            )

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


def _mapping_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]
