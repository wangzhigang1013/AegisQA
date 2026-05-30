"""Skill 插件包执行适配。

插件包里的 Python 代码不在 FastAPI 主进程中 import，而是通过短生命周期子进程执行。
这样即使插件抛异常或污染全局状态，也不会影响 API 服务本身。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from aegisqa.core.errors import AegisQAError
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult


DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS = 5
MAX_PACKAGE_SKILL_OUTPUT_BYTES = 64 * 1024
MAX_PACKAGE_SKILL_STREAM_CHARS = 4000


class SubprocessPackageSkill(BaseSkill):
    """通过受控子进程执行插件包 `handler.py` 的 Skill。"""

    def __init__(
        self,
        manifest: SkillManifest,
        handler_path: Path,
        *,
        timeout_seconds: int = DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS,
    ) -> None:
        self.manifest = manifest
        # 子进程会把 cwd 切到插件目录；这里必须提前转成绝对路径，
        # 避免相对路径在子进程中被再次拼接导致 handler.py 找不到。
        self.handler_path = handler_path.resolve()
        # 合约测试需要覆盖真实 Python 子进程冷启动；1 秒在 Windows 并发 E2E 下会误杀正常插件。
        self.timeout_seconds = timeout_seconds
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        payload = json.dumps({"inputs": inputs, "config": config or {}}, ensure_ascii=False)
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
    text = re.sub(r'File ".*?handler\.py"', 'File "<skill_package>/handler.py"', text)
    return re.sub(r"[a-zA-Z]:[\\/][^\s\"']+", "<local_path>", text)


_RUNNER_CODE = r"""
import importlib.util
import json
import sys

handler_path = sys.argv[1]
payload = json.loads(sys.stdin.read() or "{}")
spec = importlib.util.spec_from_file_location("aegisqa_uploaded_skill_handler", handler_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if not hasattr(module, "run"):
    raise RuntimeError("handler.py 必须暴露 run(inputs, config)")
result = module.run(payload.get("inputs", {}), payload.get("config", {}))
if result is None:
    result = {}
if "output" not in result:
    result = {"output": result, "metrics": {}, "artifacts": {}, "logs": []}
print(json.dumps(result, ensure_ascii=False))
"""
