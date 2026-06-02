"""Skill 注册表。"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import yaml

from aegisqa.skills.base import BaseSkill, SkillManifest
from aegisqa.skills.examples import APIPullSkill, ASREvalSkill, CSVLoaderSkill, DBQuerySkill, JSONLLoaderSkill, LLMCallSkill, LLMJudgeSkill, ModelChatSkill, OnlineSampleSkill


class SkillRegistry:
    """内存 Skill 注册表。

    MVP 允许从可信目录扫描 manifest，同时内置几个示例 Skill。生产化时可以把本类
    替换成数据库注册表，并接入审批、禁用和废弃流程。
    """

    def __init__(self) -> None:
        self._skills: dict[str, BaseSkill] = {}
        self._external_manifests: dict[str, SkillManifest] = {}

    @classmethod
    def with_builtin_skills(cls) -> "SkillRegistry":
        registry = cls()
        for skill in [CSVLoaderSkill(), JSONLLoaderSkill(), DBQuerySkill(), APIPullSkill(), OnlineSampleSkill(), ModelChatSkill(), LLMCallSkill(), LLMJudgeSkill(), ASREvalSkill()]:
            registry.register(skill)
        return registry

    def register(self, skill: BaseSkill) -> None:
        self._skills[skill.manifest.skill_id] = skill

    def get(self, skill_id: str) -> BaseSkill:
        if skill_id not in self._skills:
            raise KeyError(f"未注册的 Skill：{skill_id}")
        return self._skills[skill_id]

    def get_manifest(self, skill_id: str) -> SkillManifest:
        if skill_id in self._skills:
            return self._skills[skill_id].manifest
        if skill_id in self._external_manifests:
            return self._external_manifests[skill_id]
        raise KeyError(f"未注册的 Skill：{skill_id}")

    def list_skills(self) -> list[SkillManifest]:
        manifests = [skill.manifest for skill in self._skills.values()]
        manifests.extend(self._external_manifests.values())
        return sorted(manifests, key=lambda item: item.skill_id)

    def disable(self, skill_id: str, reason: str = "") -> SkillManifest:
        manifest = self.get_manifest(skill_id)
        manifest.enabled = False
        manifest.status = "disabled"
        manifest.governance_note = reason
        return manifest

    def approve(self, skill_id: str) -> SkillManifest:
        manifest = self.get_manifest(skill_id)
        manifest.enabled = True
        manifest.status = "approved"
        manifest.governance_note = None
        return manifest

    def deprecate(self, skill_id: str, reason: str = "") -> SkillManifest:
        manifest = self.get_manifest(skill_id)
        manifest.enabled = False
        manifest.status = "deprecated"
        manifest.governance_note = reason
        return manifest

    def can_reference_new_workflow(self, skill_id: str) -> bool:
        """判断 Skill 是否允许被新 Workflow 引用。

        历史 Run 回放仍可通过 `get()` 获取 Skill；这里单独提供新建引用判断，
        对应 PRD 中“禁用版本不可被新 Workflow 引用，但历史 Run 可回放”。
        """

        manifest = self.get_manifest(skill_id)
        return manifest.enabled and manifest.status == "approved"

    def scan_manifest_dir(self, directory: Path) -> list[SkillManifest]:
        """扫描可信目录中的 manifest YAML/JSON。

        这里只注册 manifest 元数据，不执行任意 Python 代码，符合 PRD 中“可信来源”
        和“不允许任意用户上传未审查代码生产执行”的边界。
        """

        loaded: list[SkillManifest] = []
        for path in _manifest_files(directory):
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            manifest = SkillManifest(**data)
            self._external_manifests[manifest.skill_id] = manifest
            loaded.append(manifest)
        return loaded


def _manifest_files(directory: Path) -> Iterable[Path]:
    if not directory.exists():
        return []
    return [path for pattern in ("*.yaml", "*.yml", "*.json") for path in directory.rglob(pattern)]
