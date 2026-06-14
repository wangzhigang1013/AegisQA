"""HuggingFace Pipeline 适配器。

支持 HuggingFace transformers pipeline，自动包装为 AegisQA Skill。
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

# HuggingFace pipeline 类型到 schema 的映射
PIPELINE_SCHEMAS = {
    "text-classification": {
        "input": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output": {"type": "object", "properties": {"label": {"type": "string"}, "score": {"type": "number"}}},
    },
    "text-generation": {
        "input": {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]},
        "output": {"type": "object", "properties": {"generated_text": {"type": "string"}}},
    },
    "question-answering": {
        "input": {"type": "object", "properties": {"question": {"type": "string"}, "context": {"type": "string"}}, "required": ["question", "context"]},
        "output": {"type": "object", "properties": {"answer": {"type": "string"}, "score": {"type": "number"}}},
    },
    "summarization": {
        "input": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output": {"type": "object", "properties": {"summary": {"type": "string"}}},
    },
    "translation": {
        "input": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output": {"type": "object", "properties": {"translation": {"type": "string"}}},
    },
    "fill-mask": {
        "input": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output": {"type": "object", "properties": {"filled_text": {"type": "string"}, "score": {"type": "number"}}},
    },
    "image-classification": {
        "input": {"type": "object", "properties": {"image": {"type": "string", "description": "图片 URL 或 base64"}}, "required": ["image"]},
        "output": {"type": "object", "properties": {"label": {"type": "string"}, "score": {"type": "number"}}},
    },
    "automatic-speech-recognition": {
        "input": {"type": "object", "properties": {"audio": {"type": "string", "description": "音频 URL 或 base64"}}, "required": ["audio"]},
        "output": {"type": "object", "properties": {"text": {"type": "string"}}},
    },
}


class HuggingFaceAdapter(SkillAdapter):
    """HuggingFace Pipeline 适配器。

    支持：
    - text-classification
    - text-generation
    - question-answering
    - summarization
    - translation
    - fill-mask
    - image-classification
    - automatic-speech-recognition
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否包含 HuggingFace 代码。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            return False

        try:
            content = handler_path.read_text(encoding="utf-8")
            import re
            patterns = [
                r"\bfrom\s+transformers\b",
                r"\bimport\s+transformers\b",
                r"\bfrom\s+transformers\s+import\s+pipeline\b",
            ]
            for pattern in patterns:
                if re.search(pattern, content):
                    return True
        except Exception:
            pass

        return False

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从 HuggingFace 代码推导 manifest。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            raise ValueError(f"找不到 handler.py: {package_dir}")

        # 检测 pipeline 类型
        pipeline_type = None
        if metadata:
            pipeline_type = metadata.get("pipeline_type")

        if not pipeline_type:
            content = handler_path.read_text(encoding="utf-8")
            import re
            for ptype in PIPELINE_SCHEMAS:
                if re.search(rf"pipeline\s*\(\s*['\"]({ptype})['\"]", content):
                    pipeline_type = ptype
                    break

        # 使用对应类型的 schema
        if pipeline_type and pipeline_type in PIPELINE_SCHEMAS:
            input_schema = PIPELINE_SCHEMAS[pipeline_type]["input"]
            output_schema = PIPELINE_SCHEMAS[pipeline_type]["output"]
        else:
            # 通用 schema
            engine = SchemaInferenceEngine()
            input_schema, output_schema, _ = engine.infer_from_ast(handler_path)

        skill_id = f"huggingface.{package_dir.name}@0.1.0"

        return SkillManifest(
            skill_id=skill_id,
            name=package_dir.name,
            version="0.1.0",
            description=f"HuggingFace Pipeline: {pipeline_type or 'unknown'}",
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={
                "type": "object",
                "properties": {
                    "model": {"type": "string", "description": "模型名称或路径"},
                    "device": {"type": "string", "description": "设备（cpu/cuda）"},
                    "batch_size": {"type": "integer", "description": "批处理大小"},
                },
            },
            permissions=["model:call"],
            cacheable=True,
            enabled=True,
            status="approved",
            tags=["auto-imported", "huggingface"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建 HuggingFace Skill。"""
        return HuggingFaceSkill(package_dir, manifest)

    def get_priority(self) -> int:
        return 50


class HuggingFaceSkill(BaseSkill):
    """HuggingFace Pipeline 包装器。"""

    manifest: SkillManifest

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest
        self._package_dir = package_dir
        self._pipeline = None
        super().__init__()

    def _ensure_pipeline(self):
        """延迟加载 Pipeline。"""
        if self._pipeline is not None:
            return

        handler_path = _find_handler(self._package_dir)
        if not handler_path:
            raise RuntimeError(f"找不到 handler.py: {self._package_dir}")

        # 动态导入
        import importlib.util
        spec = importlib.util.spec_from_file_location("handler", handler_path)
        if not spec or not spec.loader:
            raise RuntimeError(f"无法加载 handler 模块: {handler_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules["handler"] = module
        spec.loader.exec_module(module)

        # 查找 pipeline 实例
        for name in ["pipe", "pipeline", "classifier", "generator", "qa", "summarizer"]:
            if hasattr(module, name):
                obj = getattr(module, name)
                if callable(obj) or hasattr(obj, "__call__"):
                    self._pipeline = obj
                    return

        # 查找工厂函数
        for factory_name in ["get_pipeline", "create_pipeline", "build_pipeline"]:
            if hasattr(module, factory_name):
                factory = getattr(module, factory_name)
                self._pipeline = factory()
                return

        # 如果有 run 函数，包装为 pipeline
        if hasattr(module, "run"):
            self._pipeline = _FunctionAsPipeline(module.run)
            return

        raise RuntimeError("找不到 HuggingFace Pipeline")

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 HuggingFace Pipeline。"""
        self._ensure_pipeline()

        # 准备输入
        if "text" in inputs:
            pipe_input = inputs["text"]
        elif "prompt" in inputs:
            pipe_input = inputs["prompt"]
        elif "question" in inputs and "context" in inputs:
            pipe_input = {"question": inputs["question"], "context": inputs["context"]}
        elif "image" in inputs:
            pipe_input = inputs["image"]
        elif "audio" in inputs:
            pipe_input = inputs["audio"]
        else:
            pipe_input = inputs

        # 应用 config
        pipe_kwargs = {}
        if config.get("model"):
            pipe_kwargs["model"] = config["model"]
        if config.get("device"):
            pipe_kwargs["device"] = config["device"]

        # 执行
        try:
            if callable(self._pipeline):
                result = self._pipeline(pipe_input, **pipe_kwargs)
            else:
                raise RuntimeError("Pipeline 不可调用")
        except Exception as exc:
            logger.error("HuggingFace pipeline execution failed: %s", exc)
            raise

        # 包装结果
        if isinstance(result, list):
            if len(result) == 1:
                result = result[0]
            output = {"predictions": result}
        elif isinstance(result, dict):
            output = result
        else:
            output = {"result": result}

        return SkillResult(output=output)


class _FunctionAsPipeline:
    """将普通函数包装为 Pipeline 接口。"""

    def __init__(self, func):
        self._func = func

    def __call__(self, *args, **kwargs):
        return self._func(*args, **kwargs)
