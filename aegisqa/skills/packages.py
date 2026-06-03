"""Skill 插件包执行适配。

插件包里的 Python 代码不在 FastAPI 主进程中 import，而是通过短生命周期子进程执行。
这样即使插件抛异常或污染全局状态，也不会影响 API 服务本身。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from aegisqa.core.errors import AegisQAError
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult


PACKAGE_SKILL_TIMEOUT_ENV = "AEGISQA_PACKAGE_SKILL_TIMEOUT_SECONDS"
DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS = 60
MAX_PACKAGE_SKILL_TIMEOUT_SECONDS = 600
MAX_PACKAGE_SKILL_OUTPUT_BYTES = 64 * 1024
MAX_PACKAGE_SKILL_STREAM_CHARS = 4000


def resolve_package_skill_timeout_seconds(timeout_seconds: int | str | None = None) -> int:
    """解析插件 Skill 的单次执行超时。

    插件可能会做模型调用、批处理或少量循环，5 秒过于偏演示场景；但完全不限制会拖死
    任务队列。因此默认放宽到 60 秒，并允许部署时通过环境变量调大，同时用上限兜住风险。
    """

    raw_value = timeout_seconds
    if raw_value is None:
        raw_value = os.getenv(PACKAGE_SKILL_TIMEOUT_ENV)
    if raw_value in (None, ""):
        return DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS
    return max(1, min(parsed, MAX_PACKAGE_SKILL_TIMEOUT_SECONDS))


class SubprocessPackageSkill(BaseSkill):
    """通过受控子进程执行插件包 `handler.py` 的 Skill。"""

    def __init__(
        self,
        manifest: SkillManifest,
        handler_path: Path,
        *,
        timeout_seconds: int | None = None,
        prompt_assets: list[dict[str, Any]] | None = None,
        model_aliases: list[dict[str, Any]] | None = None,
    ) -> None:
        self.manifest = manifest
        # 子进程会把 cwd 切到插件目录；这里必须提前转成绝对路径，
        # 避免相对路径在子进程中被再次拼接导致 handler.py 找不到。
        self.handler_path = handler_path.resolve()
        # 这里是单次 Skill 调用的保护阈值，不是整个任务的总时长限制。
        # 真实任务可以循环执行很多条样本，但每条样本仍需要可控的最大运行时间。
        self.timeout_seconds = resolve_package_skill_timeout_seconds(timeout_seconds)
        self.prompt_assets = prompt_assets or []
        self.model_aliases = model_aliases or []
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        payload = json.dumps(
            {
                "inputs": inputs,
                "config": config or {},
                "manifest": self.manifest.model_dump(mode="json"),
                "prompt_assets": self.prompt_assets,
                "model_aliases": self.model_aliases,
            },
            ensure_ascii=False,
        )
        try:
            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    _RUNNER_CODE,
                    str(self.handler_path),
                ],
                input=payload,
                text=True,
                capture_output=True,
                cwd=str(self.handler_path.parent),
                env=_sandbox_environment(),
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise AegisQAError(
                "SKILL_CONTRACT_TIMEOUT",
                f"插件执行超过 {self.timeout_seconds} 秒限制。",
                details={"timeout_seconds": self.timeout_seconds},
            ) from exc
        if completed.returncode != 0:
            stderr, stderr_truncated = _prepare_stream(completed.stderr, self.handler_path.parent)
            stdout, stdout_truncated = _prepare_stream(completed.stdout, self.handler_path.parent)
            message = stderr or stdout or f"插件进程退出码：{completed.returncode}"
            raise AegisQAError(
                "SKILL_PACKAGE_RUNTIME_ERROR",
                message,
                details={
                    "returncode": completed.returncode,
                    "stderr": stderr,
                    "stdout": stdout,
                    "stderr_truncated": stderr_truncated,
                    "stdout_truncated": stdout_truncated,
                    "max_stream_chars": MAX_PACKAGE_SKILL_STREAM_CHARS,
                },
            )
        output_size = len((completed.stdout or "").encode("utf-8"))
        if output_size > MAX_PACKAGE_SKILL_OUTPUT_BYTES:
            stdout, stdout_truncated = _prepare_stream(completed.stdout, self.handler_path.parent)
            raise AegisQAError(
                "SKILL_PACKAGE_OUTPUT_TOO_LARGE",
                "插件 stdout 超过安全限制，请减少 output、metrics、artifacts 或 logs 的体积。",
                details={
                    "actual_output_bytes": output_size,
                    "max_output_bytes": MAX_PACKAGE_SKILL_OUTPUT_BYTES,
                    "stdout": stdout,
                    "stdout_truncated": stdout_truncated,
                },
            )
        try:
            data = json.loads(completed.stdout or "{}")
        except json.JSONDecodeError as exc:
            stdout, stdout_truncated = _prepare_stream(completed.stdout, self.handler_path.parent)
            raise AegisQAError(
                "SKILL_PACKAGE_OUTPUT_ERROR",
                "插件必须向 stdout 输出合法 JSON。",
                details={"stdout": stdout, "stdout_truncated": stdout_truncated},
            ) from exc
        return SkillResult(
            output=data.get("output", {}),
            metrics=data.get("metrics", {}),
            artifacts=data.get("artifacts", {}),
            logs=data.get("logs", []),
            prompt_calls=data.get("prompt_calls", []),
        )


class MetadataOnlyPackageSkill(BaseSkill):
    """仅注册 manifest 元数据的 prompt 包。

    Phase 1 先允许 prompt 包完成上传、审计和 prompt asset 注册；真正调用 LLM
    要等 Phase 2 的 LLM Gateway 接入后再放开。
    """

    def __init__(self, manifest: SkillManifest) -> None:
        self.manifest = manifest
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        raise AegisQAError(
            "PROMPT_RUNTIME_UNAVAILABLE",
            "Prompt Skill 需要等待 LLM Gateway 配置后才能执行。",
            details={"skill_id": self.manifest.skill_id},
        )


def _prepare_stream(value: str, package_root: Path, limit: int = MAX_PACKAGE_SKILL_STREAM_CHARS) -> tuple[str, bool]:
    """清洗并限制插件日志进入 API 响应，避免泄露本地路径或拖垮页面。"""

    text = _sanitize_local_paths((value or "").strip(), package_root)
    if len(text) <= limit:
        return text, False
    return text[:limit] + "...[已截断]", True


def _sandbox_environment() -> dict[str, str]:
    """Build a subprocess environment without provider secrets."""

    blocked_fragments = ("API_KEY", "ACCESS_TOKEN", "SECRET_KEY", "PROVIDER_SECRET")
    env = {
        key: value
        for key, value in os.environ.items()
        if not any(fragment in key.upper() for fragment in blocked_fragments)
    }
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def _sanitize_local_paths(value: str, package_root: Path) -> str:
    """隐藏插件异常栈中的本地绝对路径，只保留对用户有意义的相对线索。"""

    text = value
    path_variants = {
        str(package_root),
        package_root.as_posix(),
        str(package_root.parent),
        package_root.parent.as_posix(),
    }
    for item in sorted(path_variants, key=len, reverse=True):
        if item:
            text = text.replace(item, "<skill_package>")
    text = re.sub(r'File ".*?handler\.py"', 'File "<skill_package>/handler.py"', text)
    return re.sub(r"[a-zA-Z]:[\\/][^\s\"']+", "<local_path>", text)


_RUNNER_CODE = r"""
import importlib.util
import json
import sys


