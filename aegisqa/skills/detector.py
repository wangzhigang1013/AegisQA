"""Skill 类型自动检测器。

自动检测上传的 Skill 包类型，无需 Skill 创作者手动声明。
支持 12 种常见 Skill 格式。
"""

from __future__ import annotations

import ast
import logging
import re
from enum import Enum
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


class SkillType(str, Enum):
    """支持的 Skill 类型。"""
    AEGISQA_NATIVE = "aegisqa_native"      # 原生 AegisQA (skill.yaml + handler.py:run)
    PYTHON_FUNCTION = "python_function"    # 裸 Python 函数 (任意签名)
    LANGCHAIN = "langchain"                # LangChain Chain/Agent
    LLAMAINDEX = "llamaindex"              # LlamaIndex QueryEngine
    OPENAI_TOOL = "openai_tool"            # OpenAI Function Tool
    REST_API = "rest_api"                  # REST API Endpoint
    GRPC = "grpc"                          # gRPC Service
    HUGGINGFACE = "huggingface"            # HuggingFace Pipeline
    SEMANTIC_KERNEL = "semantic_kernel"    # Semantic Kernel Plugin
    LANGGRAPH = "langgraph"                # LangGraph Agent
    CONTAINER = "container"                # Docker 容器
    INSTRUCTION = "instruction"            # 纯指令型 (SKILL.md only)


# 检测优先级（从高到低）
DETECTION_PRIORITY = [
    SkillType.AEGISQA_NATIVE,
    SkillType.CONTAINER,
    SkillType.OPENAI_TOOL,
    SkillType.REST_API,
    SkillType.GRPC,
    SkillType.LANGCHAIN,
    SkillType.LLAMAINDEX,
    SkillType.LANGGRAPH,
    SkillType.HUGGINGFACE,
    SkillType.SEMANTIC_KERNEL,
    SkillType.PYTHON_FUNCTION,
    SkillType.INSTRUCTION,
]

# 框架 import 模式
FRAMEWORK_IMPORT_PATTERNS: dict[SkillType, list[str]] = {
    SkillType.LANGCHAIN: [
        r"\bfrom\s+langchain\b",
        r"\bimport\s+langchain\b",
        r"\bfrom\s+langchain_core\b",
        r"\bfrom\s+langchain_community\b",
    ],
    SkillType.LLAMAINDEX: [
        r"\bfrom\s+llama_index\b",
        r"\bimport\s+llama_index\b",
        r"\bfrom\s+llama_index\.core\b",
    ],
    SkillType.LANGGRAPH: [
        r"\bfrom\s+langgraph\b",
        r"\bimport\s+langgraph\b",
    ],
    SkillType.HUGGINGFACE: [
        r"\bfrom\s+transformers\b",
        r"\bimport\s+transformers\b",
        r"\bfrom\s+transformers\s+import\s+pipeline\b",
    ],
    SkillType.SEMANTIC_KERNEL: [
        r"\bfrom\s+semantic_kernel\b",
        r"\bimport\s+semantic_kernel\b",
    ],
}

# 函数名模式
FUNCTION_NAME_PATTERNS = {
    "run": SkillType.PYTHON_FUNCTION,
    "main": SkillType.PYTHON_FUNCTION,
    "predict": SkillType.PYTHON_FUNCTION,
    "query": SkillType.LLAMAINDEX,
    "chat": SkillType.LLAMAINDEX,
    "invoke": SkillType.LANGCHAIN,
    "execute": SkillType.PYTHON_FUNCTION,
    "call": SkillType.PYTHON_FUNCTION,
}


