"""Skill 容器化运行时。

通过 Docker SDK for Python 在隔离容器中执行 Skill 插件包，提供网络隔离、
资源限制和只读根文件系统等安全边界。当 Docker 不可用时抛出明确错误，
调用方可据此回退到子进程模式。
"""

from __future__ import annotations

import json
import logging
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent
from typing import Any

logger = logging.getLogger(__name__)


class ContainerRuntimeError(Exception):
    """容器运行时错误。

    当 Docker 不可用、镜像构建失败或容器执行异常时抛出。
    调用方可捕获此异常并回退到子进程模式。
    """

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


@dataclass
class ContainerLimits:
    """容器资源限制配置。

    默认值兼顾安全与可用性：256 MB 内存、0.5 CPU 配额足以运行大多数
    文本处理类 Skill，同时不会挤占宿主机资源。
    """

    memory_mb: int = 256
    cpu_quota: int = 50000  # 0.5 CPU（100000 = 1 核）
    network_disabled: bool = True
    read_only_root: bool = True


@dataclass
class ContainerResult:
    """容器执行结果。"""

    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int


# 镜像标签前缀，便于 cleanup 时批量识别
_IMAGE_TAG_PREFIX = "aegisqa-skill:"
_BASE_IMAGE_NAME = "aegisqa-skill-base"


def _lazy_docker_client():
    """延迟导入并创建 Docker 客户端。

    仅在首次调用时尝试连接 Docker daemon，避免在不需要容器模式的部署中
    强制依赖 docker 包。
    """
    try:
        import docker
    except ImportError as exc:
        raise ContainerRuntimeError(
            "Docker SDK for Python 未安装，请执行 pip install docker。",
            details={"missing_package": "docker"},
        ) from exc
    try:
        client = docker.from_env()
        client.ping()
        return client
    except Exception as exc:
        raise ContainerRuntimeError(
            "无法连接到 Docker daemon，请确认 Docker 服务已启动且当前用户有访问权限。",
            details={"underlying_error": str(exc)},
        ) from exc


