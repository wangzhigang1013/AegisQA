"""裸 Python 函数适配器。

支持任意签名的 Python 函数，自动推导 schema。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from aegisqa.skills.adapters.base import SkillAdapter
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.detector import _find_handler, _find_manifest_file
from aegisqa.skills.schema_inference import SchemaInferenceEngine

logger = logging.getLogger(__name__)


class PythonFunctionAdapter(SkillAdapter):
    """裸 Python 函数适配器。

    支持任意签名的 Python 函数：
    - run(question: str) -> str
    - run(data: dict) -> dict
    - run(text: str, temperature: float = 0.7) -> dict
    - predict(input_data: Any) -> Any
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否有 handler.py 但无 skill.yaml。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            return False
        # 有 handler.py 但没有 skill.yaml
        return not _find_manifest_file(package_dir)

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从函数签名自动推导 manifest。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            raise ValueError(f"找不到 handler.py: {package_dir}")

        # 使用 Schema 推导引擎
        engine = SchemaInferenceEngine()
        input_schema, output_schema, func_name = engine.infer_from_ast(handler_path)

        # 获取函数信息
        func_info = metadata.get("function_info", {}) if metadata else {}

        # 生成 skill_id
        skill_id = f"custom.{package_dir.name}@0.1.0"

        return SkillManifest(
            skill_id=skill_id,
            name=func_info.get("name", package_dir.name),
            version="0.1.0",
            description=func_info.get("docstring", f"自动导入的 Python 函数: {func_name or 'unknown'}"),
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={"type": "object", "properties": {}},
            permissions=[],
            cacheable=True,
            enabled=True,
            status="approved",
            tags=["auto-imported", "python-function"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建包装后的 Skill。"""
        return PythonFunctionSkill(package_dir, manifest)


class PythonFunctionSkill(BaseSkill):
    """包装任意 Python 函数为 AegisQA Skill。"""

    manifest: SkillManifest  # 类型注解

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest  # 必须在 super().__init__() 之前设置
        self._package_dir = package_dir
        self._handler_module = None
        self._handler_func = None
        super().__init__()

    def _ensure_handler(self):
        """延迟加载 handler 模块。"""
        if self._handler_module is not None:
            return

        handler_path = _find_handler(self._package_dir)
        if not handler_path:
            raise RuntimeError(f"找不到 handler.py: {self._package_dir}")

        # 动态导入 handler 模块
        import importlib.util
        spec = importlib.util.spec_from_file_location("handler", handler_path)
        if not spec or not spec.loader:
            raise RuntimeError(f"无法加载 handler 模块: {handler_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules["handler"] = module
        spec.loader.exec_module(module)
        self._handler_module = module

        # 查找主函数
        func_name = None
        for name in ["run", "main", "predict", "query", "chat", "invoke", "execute", "call"]:
            if hasattr(module, name):
                func_name = name
                break

        if not func_name:
            # 查找第一个公开函数
            for name in dir(module):
                if not name.startswith("_") and callable(getattr(module, name)):
                    func_name = name
                    break

        if not func_name:
            raise RuntimeError(f"handler.py 中找不到可调用函数: {handler_path}")

        self._handler_func = getattr(module, func_name)

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 Python 函数。"""
        self._ensure_handler()

        # 合并 inputs 和 config
        kwargs = {**inputs, **config}

        # 调用函数
        result = self._handler_func(**kwargs)

        # 包装结果
        if isinstance(result, dict):
            if "output" in result:
                # 已经是 SkillResult 格式
                return SkillResult(
                    output=result.get("output", {}),
                    metrics=result.get("metrics", {}),
                    artifacts=result.get("artifacts", {}),
                    logs=result.get("logs", []),
                )
            else:
                # 普通 dict，作为 output
                return SkillResult(output=result)
        else:
            # 非 dict 结果，包装为 {"result": value}
            return SkillResult(output={"result": result})
