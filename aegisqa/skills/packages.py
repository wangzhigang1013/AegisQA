"""Skill 插件包执行适配。

插件包里的 Python 代码不在 FastAPI 主进程中 import，而是通过短生命周期子进程执行。
这样即使插件抛异常或污染全局状态，也不会影响 API 服务本身。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult


class SubprocessPackageSkill(BaseSkill):
    """通过受控子进程执行插件包 `handler.py` 的 Skill。"""

    def __init__(self, manifest: SkillManifest, handler_path: Path, *, timeout_seconds: int = 10) -> None:
        self.manifest = manifest
        # 子进程会把 cwd 切到插件目录；这里必须提前转成绝对路径，
        # 避免相对路径在子进程中被再次拼接导致 handler.py 找不到。
        self.handler_path = handler_path.resolve()
        self.timeout_seconds = timeout_seconds
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        payload = json.dumps({"inputs": inputs, "config": config or {}}, ensure_ascii=False)
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
        if completed.returncode != 0:
            message = completed.stderr.strip() or completed.stdout.strip() or f"插件进程退出码：{completed.returncode}"
            raise RuntimeError(message)
        data = json.loads(completed.stdout or "{}")
        return SkillResult(
            output=data.get("output", {}),
            metrics=data.get("metrics", {}),
            artifacts=data.get("artifacts", {}),
            logs=data.get("logs", []),
        )


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