class SkillDetectionResult:
    """Skill 检测结果。"""

    def __init__(
        self,
        skill_type: SkillType,
        confidence: float,
        metadata: dict[str, Any] | None = None,
        handler_path: Path | None = None,
        function_name: str | None = None,
        manifest_data: dict[str, Any] | None = None,
    ) -> None:
        self.skill_type = skill_type
        self.confidence = confidence  # 0.0 - 1.0
        self.metadata = metadata or {}
        self.handler_path = handler_path
        self.function_name = function_name
        self.manifest_data = manifest_data

    def __repr__(self) -> str:
        return f"SkillDetectionResult(type={self.skill_type.value}, confidence={self.confidence:.2f})"


def detect_skill_type(package_dir: Path) -> SkillDetectionResult:
    """自动检测 Skill 包类型。

    Args:
        package_dir: Skill 包解压后的目录

    Returns:
        SkillDetectionResult 包含检测到的类型和元数据
    """
    package_dir = Path(package_dir)
    if not package_dir.exists():
        raise ValueError(f"目录不存在: {package_dir}")

    # 按优先级尝试检测
    for skill_type in DETECTION_PRIORITY:
        detector = _get_detector(skill_type)
        if detector:
            result = detector(package_dir)
            if result and result.confidence >= 0.5:
                logger.info("Detected skill type: %s (confidence=%.2f) in %s",
                           result.skill_type.value, result.confidence, package_dir)
                return result

    # 默认为指令型
    logger.info("No specific type detected, defaulting to instruction type for %s", package_dir)
    return SkillDetectionResult(
        skill_type=SkillType.INSTRUCTION,
        confidence=0.3,
        metadata={"reason": "no_specific_type_detected"},
    )


def _get_detector(skill_type: SkillType):
    """获取指定类型的检测函数。"""
    detectors = {
        SkillType.AEGISQA_NATIVE: _detect_aegisqa_native,
        SkillType.CONTAINER: _detect_container,
        SkillType.OPENAI_TOOL: _detect_openai_tool,
        SkillType.REST_API: _detect_rest_api,
        SkillType.GRPC: _detect_grpc,
        SkillType.LANGCHAIN: _detect_langchain,
        SkillType.LLAMAINDEX: _detect_llamaindex,
        SkillType.LANGGRAPH: _detect_langgraph,
        SkillType.HUGGINGFACE: _detect_huggingface,
        SkillType.SEMANTIC_KERNEL: _detect_semantic_kernel,
        SkillType.PYTHON_FUNCTION: _detect_python_function,
        SkillType.INSTRUCTION: _detect_instruction,
    }
    return detectors.get(skill_type)


def _detect_aegisqa_native(package_dir: Path) -> SkillDetectionResult | None:
    """检测原生 AegisQA Skill（skill.yaml + handler.py:run）。"""
    # 检查 skill.yaml 存在
    manifest_file = _find_manifest_file(package_dir)
    if not manifest_file:
        return None

    # 检查 handler.py 存在
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    # 检查 handler.py 中是否有 run 函数
    try:
        content = handler_path.read_text(encoding="utf-8")
        if re.search(r"\bdef\s+run\s*\(", content):
            return SkillDetectionResult(
                skill_type=SkillType.AEGISQA_NATIVE,
                confidence=1.0,
                handler_path=handler_path,
                function_name="run",
                manifest_data=_load_yaml(manifest_file),
            )
    except Exception:
        pass

    return None


def _detect_container(package_dir: Path) -> SkillDetectionResult | None:
    """检测 Docker 容器 Skill。"""
    # 检查 Dockerfile
    if (package_dir / "Dockerfile").exists():
        return SkillDetectionResult(
            skill_type=SkillType.CONTAINER,
            confidence=0.9,
            metadata={"has_dockerfile": True},
        )

    # 检查 skill.yaml 中的 runtime.mode
    manifest_file = _find_manifest_file(package_dir)
    if manifest_file:
        manifest = _load_yaml(manifest_file)
        runtime = manifest.get("runtime", {})
        if isinstance(runtime, dict) and runtime.get("mode") == "container":
            return SkillDetectionResult(
                skill_type=SkillType.CONTAINER,
                confidence=1.0,
                manifest_data=manifest,
            )

    return None


