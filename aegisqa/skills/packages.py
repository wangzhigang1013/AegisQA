"""Skill 插件包执行适配。

插件包里的 Python 代码不在 FastAPI 主进程中 import，而是通过短生命周期子进程执行。
这样即使插件抛异常或污染全局状态，也不会影响 API 服务本身。

支持两种运行时模式：
- subprocess（默认）：通过子进程执行，兼容性最好。
- container：通过 Docker 容器执行，提供更强的隔离边界。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

from aegisqa.core.errors import AegisQAError
from aegisqa.models.gateway import ModelGateway, model_response_usage_metrics
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult

logger = logging.getLogger(__name__)


PACKAGE_SKILL_TIMEOUT_ENV = "AEGISQA_PACKAGE_SKILL_TIMEOUT_SECONDS"
DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS = 60
MAX_PACKAGE_SKILL_TIMEOUT_SECONDS = 600
MAX_PACKAGE_SKILL_OUTPUT_BYTES = 64 * 1024
MAX_PACKAGE_SKILL_STREAM_CHARS = 4000
DEFAULT_REFERENCE_CHAR_LIMIT = 6000
MAX_REFERENCE_CHAR_LIMIT = 30000


class PackageRuntimeSpec:
    """插件包运行时声明。

    运行时信息不写入 `SkillManifest`，因为 manifest 负责“组件合约”，runtime 负责
    “平台如何执行”。这两者分开以后，Workflow 仍只关心输入、输出和配置 schema。
    """

    def __init__(self, mode: str, entrypoint: str | None = None) -> None:
        self.mode = mode
        self.entrypoint = entrypoint


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
    """通过受控子进程或容器执行插件包脚本入口的 Skill。

    支持两种运行时模式：
    - subprocess（默认）：通过子进程执行，兼容性最好。
    - container：通过 Docker 容器执行，提供网络隔离、资源限制等更强的安全边界。
      当 Docker 不可用时自动回退到 subprocess 模式。
    """

    def __init__(
        self,
        manifest: SkillManifest,
        handler_path: Path,
        *,
        package_root: Path | None = None,
        function_name: str = "run",
        timeout_seconds: int | None = None,
        runtime_mode: str = "subprocess",
    ) -> None:
        self.manifest = manifest
        # 子进程会把 cwd 切到插件根目录；这里必须提前转成绝对路径，
        # 避免相对路径在子进程中被再次拼接导致入口脚本找不到。
        self.handler_path = handler_path.resolve()
        self.package_root = (package_root or self.handler_path.parent).resolve()
        self.function_name = function_name
        # 这里是单次 Skill 调用的保护阈值，不是整个任务的总时长限制。
        # 真实任务可以循环执行很多条样本，但每条样本仍需要可控的最大运行时间。
        self.timeout_seconds = resolve_package_skill_timeout_seconds(timeout_seconds)
        self.runtime_mode = runtime_mode
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        # 容器模式：尝试通过 Docker 执行，失败时回退到子进程
        if self.runtime_mode == "container":
            try:
                return self._run_in_container(inputs, config)
            except Exception as exc:
                logger.warning(
                    "容器模式执行失败，回退到子进程模式：%s",
                    exc,
                )
        # 子进程模式（默认 / 回退）
        return self._run_in_subprocess(inputs, config)

    def _run_in_subprocess(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        """通过子进程执行 Skill 插件包。"""
        payload = json.dumps({"inputs": inputs, "config": config or {}}, ensure_ascii=False)
        try:
            env = os.environ.copy()
            env["AEGISQA_SKILL_PACKAGE_ROOT"] = str(self.package_root)
            env["AEGISQA_SKILL_PERMISSIONS"] = ",".join(self.manifest.permissions)
            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    _RUNNER_CODE,
                    str(self.handler_path),
                    self.function_name,
                ],
                input=payload,
                text=True,
                capture_output=True,
                cwd=str(self.package_root),
                env=env,
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
            stderr, stderr_truncated = _prepare_stream(completed.stderr, self.package_root)
            stdout, stdout_truncated = _prepare_stream(completed.stdout, self.package_root)
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
            stdout, stdout_truncated = _prepare_stream(completed.stdout, self.package_root)
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
            stdout, stdout_truncated = _prepare_stream(completed.stdout, self.package_root)
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
        )

    def _run_in_container(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        """通过 Docker 容器执行 Skill 插件包。

        容器模式提供网络隔离、只读根文件系统和资源限制。
        需要 Docker daemon 运行且 docker SDK 已安装。
        """
        from aegisqa.skills.container_runtime import (
            ContainerLimits,
            ContainerRuntime,
            ContainerRuntimeError,
        )

        runtime = ContainerRuntime()

        # 读取 skill.yaml 获取 runtime 配置
        skill_yaml_path = self.package_root / "skill.yaml"
        skill_manifest: dict[str, Any] = {}
        if skill_yaml_path.exists():
            skill_manifest = yaml.safe_load(skill_yaml_path.read_text(encoding="utf-8")) or {}

        # 构建镜像
        image_tag = runtime.build_image(
            skill_path=str(self.package_root),
            skill_manifest=skill_manifest,
        )

        try:
            # 执行容器
            input_data = {"inputs": inputs, "config": config or {}}
            result = runtime.run(
                image_tag=image_tag,
                input_data=input_data,
                limits=ContainerLimits(),
                timeout=self.timeout_seconds,
            )

            if result.exit_code != 0:
                raise AegisQAError(
                    "SKILL_PACKAGE_RUNTIME_ERROR",
                    result.stderr or f"容器退出码：{result.exit_code}",
                    details={
                        "returncode": result.exit_code,
                        "stderr": result.stderr,
                        "stdout": result.stdout,
                        "runtime_mode": "container",
                        "duration_ms": result.duration_ms,
                    },
                )

            # 解析容器 stdout 输出
            try:
                data = json.loads(result.stdout or "{}")
            except json.JSONDecodeError as exc:
                raise AegisQAError(
                    "SKILL_PACKAGE_OUTPUT_ERROR",
                    "容器内插件必须向 stdout 输出合法 JSON。",
                    details={"stdout": result.stdout, "runtime_mode": "container"},
                ) from exc

            return SkillResult(
                output=data.get("output", {}),
                metrics=data.get("metrics", {}),
                artifacts=data.get("artifacts", {}),
                logs=data.get("logs", []),
            )
        finally:
            # 清理镜像
            runtime.cleanup(image_tag=image_tag)


class InstructionPackageSkill(BaseSkill):
    """把上传包里的 `SKILL.md` 说明转换成可在 Workflow 中调用的 Skill。"""

    def __init__(self, manifest: SkillManifest, package_root: Path, *, runtime_mode: str = "instruction_model") -> None:
        self.manifest = manifest
        self.package_root = package_root.resolve()
        self.runtime_mode = runtime_mode
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        config = config or {}
        max_reference_chars = _bounded_int(config.get("max_reference_chars"), DEFAULT_REFERENCE_CHAR_LIMIT, MAX_REFERENCE_CHAR_LIMIT)
        skill_md = _read_skill_md(self.package_root)
        references = _read_reference_bundle(self.package_root, max_chars=max_reference_chars)
        response = ModelGateway.from_env(connection_id=config.get("model_connection_id")).generate(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你正在以 AegisQA 执行一个上传的 Agent Skill。"
                        "只能根据 SKILL.md、references 和输入数据生成结果；"
                        "如果 Skill 包没有脚本入口，不要假设可以运行本地命令。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"## SKILL.md\n{skill_md}\n\n"
                        f"## references\n{references or '无'}\n\n"
                        f"## inputs\n{yaml.safe_dump(inputs, allow_unicode=True, sort_keys=False)}\n\n"
                        f"## config\n{yaml.safe_dump(config, allow_unicode=True, sort_keys=False)}"
                    ),
                },
            ],
            model=config.get("model"),
            temperature=config.get("temperature"),
            max_tokens=config.get("max_tokens"),
        )
        metrics = model_response_usage_metrics(response, connection_id=config.get("model_connection_id"))
        metrics["latency_ms"] = response.latency_ms
        return SkillResult(
            output={
                "answer": response.text,
                "text": response.text,
                "skill_id": self.manifest.skill_id,
                "runtime_mode": self.runtime_mode,
            },
            metrics=metrics,
            artifacts={"model": response.model, "provider": response.provider, "usage": response.usage},
            logs=["Agent Skill 说明型运行时：已读取 SKILL.md/references，并通过统一模型网关生成输出。"],
        )


def resolve_package_entrypoint(package_root: Path, entrypoint: str | None) -> tuple[Path, str, str]:
    """解析并校验 `scripts/run.py:run` 形式的入口声明。"""

    if not entrypoint:
        entrypoint = "handler.py:run"
    path_part, function_name = entrypoint.rsplit(":", 1) if ":" in entrypoint else (entrypoint, "run")
    if not path_part.strip() or not function_name.strip():
        raise AegisQAError(
            "SKILL_PACKAGE_ENTRYPOINT_INVALID",
            "runtime.entrypoint 必须形如 scripts/run.py:run。",
            details={"entrypoint": entrypoint},
        )
    package_root = package_root.resolve()
    entrypoint_path = (package_root / path_part).resolve()
    if package_root not in entrypoint_path.parents and entrypoint_path != package_root:
        raise AegisQAError(
            "SKILL_PACKAGE_INVALID_PATH",
            "runtime.entrypoint 不能指向插件包目录之外的文件。",
            details={"entrypoint": entrypoint},
        )
    if not entrypoint_path.exists() or not entrypoint_path.is_file():
        raise AegisQAError(
            "SKILL_PACKAGE_ENTRYPOINT_MISSING",
            "插件包脚本入口不存在。",
            details={"entrypoint": entrypoint, "resolved_path": str(entrypoint_path)},
        )
    return entrypoint_path, function_name, f"{Path(path_part).as_posix()}:{function_name}"


def build_instruction_manifest_from_skill_md(package_root: Path) -> SkillManifest:
    """为只有 `SKILL.md` 的说明型 Skill 生成默认机器合约。"""

    skill_md_path = package_root / "SKILL.md"
    if not skill_md_path.exists():
        raise AegisQAError("SKILL_PACKAGE_SKILL_MD_MISSING", "说明型 Agent Skill 包缺少 SKILL.md。")
    metadata, body = _parse_skill_markdown(skill_md_path.read_text(encoding="utf-8"))
    name = str(metadata.get("name") or package_root.name)
    description = str(metadata.get("description") or _first_paragraph(body) or f"Agent Skill：{name}")
    return SkillManifest(
        skill_id=str(metadata.get("skill_id") or f"agent.{_slugify(name)}@0.1.0"),
        name=name,
        version=str(metadata.get("version") or "0.1.0"),
        description=description,
        author=str(metadata.get("author") or "Agent Skill"),
        tags=["agent-skill", "instruction-model", *_metadata_string_list(metadata.get("tags"))],
        scenarios=_metadata_string_list(metadata.get("scenarios")) or ["agent-workflow"],
        input_schema={
            "type": "object",
            "required": ["task"],
            "properties": {
                "task": {"type": "string", "description": "交给 Agent Skill 处理的任务文本。"},
                "row": {"type": "object", "description": "可选：完整数据集行。"},
                "context": {"type": "object", "description": "可选：上游节点输出。"},
            },
        },
        output_schema={
            "type": "object",
            "required": ["answer", "text"],
            "properties": {
                "answer": {"type": "string"},
                "text": {"type": "string"},
                "skill_id": {"type": "string"},
                "runtime_mode": {"type": "string"},
            },
        },
        config_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string"},
                "temperature": {"type": "number"},
                "max_tokens": {"type": "integer"},
                "max_reference_chars": {"type": "integer", "default": DEFAULT_REFERENCE_CHAR_LIMIT},
            },
        },
        cacheable=False,
        permissions=["model:call", "filesystem:skill_package_read"],
        enabled=False,
        status="pending_review",
        example_input={"task": f"请用一句话说明 {name} 的用途。"},
        example_config={},
    )


def _prepare_stream(value: str, package_root: Path, limit: int = MAX_PACKAGE_SKILL_STREAM_CHARS) -> tuple[str, bool]:
    """清洗并限制插件日志进入 API 响应，避免泄露本地路径或拖垮页面。"""

    text = _sanitize_local_paths((value or "").strip(), package_root)
    if len(text) <= limit:
        return text, False
    return text[:limit] + "...[已截断]", True


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
    text = re.sub(r'File ".*?\.py"', 'File "<skill_package>/script.py"', text)
    return re.sub(r"[a-zA-Z]:[\\/][^\s\"']+", "<local_path>", text)


def _read_skill_md(package_root: Path) -> str:
    return (package_root / "SKILL.md").read_text(encoding="utf-8")


def _read_reference_bundle(package_root: Path, *, max_chars: int) -> str:
    references_dir = package_root / "references"
    if not references_dir.exists():
        return ""
    chunks: list[str] = []
    remaining = max_chars
    for path in sorted(references_dir.rglob("*")):
        if remaining <= 0:
            break
        if not path.is_file() or path.suffix.lower() not in {".md", ".txt", ".json", ".yaml", ".yml"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")[:remaining]
        remaining -= len(text)
        chunks.append(f"### {path.relative_to(package_root).as_posix()}\n{text}")
    return "\n\n".join(chunks)


def _parse_skill_markdown(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, flags=re.DOTALL)
    if not match:
        return {}, text
    metadata = yaml.safe_load(match.group(1)) or {}
    return metadata if isinstance(metadata, dict) else {}, match.group(2)


def _first_paragraph(text: str) -> str:
    for block in re.split(r"\n\s*\n", text.strip()):
        cleaned = "\n".join(line.strip() for line in block.splitlines() if line.strip() and not line.strip().startswith("#"))
        if cleaned:
            return cleaned[:200]
    return ""


def _metadata_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (str, int, float)):
        return [str(value)]
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, (str, int, float))]


def _slugify(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", value.strip().lower()).strip("-") or "uploaded-skill"


def _bounded_int(value: Any, default: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(0, min(parsed, maximum))


_RUNNER_CODE = r"""
import builtins
import importlib.util
import io
import json
import os
import pathlib
import socket
import sys