class RuntimeContext(dict):
    def __init__(self, payload, manifest):
        super().__init__(
            skill_id=manifest.get("skill_id"),
            skill_version=manifest.get("version"),
            schema_version=manifest.get("schema_version"),
            type=manifest.get("type"),
            category=manifest.get("category"),
            config=payload.get("config", {}),
            llm_permissions=manifest.get("llm_permissions", {}),
            limits=manifest.get("limits", {}),
        )
        self.llm = LLMRuntimeShim(
            prompt_assets=payload.get("prompt_assets", []),
            model_aliases=payload.get("model_aliases", []),
            permissions=manifest.get("llm_permissions", {}),
        )


class LLMRuntimeShim:
    def __init__(self, prompt_assets, model_aliases, permissions):
        self.prompt_assets = {item.get("name"): item for item in prompt_assets}
        self.model_aliases = {item.get("alias"): item for item in model_aliases}
        self.permissions = permissions or {}
        self.calls = []
        self.total_tokens = 0

    def call(self, prompt_name, variables, trigger_reason, model_alias=None):
        max_calls = int(self.permissions.get("max_calls_per_run") or 0)
        if max_calls and len(self.calls) >= max_calls:
            raise RuntimeError(f"LLM_MAX_CALLS_EXCEEDED: max_calls_per_run={max_calls}")
        prompt = self.prompt_assets.get(prompt_name)
        if prompt is None:
            raise RuntimeError(f"PROMPT_NOT_REGISTERED: {prompt_name}")
        allowed_prompts = self.permissions.get("allowed_prompt_names")
        if isinstance(allowed_prompts, list) and prompt_name not in allowed_prompts:
            raise RuntimeError(f"LLM_PERMISSION_DENIED: {prompt_name}")
        for name in (prompt.get("input_variables") or {}):
            if name not in variables:
                raise RuntimeError(f"PROMPT_VARIABLE_MISSING: {name}")
        alias_name = model_alias or (prompt.get("model_policy") or {}).get("default_alias")
        if not alias_name:
            aliases = (prompt.get("model_policy") or {}).get("allowed_aliases") or []
            alias_name = aliases[0] if aliases else None
        allowed_aliases = self.permissions.get("allowed_model_aliases")
        if isinstance(allowed_aliases, list) and alias_name not in allowed_aliases:
            raise RuntimeError(f"MODEL_ALIAS_NOT_ALLOWED: {alias_name}")
        if alias_name not in self.model_aliases:
            raise RuntimeError(f"MODEL_ALIAS_NOT_ALLOWED: {alias_name}")
        rendered = prompt.get("template") or ""
        for key, value in variables.items():
            rendered = rendered.replace("{{ " + key + " }}", str(value))
            rendered = rendered.replace("{{" + key + "}}", str(value))
        raw_response = prompt.get("test_response") or "{}"
        try:
            parsed = json.loads(raw_response)
        except json.JSONDecodeError as exc:
            raise RuntimeError("JSON_PARSE_ERROR") from exc
        prompt_tokens = max(1, len(rendered.split()))
        completion_tokens = max(1, len(raw_response.split()))
        total_tokens = prompt_tokens + completion_tokens
        max_tokens = int(self.permissions.get("max_tokens_per_run") or 0)
        if max_tokens and self.total_tokens + total_tokens > max_tokens:
            raise RuntimeError(
                f"TOKEN_BUDGET_EXCEEDED: total_tokens={self.total_tokens + total_tokens} max_tokens_per_run={max_tokens}"
            )
        call = {
            "prompt_name": prompt_name,
            "prompt_hash": prompt.get("prompt_hash"),
            "model_alias": alias_name,
            "provider": (self.model_aliases.get(alias_name) or {}).get("provider", "test"),
            "model": (self.model_aliases.get(alias_name) or {}).get("model", alias_name),
            "rendered_prompt": rendered,
            "raw_response": raw_response,
            "parsed_output": parsed,
            "schema_validation": {"ok": True},
            "token_usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
            "duration_ms": 0,
            "trigger_reason": trigger_reason,
            "status": "succeeded",
        }
        self.total_tokens += total_tokens
        self.calls.append(call)
        return call

handler_path = sys.argv[1]
payload = json.loads(sys.stdin.read() or "{}")
manifest = payload.get("manifest", {})
spec = importlib.util.spec_from_file_location("aegisqa_uploaded_skill_handler", handler_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if not hasattr(module, "run"):
    raise RuntimeError("handler.py 必须暴露 run(inputs, config)")
if int(manifest.get("schema_version") or 0) >= 1:
    context = RuntimeContext(payload, manifest)
    result = module.run(payload.get("inputs", {}), context)
else:
    result = module.run(payload.get("inputs", {}), payload.get("config", {}))
if result is None:
    result = {}
if "output" not in result:
    result = {"output": result, "metrics": {}, "artifacts": {}, "logs": []}
if int(manifest.get("schema_version") or 0) >= 1 and isinstance(result, dict):
    result.setdefault("prompt_calls", context.llm.calls)
print(json.dumps(result, ensure_ascii=False))
"""
