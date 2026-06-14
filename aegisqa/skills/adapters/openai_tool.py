"""OpenAI Function Tool 适配器。

支持 OpenAI function calling 格式的工具定义。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from aegisqa.skills.adapters.base import SkillAdapter
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.detector import _find_manifest_file

logger = logging.getLogger(__name__)


class OpenAIToolAdapter(SkillAdapter):
    """OpenAI Function Tool 适配器。

    skill.yaml 示例：
    ```yaml
    openai_tool: true
    name: get_weather
    description: Get current weather for a location
    parameters:
      type: object
      properties:
        location:
          type: string
          description: City name
      required: [location]
    ```
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否为 OpenAI Tool Skill。"""
        manifest_file = _find_manifest_file(package_dir)
        if not manifest_file:
            return False

        try:
            manifest = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))
            if manifest.get("openai_tool") or manifest.get("tool_type") == "openai":
                return True
            runtime = manifest.get("runtime", {})
            if isinstance(runtime, dict) and runtime.get("type") == "openai_tool":
                return True
        except Exception:
            pass

        return False

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从 OpenAI Tool 定义推导 manifest。"""
        manifest_file = _find_manifest_file(package_dir)
        if not manifest_file:
            raise ValueError(f"找不到 skill.yaml: {package_dir}")

        tool_def = yaml.safe_load(manifest_file.read_text(encoding="utf-8"))

        # OpenAI Tool 格式
        name = tool_def.get("name", package_dir.name)
        description = tool_def.get("description", "")
        parameters = tool_def.get("parameters", {})

        # 转换为 AegisQA schema
        input_schema = parameters if parameters else {"type": "object", "properties": {}}

        # 输出 schema
        output_schema = tool_def.get("output_schema", {
            "type": "object",
            "properties": {
                "result": {"description": "工具执行结果"},
            },
        })

        skill_id = tool_def.get("skill_id", f"openai_tool.{name}@0.1.0")

        return SkillManifest(
            skill_id=skill_id,
            name=name,
            version=tool_def.get("version", "0.1.0"),
            description=description,
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={"type": "object", "properties": {}},
            permissions=tool_def.get("permissions", []),
            cacheable=tool_def.get("cacheable", True),
            enabled=True,
            status="approved",
            tags=["auto-imported", "openai-tool"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建 OpenAI Tool Skill。"""
        return OpenAIToolSkill(package_dir, manifest)

    def get_priority(self) -> int:
        return 45


class OpenAIToolSkill(BaseSkill):
    """OpenAI Function Tool 包装器。"""

    manifest: SkillManifest

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest
        self._package_dir = package_dir
        self._handler_func = None
        super().__init__()

    def _ensure_handler(self):
        """延迟加载 handler。"""
        if self._handler_func is not None:
            return

        # 查找 handler.py
        handler_path = None
        for name in ["handler.py", "main.py", "tool.py", "function.py"]:
            path = self._package_dir / name
            if path.exists():
                handler_path = path
                break

        if not handler_path:
            raise RuntimeError(f"找不到 handler: {self._package_dir}")

        import importlib.util
        import sys

        spec = importlib.util.spec_from_file_location("handler", handler_path)
        if not spec or not spec.loader:
            raise RuntimeError(f"无法加载 handler 模块: {handler_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules["handler"] = module
        spec.loader.exec_module(module)

        # 优先查找工具名（OpenAI Tool 的函数名通常与工具名相同）
        tool_name = self._manifest.name
        if tool_name and hasattr(module, tool_name):
            self._handler_func = getattr(module, tool_name)
            return

        # 查找常见函数名
        for func_name in ["run", "execute", "call", "handler", "main"]:
            if hasattr(module, func_name):
                self._handler_func = getattr(module, func_name)
                return

        raise RuntimeError(f"找不到工具函数: {handler_path}")

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 OpenAI Tool。"""
        self._ensure_handler()

        # 调用函数
        try:
            result = self._handler_func(**inputs)
        except Exception as exc:
            logger.error("OpenAI Tool execution failed: %s", exc)
            raise

        # 包装结果
        if isinstance(result, dict):
            if "output" in result:
                return SkillResult(
                    output=result.get("output", {}),
                    metrics=result.get("metrics", {}),
                    logs=result.get("logs", []),
                )
            return SkillResult(output=result)
        else:
            return SkillResult(output={"result": result})