handler_path = sys.argv[1]
function_name = sys.argv[2]
payload = json.loads(sys.stdin.read() or "{}")
package_root = pathlib.Path(os.environ.get("AEGISQA_SKILL_PACKAGE_ROOT") or ".").resolve()
permissions = {
    item.strip()
    for item in os.environ.get("AEGISQA_SKILL_PERMISSIONS", "").split(",")
    if item.strip()
}


def _has_permission(*names):
    return any(name in permissions for name in names)


def _ensure_path_allowed(path):
    if isinstance(path, int):
        return
    try:
        resolved = pathlib.Path(path).expanduser().resolve()
    except TypeError:
        return
    except Exception as exc:
        raise PermissionError("SKILL_PACKAGE_FILE_ACCESS_DENIED: 无法解析脚本访问的文件路径。") from exc
    if resolved == package_root or package_root in resolved.parents:
        return
    raise PermissionError("SKILL_PACKAGE_FILE_ACCESS_DENIED: 脚本只能访问 Skill 包目录内文件。")


_original_builtin_open = builtins.open
_original_io_open = io.open
_original_os_open = os.open
_original_path_open = pathlib.Path.open


def _guarded_builtin_open(file, *args, **kwargs):
    _ensure_path_allowed(file)
    return _original_builtin_open(file, *args, **kwargs)


