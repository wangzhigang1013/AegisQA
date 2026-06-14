"""Skill 适配器基类。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from aegisqa.skills.base import BaseSkill, SkillManifest


class SkillAdapter(ABC):
    """Skill 适配器基类。

    每个适配器负责：
    1. 检测是否匹配某种 Skill 格式
    2. 自动推导 manifest（包括 input/output schema）
    3. 创建可执行的 Skill 实例
    """

    @abstractmethod
    def detect(self, package_dir: Path) -> bool:
        """检测是否匹配此适配器。

        Args:
            package_dir: Skill 包目录

        Returns:
            是否匹配
        """

    @abstractmethod
    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """自动推导 manifest。

        Args:
            package_dir: Skill 包目录
            metadata: 检测器返回的元数据

        Returns:
            推导出的 SkillManifest
        """

    @abstractmethod
    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建可执行的 Skill 实例。

        Args:
            package_dir: Skill 包目录
            manifest: Skill manifest

        Returns:
            BaseSkill 实例
        """

    def get_priority(self) -> int:
        """获取适配器优先级（数值越小优先级越高）。"""
        return 100
