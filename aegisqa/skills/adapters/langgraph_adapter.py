"""LangGraph 适配器。

支持 LangGraph StateGraph/Agent，自动包装为 AegisQA Skill。
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


class LangGraphAdapter(SkillAdapter):
    """LangGraph StateGraph/Agent 适配器。

    支持：
    - langgraph.graph.StateGraph → Graph.invoke()
    - langgraph.prebuilt.create_react_agent → Agent.invoke()
    """

    def detect(self, package_dir: Path) -> bool:
        """检测是否包含 LangGraph 代码。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            return False

        try:
            content = handler_path.read_text(encoding="utf-8")
            import re
            patterns = [
                r"\bfrom\s+langgraph\b",
                r"\bimport\s+langgraph\b",
            ]
            for pattern in patterns:
                if re.search(pattern, content):
                    return True
        except Exception:
            pass

        return False

    def infer_manifest(self, package_dir: Path, metadata: dict[str, Any] | None = None) -> SkillManifest:
        """从 LangGraph 代码推导 manifest。"""
        handler_path = _find_handler(package_dir)
        if not handler_path:
            raise ValueError(f"找不到 handler.py: {package_dir}")

        engine = SchemaInferenceEngine()
        input_schema, output_schema, func_name = engine.infer_from_ast(handler_path)

        # LangGraph 通常返回 State dict
        if not output_schema or output_schema == {"type": "object"}:
            output_schema = {
                "type": "object",
                "properties": {
                    "messages": {"type": "array", "description": "对话消息"},
                    "output": {"type": "string", "description": "最终输出"},
                },
            }

        skill_id = f"langgraph.{package_dir.name}@0.1.0"

        return SkillManifest(
            skill_id=skill_id,
            name=package_dir.name,
            version="0.1.0",
            description=f"LangGraph Agent/Graph: {func_name or 'unknown'}",
            input_schema=input_schema,
            output_schema=output_schema,
            config_schema={
                "type": "object",
                "properties": {
                    "model": {"type": "string", "description": "模型名称"},
                    "recursion_limit": {"type": "integer", "description": "递归限制"},
                },
            },
            permissions=["model:call"],
            cacheable=False,  # Agent 通常有状态
            enabled=True,
            status="approved",
            tags=["auto-imported", "langgraph"],
        )

    def create_skill(self, package_dir: Path, manifest: SkillManifest) -> BaseSkill:
        """创建 LangGraph Skill。"""
        return LangGraphSkill(package_dir, manifest)

    def get_priority(self) -> int:
        return 48


class LangGraphSkill(BaseSkill):
    """LangGraph Agent/Graph 包装器。"""

    manifest: SkillManifest

    def __init__(self, package_dir: Path, skill_manifest: SkillManifest) -> None:
        self.manifest = skill_manifest
        self._package_dir = package_dir
        self._graph = None
        super().__init__()

    def _ensure_graph(self):
        """延迟加载 Graph/Agent。"""
        if self._graph is not None:
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

        # 查找 Graph/Agent
        for name in ["graph", "agent", "app", "workflow"]:
            if hasattr(module, name):
                obj = getattr(module, name)
                if hasattr(obj, "invoke") or hasattr(obj, "ainvoke"):
                    self._graph = obj
                    return

        # 查找工厂函数
        for factory_name in ["get_graph", "create_agent", "build_graph", "create_graph"]:
            if hasattr(module, factory_name):
                factory = getattr(module, factory_name)
                self._graph = factory()
                return

        # 如果有 run 函数，创建一个简单的包装
        if hasattr(module, "run"):
            self._graph = _FunctionAsGraph(module.run)
            return

        raise RuntimeError("找不到 LangGraph Agent/Graph")

    def run(self, inputs: dict, config: dict) -> SkillResult:
        """执行 LangGraph Agent/Graph。"""
        self._ensure_graph()

        # 准备输入
        graph_input = inputs.copy()

        # 应用 config
        if config.get("recursion_limit"):
            graph_input["recursion_limit"] = config["recursion_limit"]

        # 执行
        try:
            if hasattr(self._graph, "invoke"):
                result = self._graph.invoke(graph_input)
            else:
                raise RuntimeError("Graph 不可调用")
        except Exception as exc:
            logger.error("LangGraph execution failed: %s", exc)
            raise

        # 包装结果
        if isinstance(result, dict):
            output = result
            # 提取最终消息
            if "messages" in result and result["messages"]:
                last_message = result["messages"][-1]
                if hasattr(last_message, "content"):
                    output["output"] = last_message.content
                elif isinstance(last_message, dict):
                    output["output"] = last_message.get("content", str(last_message))
        else:
            output = {"output": str(result)}

        return SkillResult(output=output)


class _FunctionAsGraph:
    """将普通函数包装为 Graph 接口。"""

    def __init__(self, func):
        self._func = func

    def invoke(self, input_data: dict):
        result = self._func(input_data)
        if isinstance(result, dict):
            return result
        return {"output": result}
