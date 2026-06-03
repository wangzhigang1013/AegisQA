"""Skill 基类与 manifest 模型。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from time import perf_counter
from typing import Any, Literal

from pydantic import BaseModel, Field

from aegisqa.core.mapper import validate_json_schema


class SkillManifest(BaseModel):
    """Skill 注册清单。

    Manifest 是平台生成配置表单、做输入输出校验、固定版本快照的依据。
    """

    schema_version: int = 0
    skill_id: str
    name: str
    version: str
    description: str
    type: Literal["prompt", "code", "hybrid"] = "code"
    category: str = "legacy"
    runtime: dict[str, Any] = Field(default_factory=lambda: {"kind": "python", "entrypoint": "handler.py"})
    prompts: list[dict[str, Any]] = Field(default_factory=list)
    llm_permissions: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)
    author: str = "AegisQA"
    tags: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    scenarios: list[str] = Field(default_factory=list)
    config_schema: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})
    input_schema: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})
    output_schema: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})
    cacheable: bool = False
    permissions: list[str] = Field(default_factory=list)
    enabled: bool = True
    status: str = "approved"
    governance_note: str | None = None
    example_input: dict[str, Any] = Field(default_factory=dict)
    example_config: dict[str, Any] = Field(default_factory=dict)


class SkillResult(BaseModel):
    """Skill 执行结果。"""

    output: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    artifacts: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    prompt_calls: list[dict[str, Any]] = Field(default_factory=list)


class BaseSkill(ABC):
    """所有 Python Skill 的统一接口。"""

    manifest: SkillManifest

    def __init__(self) -> None:
        if not hasattr(self, "manifest"):
            raise TypeError("Skill 必须声明 manifest")
        # 内置 Skill 的 manifest 通常写在类属性上；实例化时必须深拷贝，
        # 否则禁用/审批一个注册表里的 Skill 会污染后续测试或其他 app 实例。
        self.manifest = self.manifest.model_copy(deep=True)

    @abstractmethod
    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        """执行单条样本上的 Skill 逻辑。"""

    def execute(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> tuple[SkillResult, float]:
        """带输入输出校验和耗时统计的执行入口。"""

        config = config or {}
        validate_json_schema(inputs, self.manifest.input_schema)
        validate_json_schema(config, self.manifest.config_schema)
        started = perf_counter()
        result = self.run(inputs, config)
        latency_ms = (perf_counter() - started) * 1000
        try:
            validate_json_schema(result.output, self.manifest.output_schema)
        except Exception as exc:
            setattr(exc, "code", "OUTPUT_SCHEMA_INVALID")
            setattr(exc, "raw_output", result.output)
            raise
        return result, latency_ms

    def contract_test(self) -> dict[str, Any]:
        """运行 Skill 合约测试。

        合约测试使用 manifest 中的示例输入和配置，验证 schema 与返回结构是否一致。
        """

        try:
            result, latency_ms = self.execute(self.manifest.example_input, self.manifest.example_config)
        except Exception as exc:  # noqa: BLE001 - 合约测试需要把任意异常转成结构化结果。
            payload = {"ok": False, "error": type(exc).__name__, "message": str(exc)}
            if hasattr(exc, "code"):
                payload["code"] = getattr(exc, "code")
            if hasattr(exc, "details"):
                payload["details"] = getattr(exc, "details")
            return payload
        return {"ok": True, "latency_ms": latency_ms, "output": result.output, "metrics": result.metrics}
