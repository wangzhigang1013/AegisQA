"""LangChain 适配器。

支持 LangChain Chain/Agent/Runnable，自动包装为 AegisQA Skill。
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


class LangChainAdapter(SkillAdapter):
    """LangChain Chain/Agent 适配器。

    支持：
    - langchain.chains.* → Chain.invoke()
    - langchain.agents.* → Agent.invoke()
    - langchain_core.runnables.* → Runnable.invoke()
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否包含 LangChain 代码。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            return False

        try:
            content = handler_path.read_text(encoding="utf-8")
            # 检查 LangChain import
            langchain_patterns = [
                r"\bfrom\s+langchain\b",
                r"\bimport\s+langchain\b",
                r"\bfrom\s+langchain_core\b",
                r"\bfrom\s+langchain_community\b",
            ]
            import re
            for pattern in langchain_patterns:
                if re.search(pattern, content):
                    return True
        except Exception:
            pass

        return False

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从 LangChain 代码推导 manifest。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            raise ValueError(f"找不到 handler.py: {package_dir}")

        # 使用 Schema 推导引擎
        engine = SchemaInferenceEngine()
        input_schema, output_schema, func_name = engine.infer_from_ast(handler_path)

        # LangChain 通常返回 dict 或 str
        if not output_schema or output_schema == {"type": "object"}:
            output_schema = {
                "type": "object",
                "properties": {
                    "output": {"type": "string", "description": "Chain/Agent 输出"},
                    "source_documents": {"type": "array", "description": "源文档（如有）"},
                },
            }

        skill_id = f"langchain.{package_dir.name}@0.1.0"

        return SkillManifest(
            skill_id=skill_id,
            name=metadata.get("chain_name", package_dir.name) if metadata else package_dir.name,
            version="0.1.0",
            description=f"LangChain Chain/Agent: {func_name or 'unknown'}",
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={
                "type": "object",
                "properties": {
                    "model": {"type": "string", "description": "模型名称"},
                    "temperature": {"type": "number", "description": "温度参数"},
                    "max_tokens": {"type": "integer", "description": "最大 token 数"},
                },
            },
            permissions=["model:call"],
            cacheable=True,
            enabled=True,
            status="approved",
            tags=["auto-imported", "langchain"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建 LangChain Skill。"""
        return LangChainSkill(package_dir, manifest)

    def get_priority(self) -> int:
        return 50


class LangChainSkill(BaseSkill):
    """LangChain Chain/Agent 包装器。"""

    manifest: SkillManifest

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest
        self._package_dir = package_dir
        self._chain = None
        super().__init__()

    def _ensure_chain(self):
        """延迟加载 Chain/Agent。"""
        if self._chain is not None:
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

        # 查找 Chain/Agent 实例
        # 优先查找 get_chain, create_chain, get_agent 等工厂函数
        for factory_name in ["get_chain", "create_chain", "get_agent", "create_agent", "build_chain"]:
            if hasattr(module, factory_name):
                factory = getattr(module, factory_name)
                self._chain = factory()
                return

        # 查找模块级 Chain/Agent 变量
        for name in ["chain", "agent", "runnable", "app"]:
            if hasattr(module, name):
                obj = getattr(module, name)
                if hasattr(obj, "invoke") or hasattr(obj, "__call__"):
                    self._chain = obj
                    return

        # 如果有 run 函数，创建一个 RunnableCallable
        if hasattr(module, "run"):
            from langchain_core.runnables import RunnableLambda
            self._chain = RunnableLambda(module.run)
            return

        raise RuntimeError("找不到 LangChain Chain/Agent 实例")

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 LangChain Chain/Agent。"""
        self._ensure_chain()

        # 准备输入
        chain_input = {**inputs}

        # 应用 config（如 model, temperature 等）
        if config.get("model"):
            chain_input["model"] = config["model"]
        if config.get("temperature") is not None:
            chain_input["temperature"] = config["temperature"]

        # 执行
        try:
            if hasattr(self._chain, "invoke"):
                result = self._chain.invoke(chain_input)
            elif callable(self._chain):
                result = self._chain(chain_input)
            else:
                raise RuntimeError("Chain 不可调用")
        except Exception as exc:
            logger.error("LangChain execution failed: %s", exc)
            raise

        # 包装结果
        if isinstance(result, dict):
            output = result
        elif isinstance(result, str):
            output = {"output": result}
        else:
            # 尝试提取属性
            output = {}
            if hasattr(result, "content"):
                output["output"] = result.content
            elif hasattr(result, "text"):
                output["output"] = result.text
            else:
                output["output"] = str(result)

            # 提取 source_documents（RAG 场景）
            if hasattr(result, "source_documents"):
                output["source_documents"] = [
                    {"page_content": doc.page_content, "metadata": doc.metadata}
                    for doc in result.source_documents
                ]

        return SkillResult(output=output)