def _detect_openai_tool(package_dir: Path) -> SkillDetectionResult | None:
    """检测 OpenAI Function Tool。"""
    manifest_file = _find_manifest_file(package_dir)
    if not manifest_file:
        return None

    manifest = _load_yaml(manifest_file)
    if not manifest:
        return None

    # 检查显式声明
    if manifest.get("openai_tool") or manifest.get("tool_type") == "openai":
        return SkillDetectionResult(
            skill_type=SkillType.OPENAI_TOOL,
            confidence=1.0,
            manifest_data=manifest,
        )

    # 检查 runtime.type
    runtime = manifest.get("runtime", {})
    if isinstance(runtime, dict) and runtime.get("type") == "openai_tool":
        return SkillDetectionResult(
            skill_type=SkillType.OPENAI_TOOL,
            confidence=1.0,
            manifest_data=manifest,
        )

    return None


def _detect_rest_api(package_dir: Path) -> SkillDetectionResult | None:
    """检测 REST API Skill。"""
    manifest_file = _find_manifest_file(package_dir)
    if not manifest_file:
        return None

    manifest = _load_yaml(manifest_file)
    if not manifest:
        return None

    # 检查 runtime.type
    runtime = manifest.get("runtime", {})
    if isinstance(runtime, dict):
        if runtime.get("type") == "rest_api" or runtime.get("endpoint"):
            return SkillDetectionResult(
                skill_type=SkillType.REST_API,
                confidence=1.0,
                manifest_data=manifest,
                metadata={"endpoint": runtime.get("endpoint")},
            )

    # 检查 api 字段
    if "api" in manifest and isinstance(manifest["api"], dict):
        endpoint = manifest["api"].get("endpoint")
        if endpoint:
            return SkillDetectionResult(
                skill_type=SkillType.REST_API,
                confidence=0.9,
                manifest_data=manifest,
                metadata={"endpoint": endpoint},
            )

    return None


def _detect_grpc(package_dir: Path) -> SkillDetectionResult | None:
    """检测 gRPC Skill。"""
    manifest_file = _find_manifest_file(package_dir)
    if not manifest_file:
        return None

    manifest = _load_yaml(manifest_file)
    if not manifest:
        return None

    # 检查 runtime.type
    runtime = manifest.get("runtime", {})
    if isinstance(runtime, dict) and runtime.get("type") == "grpc":
        return SkillDetectionResult(
            skill_type=SkillType.GRPC,
            confidence=1.0,
            manifest_data=manifest,
        )

    # 检查 .proto 文件
    if list(package_dir.glob("**/*.proto")):
        return SkillDetectionResult(
            skill_type=SkillType.GRPC,
            confidence=0.7,
            metadata={"has_proto_files": True},
        )

    return None


def _detect_langchain(package_dir: Path) -> SkillDetectionResult | None:
    """检测 LangChain Skill。"""
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    content = _read_file_safe(handler_path)
    if not content:
        return None

    # 检查 import 模式
    patterns = FRAMEWORK_IMPORT_PATTERNS[SkillType.LANGCHAIN]
    for pattern in patterns:
        if re.search(pattern, content):
            # 分析函数签名
            func_name, func_info = _analyze_main_function(content)
            return SkillDetectionResult(
                skill_type=SkillType.LANGCHAIN,
                confidence=0.9,
                handler_path=handler_path,
                function_name=func_name,
                metadata={
                    "framework": "langchain",
                    "function_info": func_info,
                },
            )

    return None