def _guarded_io_open(file, *args, **kwargs):
    _ensure_path_allowed(file)
    return _original_io_open(file, *args, **kwargs)


def _guarded_os_open(file, *args, **kwargs):
    _ensure_path_allowed(file)
    return _original_os_open(file, *args, **kwargs)


def _guarded_path_open(self, *args, **kwargs):
    _ensure_path_allowed(self)
    return _original_path_open(self, *args, **kwargs)


builtins.open = _guarded_builtin_open
io.open = _guarded_io_open
os.open = _guarded_os_open
pathlib.Path.open = _guarded_path_open

if not _has_permission("network", "network:access", "http:request"):
    def _deny_network_socket(*args, **kwargs):
        raise PermissionError("SKILL_PACKAGE_NETWORK_DENIED: 脚本默认不能打开网络 socket。")

    socket.socket = _deny_network_socket
    socket.create_connection = _deny_network_socket

spec = importlib.util.spec_from_file_location("aegisqa_uploaded_skill_handler", handler_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if not hasattr(module, function_name):
    raise RuntimeError(f"脚本入口必须暴露 {function_name}(inputs, config)")
result = getattr(module, function_name)(payload.get("inputs", {}), payload.get("config", {}))
if result is None:
    result = {}
if "output" not in result:
    result = {"output": result, "metrics": {}, "artifacts": {}, "logs": []}
print(json.dumps(result, ensure_ascii=False))
"""
