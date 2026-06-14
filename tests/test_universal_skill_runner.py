"""通用 Skill 执行器测试。

测试自动类型检测、Schema 推导、适配器执行。
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
import yaml

from aegisqa.skills.detector import SkillType, detect_skill_type
from aegisqa.skills.schema_inference import SchemaInferenceEngine
from aegisqa.skills.universal_runner import UniversalSkillRunner


@pytest.fixture()
def package_dir(tmp_path: Path) -> Path:
    """创建临时包目录。"""
    return tmp_path / "test_skill"


# ============================================================
# 类型检测测试
# ============================================================

class TestSkillDetection:
    """Skill 类型自动检测测试。"""

    def test_detect_native_skill(self, package_dir: Path):
        """检测原生 AegisQA Skill。"""
        package_dir.mkdir()
        # 创建 skill.yaml
        (package_dir / "skill.yaml").write_text(yaml.dump({
            "skill_id": "test.native@0.1.0",
            "name": "Test Native",
            "version": "0.1.0",
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "config_schema": {"type": "object"},
            "permissions": [],
        }))
        # 创建 handler.py
        (package_dir / "handler.py").write_text("""
def run(inputs, config):
    return {"output": inputs}
""")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.AEGISQA_NATIVE
        assert result.confidence == 1.0
        assert result.function_name == "run"

    def test_detect_python_function(self, package_dir: Path):
        """检测裸 Python 函数。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
def predict(question: str, temperature: float = 0.7) -> dict:
    return {"answer": f"Answer to: {question}"}
""")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.PYTHON_FUNCTION
        assert result.function_name == "predict"

    def test_detect_langchain(self, package_dir: Path):
        """检测 LangChain Skill。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
from langchain.chains import LLMChain
from langchain_core.prompts import PromptTemplate

def run(inputs):
    chain = LLMChain(...)
    return chain.invoke(inputs)
""")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.LANGCHAIN

    def test_detect_llamaindex(self, package_dir: Path):
        """检测 LlamaIndex Skill。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
from llama_index.core import VectorStoreIndex

def query(question: str) -> str:
    index = VectorStoreIndex.from_documents(docs)
    engine = index.as_query_engine()
    return engine.query(question)
""")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.LLAMAINDEX

    def test_detect_huggingface(self, package_dir: Path):
        """检测 HuggingFace Skill。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
from transformers import pipeline

def run(text: str) -> dict:
    pipe = pipeline("text-classification")
    return pipe(text)
""")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.HUGGINGFACE

    def test_detect_rest_api(self, package_dir: Path):
        """检测 REST API Skill。"""
        package_dir.mkdir()
        (package_dir / "skill.yaml").write_text(yaml.dump({
            "name": "Test API",
            "runtime": {
                "type": "rest_api",
                "endpoint": "https://api.example.com/predict",
                "method": "POST",
            },
        }))

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.REST_API

    def test_detect_openai_tool(self, package_dir: Path):
        """检测 OpenAI Tool Skill。"""
        package_dir.mkdir()
        (package_dir / "skill.yaml").write_text(yaml.dump({
            "openai_tool": True,
            "name": "get_weather",
            "description": "Get weather",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
            },
        }))

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.OPENAI_TOOL

    def test_detect_instruction(self, package_dir: Path):
        """检测指令型 Skill。"""
        package_dir.mkdir()
        (package_dir / "SKILL.md").write_text("# Test Skill\n\nThis is a test skill.")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.INSTRUCTION

    def test_detect_langgraph(self, package_dir: Path):
        """检测 LangGraph Skill。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
from langgraph.graph import StateGraph

def run(inputs):
    graph = StateGraph(...)
    return graph.invoke(inputs)
""")

        result = detect_skill_type(package_dir)
        assert result.skill_type == SkillType.LANGGRAPH


# ============================================================
# Schema 推导测试
# ============================================================

class TestSchemaInference:
    """Schema 自动推导测试。"""

    def test_infer_from_typed_function(self):
        """从类型注解推导 schema。"""
        engine = SchemaInferenceEngine()

        def predict(question: str, temperature: float = 0.7) -> dict:
            return {"answer": question}

        input_schema, output_schema = engine.infer_from_function(predict)

        assert input_schema["type"] == "object"
        assert "question" in input_schema["properties"]
        assert input_schema["properties"]["question"]["type"] == "string"
        assert "temperature" in input_schema["properties"]
        assert "question" in input_schema.get("required", [])

    def test_infer_from_sample_value(self):
        """从示例值推导 schema。"""
        engine = SchemaInferenceEngine()

        sample = {
            "answer": "Hello",
            "confidence": 0.95,
            "sources": [{"text": "source1", "score": 0.8}],
        }

        schema = engine.infer_from_sample_value(sample)

        assert schema["type"] == "object"
        assert "answer" in schema["properties"]
        assert schema["properties"]["answer"]["type"] == "string"
        assert "confidence" in schema["properties"]
        assert schema["properties"]["confidence"]["type"] == "number"


# ============================================================
# 适配器测试
# ============================================================

class TestAdapters:
    """适配器执行测试。"""

    def test_python_function_adapter(self, package_dir: Path):
        """测试 Python 函数适配器。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
def run(question: str, temperature: float = 0.7) -> dict:
    return {"answer": f"Answer: {question}", "temperature": temperature}
""")

        from aegisqa.skills.adapters.python_function import PythonFunctionAdapter
        adapter = PythonFunctionAdapter()

        assert adapter.detect(package_dir) is True

        manifest = adapter.infer_manifest(package_dir)
        assert manifest.skill_id.startswith("custom.")
        assert "question" in manifest.input_schema.get("properties", {})

        skill = adapter.create_skill(package_dir, manifest)
        result = skill.execute({"question": "What is AI?"}, {})
        assert "answer" in result[0].output

    def test_python_function_simple(self, package_dir: Path):
        """测试简单 Python 函数。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
def run(text):
    return {"result": text.upper()}
""")

        from aegisqa.skills.adapters.python_function import PythonFunctionAdapter
        adapter = PythonFunctionAdapter()

        manifest = adapter.infer_manifest(package_dir)
        skill = adapter.create_skill(package_dir, manifest)
        result = skill.execute({"text": "hello"}, {})
        assert result[0].output["result"] == "HELLO"


# ============================================================
# UniversalRunner 测试
# ============================================================

class TestUniversalRunner:
    """UniversalRunner 集成测试。"""

    def test_list_supported_types(self):
        """列出支持的类型。"""
        runner = UniversalSkillRunner()
        types = runner.list_supported_types()

        assert len(types) == 12
        type_names = [t["type"] for t in types]
        assert "aegisqa_native" in type_names
        assert "python_function" in type_names
        assert "langchain" in type_names
        assert "llamaindex" in type_names
        assert "huggingface" in type_names
        assert "rest_api" in type_names

    def test_auto_register_python_function(self, package_dir: Path):
        """自动注册 Python 函数。"""
        package_dir.mkdir()
        (package_dir / "handler.py").write_text("""
def predict(question: str) -> dict:
    return {"answer": f"Prediction: {question}"}
""")

        from aegisqa.skills.registry import SkillRegistry
        registry = SkillRegistry.with_builtin_skills()

        runner = UniversalSkillRunner()
        manifest = runner.auto_register(package_dir, registry)

        assert manifest is not None
        assert "predict" in manifest.description or manifest.name

        # 验证可以执行
        skill = registry.get(manifest.skill_id)
        assert skill is not None
