"""Skill 适配器模块。

提供各种 Skill 格式的适配器，实现"平台适配 Skill，而非 Skill 适配平台"。
"""

from aegisqa.skills.adapters.base import SkillAdapter
from aegisqa.skills.adapters.python_function import PythonFunctionAdapter
from aegisqa.skills.adapters.langchain_adapter import LangChainAdapter
from aegisqa.skills.adapters.llamaindex_adapter import LlamaIndexAdapter
from aegisqa.skills.adapters.rest_api import RestApiAdapter
from aegisqa.skills.adapters.huggingface import HuggingFaceAdapter

__all__ = [
    "SkillAdapter",
    "PythonFunctionAdapter",
    "LangChainAdapter",
    "LlamaIndexAdapter",
    "RestApiAdapter",
    "HuggingFaceAdapter",
]