def _detect_llamaindex(package_dir: Path) -> SkillDetectionResult | None:
    """检测 LlamaIndex Skill。"""
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    content = _read_file_safe(handler_path)
    if not content:
        return None

    # 检查 import 模式
    patterns = FRAMEWORK_IMPORT_PATTERNS[SkillType.LLAMAINDEX]
    for pattern in patterns:
        if re.search(pattern, content):
            func_name, func_info = _analyze_main_function(content)
            return SkillDetectionResult(
                skill_type=SkillType.LLAMAINDEX,
                confidence=0.9,
                handler_path=handler_path,
                function_name=func_name,
                metadata={
                    "framework": "llamaindex",
                    "function_info": func_info,
                },
            )

    return None


def _detect_langgraph(package_dir: Path) -> SkillDetectionResult | None:
    """检测 LangGraph Skill。"""
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    content = _read_file_safe(handler_path)
    if not content:
        return None

    patterns = FRAMEWORK_IMPORT_PATTERNS[SkillType.LANGGRAPH]
    for pattern in patterns:
        if re.search(pattern, content):
            func_name, func_info = _analyze_main_function(content)
            return SkillDetectionResult(
                skill_type=SkillType.LANGGRAPH,
                confidence=0.9,
                handler_path=handler_path,
                function_name=func_name,
                metadata={
                    "framework": "langgraph",
                    "function_info": func_info,
                },
            )

    return None


def _detect_huggingface(package_dir: Path) -> SkillDetectionResult | None:
    """检测 HuggingFace Pipeline Skill。"""
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    content = _read_file_safe(handler_path)
    if not content:
        return None

    patterns = FRAMEWORK_IMPORT_PATTERNS[SkillType.HUGGINGFACE]
    for pattern in patterns:
        if re.search(pattern, content):
            # 检测 pipeline 类型
            pipeline_type = _detect_hf_pipeline_type(content)
            func_name, func_info = _analyze_main_function(content)
            return SkillDetectionResult(
                skill_type=SkillType.HUGGINGFACE,
                confidence=0.9,
                handler_path=handler_path,
                function_name=func_name,
                metadata={
                    "framework": "huggingface",
                    "pipeline_type": pipeline_type,
                    "function_info": func_info,
                },
            )

    return None


def _detect_semantic_kernel(package_dir: Path) -> SkillDetectionResult | None:
    """检测 Semantic Kernel Skill。"""
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    content = _read_file_safe(handler_path)
    if not content:
        return None

    patterns = FRAMEWORK_IMPORT_PATTERNS[SkillType.SEMANTIC_KERNEL]
    for pattern in patterns:
        if re.search(pattern, content):
            func_name, func_info = _analyze_main_function(content)
            return SkillDetectionResult(
                skill_type=SkillType.SEMANTIC_KERNEL,
                confidence=0.9,
                handler_path=handler_path,
                function_name=func_name,
                metadata={
                    "framework": "semantic_kernel",
                    "function_info": func_info,
                },
            )

    return None


def _detect_python_function(package_dir: Path) -> SkillDetectionResult | None:
    """检测裸 Python 函数（有 handler.py 但无 skill.yaml）。"""
    handler_path = _find_handler(package_dir)
    if not handler_path:
        return None

    # 检查是否有 skill.yaml（如果有则不是裸函数）
    if _find_manifest_file(package_dir):
        return None

    content = _read_file_safe(handler_path)
    if not content:
        return None

    # 分析主函数
    func_name, func_info = _analyze_main_function(content)
    if not func_name:
        return None

    return SkillDetectionResult(
        skill_type=SkillType.PYTHON_FUNCTION,
        confidence=0.8,
        handler_path=handler_path,
        function_name=func_name,
        metadata={
            "function_info": func_info,
        },
    )


def _detect_instruction(package_dir: Path) -> SkillDetectionResult | None:
    """检测纯指令型 Skill（只有 SKILL.md）。"""
    skill_md = package_dir / "SKILL.md"
    if skill_md.exists():
        return SkillDetectionResult(
            skill_type=SkillType.INSTRUCTION,
            confidence=0.7,
            metadata={"has_skill_md": True},
        )

    return None