class ContainerRuntime:
    """Skill 容器化执行引擎。

    将 Skill 插件包打包成 Docker 镜像，并在受控容器中执行。
    每次执行都使用独立容器，确保环境隔离。
    """

    def __init__(self, docker_client: Any = None) -> None:
        self._docker_client = docker_client

    def _get_client(self):
        """获取 Docker 客户端（懒加载）。"""
        if self._docker_client is None:
            self._docker_client = _lazy_docker_client()
        return self._docker_client

    def build_image(
        self,
        skill_path: str,
        skill_manifest: dict[str, Any],
        tag: str | None = None,
    ) -> str:
        """为 Skill 插件包构建 Docker 镜像。

        读取 skill.yaml 中的 runtime.dependencies 生成 pip install 指令，
        将整个插件包目录复制到镜像内。

        Args:
            skill_path: Skill 插件包目录路径。
            skill_manifest: 已解析的 skill.yaml 内容（字典形式）。
            tag: 可选的镜像标签；未指定时自动生成。

        Returns:
            构建完成的镜像标签。
        """
        skill_dir = Path(skill_path).resolve()
        if not skill_dir.is_dir():
            raise ContainerRuntimeError(
                f"Skill 目录不存在：{skill_path}",
                details={"skill_path": str(skill_path)},
            )

        # 从 manifest 提取依赖列表
        runtime = skill_manifest.get("runtime", {})
        dependencies = runtime.get("dependencies", [])
        entrypoint = runtime.get("entrypoint", "handler.py:run")

        image_tag = tag or f"{_IMAGE_TAG_PREFIX}{skill_dir.name}:{int(time.time())}"

        # 生成临时 Dockerfile
        dockerfile_content = self._generate_skill_dockerfile(
            dependencies=dependencies,
            entrypoint=entrypoint,
        )

        with tempfile.TemporaryDirectory(prefix="aegisqa_docker_") as tmp_dir:
            dockerfile_path = Path(tmp_dir) / "Dockerfile"
            dockerfile_path.write_text(dockerfile_content, encoding="utf-8")

            client = self._get_client()
            try:
                logger.info("正在构建 Skill 镜像：%s", image_tag)
                image, build_logs = client.images.build(
                    path=str(skill_dir),
                    dockerfile=str(dockerfile_path),
                    tag=image_tag,
                    rm=True,
                    forcerm=True,
                )
                for chunk in build_logs:
                    if "stream" in chunk:
                        logger.debug("构建日志：%s", chunk["stream"].strip())
                logger.info("镜像构建完成：%s", image_tag)
                return image_tag
            except Exception as exc:
                raise ContainerRuntimeError(
                    f"镜像构建失败：{exc}",
                    details={"image_tag": image_tag, "underlying_error": str(exc)},
                ) from exc

    def run(
        self,
        image_tag: str,
        input_data: dict[str, Any],
        limits: ContainerLimits | None = None,
        timeout: int = 60,
    ) -> ContainerResult:
        """在隔离容器中执行 Skill。

        容器配置：
        - --network none：完全禁用网络，防止插件外联。
        - 只读根文件系统：防止插件修改容器内系统文件。
        - CPU / 内存限制：防止单个插件耗尽宿主机资源。
        - 超时保护：超时后强制终止容器。

        Args:
            image_tag: 要运行的镜像标签。
            input_data: 传入 Skill 的输入数据（inputs + config）。
            limits: 可选的资源限制配置。
            timeout: 执行超时秒数。

        Returns:
            包含 exit_code、stdout、stderr、duration_ms 的执行结果。
        """
        limits = limits or ContainerLimits()
        client = self._get_client()

        payload = json.dumps(input_data, ensure_ascii=False)
        container = None
        started_ms = _now_ms()

        try:
            container = client.containers.run(
                image=image_tag,
                command=None,  # 使用镜像 ENTRYPOINT
                stdin_open=True,
                detach=True,
                # 安全隔离
                network_disabled=limits.network_disabled,
                read_only=limits.read_only_root,
                # 资源限制
                mem_limit=f"{limits.memory_mb}m",
                cpu_quota=limits.cpu_quota,
                # 临时写入目录（只读根文件系统下需要）
                tmpfs={"/tmp": "size=64m"},
            )

            # 通过 stdin 传入输入数据
            socket = container.attach_socket(params={"stdin": 1, "stream": 1})
            socket._sock.sendall(payload.encode("utf-8"))
            socket.close()

            # 等待容器完成，带超时保护
            result = container.wait(timeout=timeout)
            exit_code = result.get("StatusCode", -1)

            stdout = container.logs(stdout=True, stderr=False).decode("utf-8", errors="replace")
            stderr = container.logs(stdout=False, stderr=True).decode("utf-8", errors="replace")

            duration_ms = _now_ms() - started_ms
            return ContainerResult(
                exit_code=exit_code,
                stdout=stdout.strip(),
                stderr=stderr.strip(),
                duration_ms=duration_ms,
            )

        except Exception as exc:
            duration_ms = _now_ms() - started_ms
            # 超时场景：尝试强制终止容器
            if container is not None:
                try:
                    container.kill()
                except Exception:  # noqa: BLE001
                    pass
            raise ContainerRuntimeError(
                f"容器执行失败：{exc}",
                details={
                    "image_tag": image_tag,
                    "timeout": timeout,
                    "duration_ms": duration_ms,
                    "underlying_error": str(exc),
                },
            ) from exc

        finally:
            # 确保容器被清理
            if container is not None:
                try:
                    container.remove(force=True)
                except Exception:  # noqa: BLE001
                    pass

    def cleanup(
        self,
        image_tag: str | None = None,
        container_id: str | None = None,
    ) -> None:
        """清理 Skill 相关的镜像和容器。

        Args:
            image_tag: 要删除的镜像标签；为 None 时跳过。
            container_id: 要强制删除的容器 ID；为 None 时跳过。
        """
        client = self._get_client()

        if container_id:
            try:
                container = client.containers.get(container_id)
                container.remove(force=True)
                logger.info("已清理容器：%s", container_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("清理容器失败 %s：%s", container_id, exc)

        if image_tag:
            try:
                client.images.remove(image=image_tag, force=True)
                logger.info("已清理镜像：%s", image_tag)
            except Exception as exc:  # noqa: BLE001
                logger.warning("清理镜像失败 %s：%s", image_tag, exc)

    def _generate_skill_dockerfile(
        self,
        dependencies: list[str],
        entrypoint: str,
    ) -> str:
        """生成 Skill 专用 Dockerfile 内容。

        基于 aegisqa-skill-base 基础镜像，安装 Skill 声明的依赖，
        复制插件包文件并设置入口。
        """
        # 解析 entrypoint（格式：handler.py:run）
        if ":" in entrypoint:
            script_path, function_name = entrypoint.rsplit(":", 1)
        else:
            script_path, function_name = entrypoint, "run"

        pip_install = ""
        if dependencies:
            pip_lines = " \\\n    ".join(f"'{dep}'" for dep in dependencies)
            pip_install = f"RUN pip install --no-cache-dir \\\n    {pip_lines}"

        return dedent(f"""\
            FROM {_BASE_IMAGE_NAME}

            {pip_install}

            COPY --chown=skilluser:skilluser . /app/skill

            USER skilluser
            WORKDIR /app/skill

            ENTRYPOINT ["python", "-c", "{self._build_entrypoint_code(script_path, function_name)}"]
        """)

    @staticmethod
    def _build_entrypoint_code(script_path: str, function_name: str) -> str:
        """生成容器 ENTRYPOINT 的 Python 执行代码。

        该代码从 stdin 读取 JSON 输入，调用 Skill handler 函数，
        并将结果输出到 stdout。为了嵌入 Dockerfile 的 ENTRYPOINT 指令，
        需要将代码压缩为单行并转义引号。
        """
        code = (
            "import importlib.util,json,sys;"
            "p=json.loads(sys.stdin.read() or '{}');"
            "spec=importlib.util.spec_from_file_location('_h','__SCRIPT__');"
            "m=importlib.util.module_from_spec(spec);"
            "spec.loader.exec_module(m);"
            "r=getattr(m,'__FUNC__')(p.get('inputs',{}),p.get('config',{}));"
            "r=r if isinstance(r,dict) else {};"
            "r={'output':r.get('output',r),'metrics':r.get('metrics',{}),'artifacts':r.get('artifacts',{}),'logs':r.get('logs',[])};"
            "print(json.dumps(r,ensure_ascii=False))"
        )
        code = code.replace("__SCRIPT__", script_path).replace("__FUNC__", function_name)
        # 转义双引号以嵌入 JSON 字符串
        return code.replace('"', '\\"')


def _now_ms() -> int:
    """返回当前时间戳（毫秒）。"""
    return int(time.time() * 1000)
