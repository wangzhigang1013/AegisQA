"""通用 Skill 执行器。

自动检测类型 → 选择适配器 → 执行 → 统一输出。
实现"平台适配 Skill，而非 Skill 适配平台"的核心理念。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from aegisqa.skills.adapters.base import SkillAdapter
from aegisqa.skills.adapters.langchain_adapter import LangChainAdapter
from aegisqa.skills.adapters.llamaindex_adapter import LlamaIndexAdapter
from aegisqa.skills.adapters.langgraph_adapter import LangGraphAdapter
from aegisqa.skills.adapters.huggingface import HuggingFaceAdapter
from aegisqa.skills.adapters.rest_api import RestApiAdapter
from aegisqa.skills.adapters.openai_tool import OpenAIToolAdapter
from aegisqa.skills.adapters.python_function import PythonFunctionAdapter
from aegisqa.skills.base import BaseSkill, SkillManifest
from aegisqa.skills.detector import SkillDetectionResult, SkillType, detect_skill_type
from aegisqa.skills.registry import SkillRegistry

logger = logging.getLogger(__name__)


class UniversalSkillRunner:
    """通用 Skill 执行器。

    自动检测类型 → 选择适配器 → 执行 → 统一输出。

    使用方式：
    ```python
    runner = UniversalSkillRunner()
    manifest = runner.auto_register(package_dir, registry)
    ```

    支持的 Skill 类型：
    1. 原生 AegisQA (skill.yaml + handler.py:run)
    2. 裸 Python 函数 (任意签名)
    3. LangChain Chain/Agent
    4. LlamaIndex QueryEngine/ChatEngine
    5. OpenAI Function Tool
    6. REST API Endpoint
    7. gRPC Service
    8. HuggingFace Pipeline
    9. Semantic Kernel Plugin
    10. LangGraph Agent
    11. Docker 容器
    12. 纯指令型 (SKILL.md)
    """

    def __init__(self) -> None:
        self._adapters: dict[SkillType, SkillAdapter] = {
            SkillType.LANGCHAIN: LangChainAdapter(),
            SkillType.LLAMAINDEX: LlamaIndexAdapter(),
            SkillType.LANGGRAPH: LangGraphAdapter(),
            SkillType.HUGGINGFACE: HuggingFaceAdapter(),
            SkillType.REST_API: RestApiAdapter(),
            SkillType.OPENAI_TOOL: OpenAIToolAdapter(),
            SkillType.PYTHON_FUNCTION: PythonFunctionAdapter(),
        }
        self._detection_results: dict[str, SkillDetectionResult] = {}

    def auto_register(self, package_dir: Path, registry: SkillRegistry) -> SkillManifest:
        """自动检测并注册 Skill。

        Args:
            package_dir: Skill 包目录
            registry: Skill 注册表

        Returns:
            注册的 SkillManifest

        Raises:
            ValueError: 如果无法识别 Skill 类型
        """
        package_dir = Path(package_dir)
        if not package_dir.exists():
            raise ValueError(f"目录不存在: {package_dir}")

        # 1. 检测类型
        detection = detect_skill_type(package_dir)
        self._detection_results[str(package_dir)] = detection

        logger.info("Detected skill type: %s (confidence=%.2f) for %s",
                   detection.skill_type.value, detection.confidence, package_dir)

        # 2. 对于原生类型，使用现有流程
        if detection.skill_type == SkillType.AEGISQA_NATIVE:
            logger.info("Using native AegisQA registration for %s", package_dir)
            return self._register_native(package_dir, registry, detection)

        # 3. 对于指令型，使用现有流程
        if detection.skill_type == SkillType.INSTRUCTION:
            logger.info("Using instruction registration for %s", package_dir)
            return self._register_instruction(package_dir, registry, detection)

        # 4. 对于容器型，使用现有流程
        if detection.skill_type == SkillType.CONTAINER:
            logger.info("Using container registration for %s", package_dir)
            return self._register_container(package_dir, registry, detection)

        # 5. 使用适配器
        adapter = self._adapters.get(detection.skill_type)
        if not adapter:
            raise ValueError(f"不支持的 Skill 类型: {detection.skill_type.value}")

        # 6. 推导 manifest
        manifest = adapter.infer_manifest(package_dir, detection.metadata)

        # 7. 创建 Skill 实例
        skill = adapter.create_skill(package_dir, manifest)

        # 8. 注册到 registry
        registry.register(skill)

        logger.info("Registered %s skill: %s (%s)",
                   detection.skill_type.value, manifest.skill_id, manifest.name)

        return manifest

    def get_detection_result(self, package_dir: Path) -> SkillDetectionResult | None:
        """获取检测结果。"""
        return self._detection_results.get(str(package_dir))

    def list_supported_types(self) -> list[dict[str, Any]]:
        """列出支持的 Skill 类型。"""
        return [
            {"type": "aegisqa_native", "name": "原生 AegisQA", "description": "skill.yaml + handler.py:run"},
            {"type": "python_function", "name": "Python 函数", "description": "任意签名的 Python 函数"},
            {"type": "langchain", "name": "LangChain", "description": "LangChain Chain/Agent/Runnable"},
            {"type": "llamaindex", "name": "LlamaIndex", "description": "LlamaIndex QueryEngine/ChatEngine"},
            {"type": "openai_tool", "name": "OpenAI Tool", "description": "OpenAI Function Calling 工具"},
            {"type": "rest_api", "name": "REST API", "description": "HTTP API 端点"},
            {"type": "grpc", "name": "gRPC", "description": "gRPC 服务"},
            {"type": "huggingface", "name": "HuggingFace", "description": "HuggingFace Pipeline"},
            {"type": "semantic_kernel", "name": "Semantic Kernel", "description": "Semantic Kernel Plugin"},
            {"type": "langgraph", "name": "LangGraph", "description": "LangGraph Agent/Graph"},
            {"type": "container", "name": "Docker 容器", "description": "Docker 容器化 Skill"},
            {"type": "instruction", "name": "指令型", "description": "纯 SKILL.md 指令"},
        ]

    def _register_native(self, package_dir: Path, registry: SkillRegistry, detection: SkillDetectionResult) -> SkillManifest:
        """注册原生 AegisQA Skill。"""
        from aegisqa.skills.packages import resolve_package_entrypoint

        handler_path = detection.handler_path or (package_dir / "handler.py")
        if not handler_path.exists():
            raise ValueError(f"找不到 handler.py: {package_dir}")

        # 解析入口点
        entrypoint_path, function_name, _ = resolve_package_entrypoint(package_dir, f"handler.py:{detection.function_name or 'run'}")

        # 加载 manifest
        manifest_data = detection.manifest_data or {}
        from aegisqa.skills.base import SkillManifest
        manifest = SkillManifest(**{k: v for k, v in manifest_data.items() if k in SkillManifest.model_fields})

        # 创建 Skill
        from aegisqa.skills.packages import SubprocessPackageSkill
        skill = SubprocessPackageSkill(manifest, entrypoint_path, package_root=package_dir, function_name=function_name)

        registry.register(skill)
        return manifest

    def _register_instruction(self, package_dir: Path, registry: SkillRegistry, detection: SkillDetectionResult) -> SkillManifest:
        """注册指令型 Skill。"""
        from aegisqa.skills.packages import InstructionPackageSkill, build_instruction_manifest_from_skill_md

        manifest = build_instruction_manifest_from_skill_md(package_dir)
        skill = InstructionPackageSkill(manifest, package_dir, runtime_mode="instruction_model")

        registry.register(skill)
        return manifest

    def _register_container(self, package_dir: Path, registry: SkillRegistry, detection: SkillDetectionResult) -> SkillManifest:
        """注册容器型 Skill。"""
        # 容器型使用现有的 SubprocessPackageSkill，自动回退到容器模式
        from aegisqa.skills.packages import SubprocessPackageSkill, resolve_package_entrypoint
        from aegisqa.skills.base import SkillManifest

        # 加载 manifest
        manifest_data = detection.manifest_data or {}
        if not manifest_data:
            import yaml
            for name in ["skill.yaml", "skill.yml", "skill.json"]:
                path = package_dir / name
                if path.exists():
                    manifest_data = yaml.safe_load(path.read_text(encoding="utf-8"))
                    break

        manifest = SkillManifest(**{k: v for k, v in manifest_data.items() if k in SkillManifest.model_fields})

        # 查找 handler
        handler_path = package_dir / "handler.py"
        if handler_path.exists():
            entrypoint_path, function_name, _ = resolve_package_entrypoint(package_dir, "handler.py:run")
            skill = SubprocessPackageSkill(manifest, entrypoint_path, package_root=package_dir, function_name=function_name)
        else:
            # 没有 handler.py，使用指令型
            from aegisqa.skills.packages import InstructionPackageSkill
            skill = InstructionPackageSkill(manifest, package_dir, runtime_mode="instruction_model")

        registry.register(skill)
        return manifest


# 全局单例
_universal_runner: UniversalSkillRunner | None = None


def get_universal_runner() -> UniversalSkillRunner:
    """获取全局 UniversalSkillRunner 实例。"""
    global _universal_runner
    if _universal_runner is None:
        _universal_runner = UniversalSkillRunner()
    return _universal_runner


def auto_register_skill(package_dir: Path, registry: SkillRegistry) -> SkillManifest:
    """便捷函数：自动检测并注册 Skill。"""
    return get_universal_runner().auto_register(package_dir, registry)
