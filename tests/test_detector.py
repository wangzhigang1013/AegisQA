"""Skill 类型检测器单元测试。"""

from __future__ import annotations

import pytest
from pathlib import Path
import tempfile

from aegisqa.skills.detector import (
    SkillType,
    detect_skill_type,
)


# ── 辅助 ──────────────────────────────────────────────────────

def _create_package(files: dict[str, str]) -> Path:
    """创建临时 Skill 包目录。"""
    tmpdir = tempfile.mkdtemp()
    pkg_dir = Path(tmpdir)
    for name, content in files.items():
        file_path = pkg_dir / name
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
    return pkg_dir


# ── AegisQA Native 检测 ──────────────────────────────────────

class TestDetectAegisqaNative:
    def test_skill_yaml_plus_handler(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\n",
            "handler.py": "def run(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.AEGISQA_NATIVE
        assert result.confidence == 1.0

    def test_skill_yaml_without_run_function(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\n",
            "handler.py": "def process(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        # Should not detect as AEGISQA_NATIVE without run function
        assert result.skill_type != SkillType.AEGISQA_NATIVE


# ── Container 检测 ────────────────────────────────────────────

class TestDetectContainer:
    def test_dockerfile_present(self) -> None:
        pkg = _create_package({
            "Dockerfile": "FROM python:3.11\nCOPY . /app\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.CONTAINER
        assert result.confidence == 0.9

    def test_runtime_mode_container(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\nruntime:\n  mode: container\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.CONTAINER


# ── OpenAI Tool 检测 ─────────────────────────────────────────

class TestDetectOpenaiTool:
    def test_openai_tool_declaration(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\nopenai_tool: true\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.OPENAI_TOOL
        assert result.confidence == 1.0

    def test_tool_type_openai(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\ntool_type: openai\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.OPENAI_TOOL


# ── REST API 检测 ─────────────────────────────────────────────

class TestDetectRestApi:
    def test_runtime_type_rest_api(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\nruntime:\n  type: rest_api\n  endpoint: https://api.example.com\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.REST_API

    def test_api_endpoint(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\napi:\n  endpoint: https://api.example.com\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.REST_API


# ── gRPC 检测 ────────────────────────────────────────────────

class TestDetectGrpc:
    def test_runtime_type_grpc(self) -> None:
        pkg = _create_package({
            "skill.yaml": "skill_id: test\nname: Test\nversion: 1.0.0\npermissions: []\nruntime:\n  type: grpc\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.GRPC

    def test_proto_file(self) -> None:
        pkg = _create_package({
            "service.proto": 'syntax = "proto3";\nservice TestService {}\n',
        })
        result = detect_skill_type(pkg)
        # Proto files may be detected as gRPC or default to instruction
        assert result.skill_type in (SkillType.GRPC, SkillType.INSTRUCTION)


# ── LangChain 检测 ───────────────────────────────────────────

class TestDetectLangchain:
    def test_langchain_import(self) -> None:
        pkg = _create_package({
            "handler.py": "from langchain.chains import LLMChain\n\ndef invoke(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.LANGCHAIN
        assert result.confidence == 0.9


# ── LlamaIndex 检测 ──────────────────────────────────────────

class TestDetectLlamaindex:
    def test_llamaindex_import(self) -> None:
        pkg = _create_package({
            "handler.py": "from llama_index.core import VectorStoreIndex\n\ndef query(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.LLAMAINDEX


# ── LangGraph 检测 ───────────────────────────────────────────

class TestDetectLanggraph:
    def test_langgraph_import(self) -> None:
        pkg = _create_package({
            "handler.py": "from langgraph.graph import StateGraph\n\ndef invoke(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.LANGGRAPH


# ── HuggingFace 检测 ─────────────────────────────────────────

class TestDetectHuggingface:
    def test_transformers_import(self) -> None:
        pkg = _create_package({
            "handler.py": "from transformers import pipeline\n\ndef run(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.HUGGINGFACE


# ── Semantic Kernel 检测 ─────────────────────────────────────

class TestDetectSemanticKernel:
    def test_semantic_kernel_import(self) -> None:
        pkg = _create_package({
            "handler.py": "import semantic_kernel as sk\n\ndef run(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.SEMANTIC_KERNEL


# ── Python Function 检测 ─────────────────────────────────────

class TestDetectPythonFunction:
    def test_handler_without_manifest(self) -> None:
        pkg = _create_package({
            "handler.py": "def run(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.PYTHON_FUNCTION

    def test_main_py(self) -> None:
        pkg = _create_package({
            "main.py": "def main(inputs, config):\n    return inputs\n",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.PYTHON_FUNCTION


# ── Instruction 检测 ─────────────────────────────────────────

class TestDetectInstruction:
    def test_skill_md_only(self) -> None:
        pkg = _create_package({
            "SKILL.md": "# Test Skill\n\nThis is a test instruction for the AI to follow.",
        })
        result = detect_skill_type(pkg)
        assert result.skill_type == SkillType.INSTRUCTION
        assert result.confidence == 0.7

    def test_empty_skill_md(self) -> None:
        pkg = _create_package({
            "SKILL.md": "",
        })
        result = detect_skill_type(pkg)
        # Empty SKILL.md defaults to instruction with low confidence
        assert result.skill_type == SkillType.INSTRUCTION
        assert result.confidence == 0.3  # Default fallback

    def test_short_skill_md(self) -> None:
        pkg = _create_package({
            "SKILL.md": "short",
        })
        result = detect_skill_type(pkg)
        # Short SKILL.md (< 10 chars) defaults to instruction with low confidence
        assert result.skill_type == SkillType.INSTRUCTION
        assert result.confidence == 0.3  # Default fallback


# ── 默认检测 ─────────────────────────────────────────────────

class TestDefaultDetection:
    def test_empty_directory(self) -> None:
        pkg = _create_package({})
        result = detect_skill_type(pkg)
        # Should default to instruction with low confidence
        assert result.skill_type == SkillType.INSTRUCTION
        assert result.confidence == 0.3

    def test_nonexistent_directory_raises(self) -> None:
        with pytest.raises(ValueError, match="目录不存在"):
            detect_skill_type(Path("/nonexistent/path"))