# ============================================================
# 辅助函数
# ============================================================

def _find_manifest_file(package_dir: Path) -> Path | None:
    """查找 skill.yaml/yml/json 文件。"""
    for name in ["skill.yaml", "skill.yml", "skill.json"]:
        path = package_dir / name
        if path.exists():
            return path
    return None


def _find_handler(package_dir: Path) -> Path | None:
    """查找 handler.py 文件。"""
    # 优先查找根目录
    handler = package_dir / "handler.py"
    if handler.exists():
        return handler

    # 递归查找
    for handler in package_dir.rglob("handler.py"):
        return handler

    # 查找 main.py, app.py, predict.py
    for name in ["main.py", "app.py", "predict.py", "run.py"]:
        path = package_dir / name
        if path.exists():
            return path

    return None


def _load_yaml(file_path: Path) -> dict[str, Any] | None:
    """加载 YAML 文件。"""
    try:
        content = file_path.read_text(encoding="utf-8")
        return yaml.safe_load(content)
    except Exception as exc:
        logger.warning("Failed to load YAML %s: %s", file_path, exc)
        return None


def _read_file_safe(file_path: Path) -> str | None:
    """安全读取文件内容。"""
    try:
        return file_path.read_text(encoding="utf-8")
    except Exception:
        return None


def _analyze_main_function(content: str) -> tuple[str | None, dict[str, Any]]:
    """分析主函数签名。"""
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return None, {}

    # 查找主函数
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            func_name = node.name
            # 优先匹配常见名称
            if func_name in FUNCTION_NAME_PATTERNS:
                func_info = _extract_function_info(node)
                return func_name, func_info

    # 查找第一个公开函数
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
            func_info = _extract_function_info(node)
            return node.name, func_info

    return None, {}


def _extract_function_info(node: ast.FunctionDef) -> dict[str, Any]:
    """提取函数信息。"""
    info: dict[str, Any] = {
        "name": node.name,
        "args": [],
        "has_return": False,
    }

    # 提取参数
    for arg in node.args.args:
        if arg.arg not in ("self", "cls"):
            arg_info: dict[str, Any] = {"name": arg.arg}
            # 类型注解
            if arg.annotation:
                if isinstance(arg.annotation, ast.Name):
                    arg_info["type"] = arg.annotation.id
                elif isinstance(arg.annotation, ast.Constant):
                    arg_info["type"] = str(arg.annotation.value)
            info["args"].append(arg_info)

    # 检查返回类型
    if node.returns:
        if isinstance(node.returns, ast.Name):
            info["return_type"] = node.returns.id
        elif isinstance(node.returns, ast.Constant):
            info["return_type"] = str(node.returns.value)
        info["has_return"] = True

    # 检查是否有 docstring
    if (node.body and isinstance(node.body[0], ast.Expr) and
            isinstance(node.body[0].value, ast.Constant)):
        info["docstring"] = node.body[0].value.value

    return info


def _detect_hf_pipeline_type(content: str) -> str | None:
    """检测 HuggingFace pipeline 类型。"""
    patterns = {
        "text-classification": r"pipeline\s*\(\s*['\"]text-classification['\"]",
        "text-generation": r"pipeline\s*\(\s*['\"]text-generation['\"]",
        "question-answering": r"pipeline\s*\(\s*['\"]question-answering['\"]",
        "summarization": r"pipeline\s*\(\s*['\"]summarization['\"]",
        "translation": r"pipeline\s*\(\s*['\"]translation",
        "fill-mask": r"pipeline\s*\(\s*['\"]fill-mask['\"]",
        "image-classification": r"pipeline\s*\(\s*['\"]image-classification['\"]",
        "automatic-speech-recognition": r"pipeline\s*\(\s*['\"]automatic-speech-recognition['\"]",
    }
    for ptype, pattern in patterns.items():
        if re.search(pattern, content):
            return ptype
    return None
