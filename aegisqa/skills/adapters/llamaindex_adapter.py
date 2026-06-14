"""LlamaIndex 适配器。

支持 LlamaIndex QueryEngine/ChatEngine，自动包装为 AegisQA Skill。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from aegisqa.skills.adapters.base import SkillAdapter
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.detector import _find_handler
from aegisqa.skills.schema_inference import SchemaInferenceEngine

logger = logging.getLogger(__name__)


class LlamaIndexAdapter(SkillAdapter):
    """LlamaIndex QueryEngine/ChatEngine 适配器。

    支持：
    - llama_index.core.query_engine → QueryEngine.query()
    - llama_index.core.chat_engine → ChatEngine.chat()
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否包含 LlamaIndex 代码。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            return False

        try:
            content = handler_path.read_text(encoding="utf-8")
            import re
            patterns = [
                r"\bfrom\s+llama_index\b",
                r"\bimport\s+llama_index\b",
                r"\bfrom\s+llama_index\.core\b",
            ]
            for pattern in patterns:
                if re.search(pattern, content):
                    return True
        except Exception:
            pass

        return False

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从 LlamaIndex 代码推导 manifest。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            raise ValueError(f"找不到 handler.py: {package_dir}")

        engine = SchemaInferenceEngine()
        input_schema, output_schema, func_name = engine.infer_from_ast(handler_path)

        # LlamaIndex 通常返回 Response 对象
        if not output_schema or output_schema == {"type": "object"}:
            output_schema = {
                "type": "object",
                "properties": {
                    "answer": {"type": "string", "description": "回答文本"},
                    "source_nodes": {
                        "type": "array",
                        "description": "源节点",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string"},
                                "score": {"type": "number"},
                                "metadata": {"type": "object"},
                            },
                        },
                    },
                },
            }

        skill_id = f"llamaindex.{package_dir.name}@0.1.0"

        return SkillManifest(
            skill_id=skill_id,
            name=package_dir.name,
            version="0.1.0",
            description=f"LlamaIndex QueryEngine/ChatEngine: {func_name or 'unknown'}",
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={
                "type": "object",
                "properties": {
                    "model": {"type": "string", "description": "模型名称"},
                    "similarity_top_k": {"type": "integer", "description": "检索 top-k"},
                },
            },
            permissions=["model:call"],
            cacheable=True,
            enabled=True,
            status="approved",
            tags=["auto-imported", "llamaindex"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建 LlamaIndex Skill。"""
        return LlamaIndexSkill(package_dir, manifest)

    def get_priority(self) -> int:
        return 50


class LlamaIndexSkill(BaseSkill):
    """LlamaIndex QueryEngine/ChatEngine 包装器。"""

    manifest: SkillManifest

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest
        self._package_dir = package_dir
        self._engine = None
        super().__init__()

    def _ensure_engine(self):
        """延迟加载 QueryEngine/ChatEngine。"""
        if self._engine is not None:
            return

        handler_path = _find_handler(self._package_dir)
        if not handler_path:
            raise RuntimeError(f"找不到 handler.py: {self._package_dir}")

        import importlib.util
        spec = importlib.util.spec_from_file_location("handler", handler_path)
        if not spec or not spec.loader:
            raise RuntimeError(f"无法加载 handler 模块: {handler_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules["handler"] = module
        spec.loader.exec_module(module)

        # 查找 QueryEngine/ChatEngine
        for name in ["query_engine", "chat_engine", "engine", "index"]:
            if hasattr(module, name):
                obj = getattr(module, name)
                if hasattr(obj, "query") or hasattr(obj, "chat"):
                    self._engine = obj
                    return

        # 查找工厂函数
        for factory_name in ["get_query_engine", "create_engine", "build_engine"]:
            if hasattr(module, factory_name):
                factory = getattr(module, factory_name)
                self._engine = factory()
                return

        # 如果有 run 函数，包装为 QueryEngine
        if hasattr(module, "run"):
            self._engine = _FunctionAsEngine(module.run)
            return

        raise RuntimeError("找不到 LlamaIndex QueryEngine/ChatEngine")

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 LlamaIndex QueryEngine/ChatEngine。"""
        self._ensure_engine()

        # 准备查询
        query = inputs.get("query") or inputs.get("question") or inputs.get("text", "")
        if not query:
            # 尝试将整个 inputs 作为 query
            query = str(inputs)

        # 执行
        try:
            if hasattr(self._engine, "query"):
                response = self._engine.query(query)
            elif hasattr(self._engine, "chat"):
                response = self._engine.chat(query)
            else:
                raise RuntimeError("Engine 不可调用")
        except Exception as exc:
            logger.error("LlamaIndex execution failed: %s", exc)
            raise

        # 包装结果
        output: dict[str, Any] = {}

        if hasattr(response, "response"):
            output["answer"] = str(response.response)
        elif hasattr(response, "text"):
            output["answer"] = str(response.text)
        else:
            output["answer"] = str(response)

        # 提取 source_nodes
        if hasattr(response, "source_nodes"):
            output["source_nodes"] = []
            for node in response.source_nodes:
                node_info: dict[str, Any] = {
                    "text": node.node.get_text() if hasattr(node.node, "get_text") else str(node.node),
                    "score": float(node.score) if hasattr(node, "score") else 0.0,
                }
                if hasattr(node.node, "metadata"):
                    node_info["metadata"] = node.node.metadata
                output["source_nodes"].append(node_info)

        return SkillResult(output=output)


class _FunctionAsEngine:
    """将普通函数包装为 QueryEngine 接口。"""

    def __init__(self, func):
        self._func = func

    def query(self, query_str: str):
        result = self._func(query_str)
        return _SimpleResponse(result)


class _SimpleResponse:
    """简单响应对象。"""

    def __init__(self, text: str):
        self.response = text
        self.text = text
        self.source_nodes = []
