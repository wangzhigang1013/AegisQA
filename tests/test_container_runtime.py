"""Skill 容器运行时测试。

使用 mock Docker 客户端验证 ContainerRuntime 的核心逻辑，
不依赖真实的 Docker daemon。
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from aegisqa.skills.base import SkillManifest, SkillResult


# ---------------------------------------------------------------------------
# ContainerLimits / ContainerResult 数据结构测试
# ---------------------------------------------------------------------------


class TestContainerLimits:
    """验证 ContainerLimits 默认值与自定义值。"""

    def test_defaults(self) -> None:
        from aegisqa.skills.container_runtime import ContainerLimits

        limits = ContainerLimits()
        assert limits.memory_mb == 256
        assert limits.cpu_quota == 50000
        assert limits.network_disabled is True
        assert limits.read_only_root is True

    def test_custom_values(self) -> None:
        from aegisqa.skills.container_runtime import ContainerLimits

        limits = ContainerLimits(memory_mb=512, cpu_quota=100000, network_disabled=False, read_only_root=False)
        assert limits.memory_mb == 512
        assert limits.cpu_quota == 100000
        assert limits.network_disabled is False
        assert limits.read_only_root is False


class TestContainerResult:
    """验证 ContainerResult 结构。"""

    def test_fields(self) -> None:
        from aegisqa.skills.container_runtime import ContainerResult

        result = ContainerResult(exit_code=0, stdout="ok", stderr="", duration_ms=123)
        assert result.exit_code == 0
        assert result.stdout == "ok"
        assert result.stderr == ""
        assert result.duration_ms == 123


# ---------------------------------------------------------------------------
# ContainerRuntime 单元测试
# ---------------------------------------------------------------------------


class TestContainerRuntimeBuildImage:
    """验证 build_image 生成正确的 Dockerfile 内容。"""

    def test_generates_dockerfile_with_dependencies(self, tmp_path: Path) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        skill_dir = tmp_path / "my_skill"
        skill_dir.mkdir()
        (skill_dir / "handler.py").write_text("def run(i, c): return {'output': {}}", encoding="utf-8")

        manifest = {
            "runtime": {
                "entrypoint": "handler.py:run",
                "dependencies": ["pandas>=2.0", "numpy"],
            }
        }

        mock_client = MagicMock()
        mock_image = MagicMock()
        mock_client.images.build.return_value = (mock_image, [{"stream": "Step 1/5"}])

        runtime = ContainerRuntime(docker_client=mock_client)
        tag = runtime.build_image(str(skill_dir), manifest, tag="test-skill:latest")

        assert tag == "test-skill:latest"
        mock_client.images.build.assert_called_once()

        # 验证构建参数
        call_kwargs = mock_client.images.build.call_args
        assert call_kwargs.kwargs["tag"] == "test-skill:latest"
        assert call_kwargs.kwargs["rm"] is True

    def test_generates_dockerfile_without_dependencies(self, tmp_path: Path) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        skill_dir = tmp_path / "simple_skill"
        skill_dir.mkdir()
        (skill_dir / "handler.py").write_text("def run(i, c): return {}", encoding="utf-8")

        manifest = {"runtime": {"entrypoint": "handler.py:run"}}

        mock_client = MagicMock()
        mock_client.images.build.return_value = (MagicMock(), [])

        runtime = ContainerRuntime(docker_client=mock_client)
        runtime.build_image(str(skill_dir), manifest)

        mock_client.images.build.assert_called_once()

    def test_raises_on_invalid_skill_path(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime, ContainerRuntimeError

        mock_client = MagicMock()
        runtime = ContainerRuntime(docker_client=mock_client)

        with pytest.raises(ContainerRuntimeError, match="Skill 目录不存在"):
            runtime.build_image("/nonexistent/path", {})

    def test_raises_on_build_failure(self, tmp_path: Path) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime, ContainerRuntimeError

        skill_dir = tmp_path / "fail_skill"
        skill_dir.mkdir()
        (skill_dir / "handler.py").write_text("def run(i, c): return {}", encoding="utf-8")

        mock_client = MagicMock()
        mock_client.images.build.side_effect = Exception("Build failed")

        runtime = ContainerRuntime(docker_client=mock_client)
        with pytest.raises(ContainerRuntimeError, match="镜像构建失败"):
            runtime.build_image(str(skill_dir), {})


class TestContainerRuntimeRun:
    """验证 run 方法的容器执行逻辑。"""

    def _make_mock_client(self, exit_code: int = 0, stdout: str = "{}", stderr: str = "") -> MagicMock:
        """构造模拟 Docker 客户端。"""
        mock_client = MagicMock()

        mock_container = MagicMock()
        mock_container.wait.return_value = {"StatusCode": exit_code}
        stdout_bytes = stdout.encode("utf-8") if isinstance(stdout, str) else stdout
        stderr_bytes = stderr.encode("utf-8") if isinstance(stderr, str) else stderr
        mock_container.logs.side_effect = lambda stdout=True, stderr=True: (
            stdout_bytes if stdout else stderr_bytes
        )
        mock_container.attach_socket.return_value = MagicMock()

        mock_client.containers.run.return_value = mock_container
        return mock_client

    def test_successful_execution(self) -> None:
        from aegisqa.skills.container_runtime import ContainerLimits, ContainerResult, ContainerRuntime

        mock_client = self._make_mock_client(exit_code=0, stdout='{"output": {"answer": "42"}}')
        runtime = ContainerRuntime(docker_client=mock_client)

        result = runtime.run("test-image:latest", {"inputs": {"q": "what?"}}, timeout=30)

        assert isinstance(result, ContainerResult)
        assert result.exit_code == 0
        mock_client.containers.run.assert_called_once()

        # 验证安全隔离参数
        call_kwargs = mock_client.containers.run.call_args.kwargs
        assert call_kwargs["network_disabled"] is True
        assert call_kwargs["read_only"] is True

    def test_custom_limits(self) -> None:
        from aegisqa.skills.container_runtime import ContainerLimits, ContainerRuntime

        mock_client = self._make_mock_client()
        runtime = ContainerRuntime(docker_client=mock_client)

        custom_limits = ContainerLimits(memory_mb=512, cpu_quota=100000)
        runtime.run("test-image:latest", {"inputs": {}}, limits=custom_limits)

        call_kwargs = mock_client.containers.run.call_args.kwargs
        assert call_kwargs["mem_limit"] == "512m"
        assert call_kwargs["cpu_quota"] == 100000

    def test_container_failure_returns_nonzero_exit(self) -> None:
        """容器退出码非零时，run 应返回结果（由调用方检查退出码）。"""
        from aegisqa.skills.container_runtime import ContainerRuntime

        mock_client = self._make_mock_client(exit_code=1, stderr="Error occurred")
        mock_container = mock_client.containers.run.return_value
        mock_container.wait.return_value = {"StatusCode": 1}
        mock_container.logs.return_value = b"Error occurred"

        runtime = ContainerRuntime(docker_client=mock_client)
        result = runtime.run("test-image:latest", {"inputs": {}})
        assert result.exit_code == 1
        assert "Error" in result.stderr

    def test_cleanup_called_on_failure(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime, ContainerRuntimeError

        mock_client = MagicMock()
        mock_container = MagicMock()
        mock_container.wait.side_effect = Exception("Timeout")
        mock_container.attach_socket.return_value = MagicMock()
        mock_client.containers.run.return_value = mock_container

        runtime = ContainerRuntime(docker_client=mock_client)
        with pytest.raises(ContainerRuntimeError):
            runtime.run("test-image:latest", {"inputs": {}}, timeout=1)

        # 容器应被强制移除
        mock_container.remove.assert_called_once_with(force=True)


class TestContainerRuntimeCleanup:
    """验证 cleanup 方法。"""

    def test_cleanup_image(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        mock_client = MagicMock()
        runtime = ContainerRuntime(docker_client=mock_client)

        runtime.cleanup(image_tag="old-image:latest")
        mock_client.images.remove.assert_called_once_with(image="old-image:latest", force=True)

    def test_cleanup_container(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        mock_client = MagicMock()
        mock_container = MagicMock()
        mock_client.containers.get.return_value = mock_container

        runtime = ContainerRuntime(docker_client=mock_client)
        runtime.cleanup(container_id="abc123")

        mock_client.containers.get.assert_called_once_with("abc123")
        mock_container.remove.assert_called_once_with(force=True)

    def test_cleanup_both(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        mock_client = MagicMock()
        runtime = ContainerRuntime(docker_client=mock_client)

        runtime.cleanup(image_tag="img:v1", container_id="ctr1")
        mock_client.images.remove.assert_called_once()
        mock_client.containers.get.assert_called_once()

    def test_cleanup_noop(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        mock_client = MagicMock()
        runtime = ContainerRuntime(docker_client=mock_client)

        # 不传参数不应报错
        runtime.cleanup()
        mock_client.images.remove.assert_not_called()
        mock_client.containers.get.assert_not_called()


# ---------------------------------------------------------------------------
# Docker 不可用时的优雅降级测试
# ---------------------------------------------------------------------------


class TestDockerUnavailableFallback:
    """验证 Docker 不可用时的错误处理。"""

    def test_lazy_client_raises_when_docker_not_installed(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime, ContainerRuntimeError

        # 直接传入一个会抛异常的 mock
        runtime = ContainerRuntime(docker_client=None)

        with patch("aegisqa.skills.container_runtime._lazy_docker_client") as mock_lazy:
            mock_lazy.side_effect = ContainerRuntimeError("Docker SDK for Python 未安装")
            with pytest.raises(ContainerRuntimeError, match="Docker SDK"):
                runtime._get_client()

    def test_lazy_client_raises_when_daemon_unreachable(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime, ContainerRuntimeError

        runtime = ContainerRuntime(docker_client=None)

        with patch("aegisqa.skills.container_runtime._lazy_docker_client") as mock_lazy:
            mock_lazy.side_effect = ContainerRuntimeError("无法连接到 Docker daemon")
            with pytest.raises(ContainerRuntimeError, match="Docker daemon"):
                runtime._get_client()


# ---------------------------------------------------------------------------
# SkillPackageRunner 集成测试
# ---------------------------------------------------------------------------


class TestSkillPackageRunnerContainerIntegration:
    """验证 SubprocessPackageSkill 的 container 运行时模式集成。"""

    def _write_skill_package(self, tmp_path: Path, name: str = "test_skill") -> tuple[Path, Path]:
        """创建一个最小可执行的 Skill 插件包。"""
        skill_dir = tmp_path / name
        skill_dir.mkdir(parents=True, exist_ok=True)

        handler_code = '''def run(inputs, config):
    return {"output": {"answer": "container_result"}, "metrics": {}, "artifacts": {}, "logs": []}
'''
        handler_path = skill_dir / "handler.py"
        handler_path.write_text(handler_code, encoding="utf-8")

        skill_yaml = """skill_id: test.container@0.1.0
name: container-test
version: "0.1.0"
description: 测试用 Skill
author: test
runtime:
  mode: package
  entrypoint: handler.py:run
  dependencies: []
"""
        (skill_dir / "skill.yaml").write_text(skill_yaml, encoding="utf-8")

        manifest = SkillManifest(
            skill_id="test.container@0.1.0",
            name="container-test",
            version="0.1.0",
            description="测试用 Skill",
            author="test",
            permissions=[],
        )
        return skill_dir, handler_path

    def test_container_mode_falls_back_to_subprocess(self, tmp_path: Path) -> None:
        """当 Docker 不可用时，container 模式应回退到 subprocess。"""
        from aegisqa.skills.packages import SubprocessPackageSkill

        skill_dir, handler_path = self._write_skill_package(tmp_path)
        manifest = SkillManifest(
            skill_id="test.fallback@0.1.0",
            name="fallback-test",
            version="0.1.0",
            description="回退测试",
            author="test",
            permissions=[],
        )

        skill = SubprocessPackageSkill(
            manifest=manifest,
            handler_path=handler_path,
            package_root=skill_dir,
            runtime_mode="container",
        )

        # Docker 不可用时应自动回退到子进程并正常执行
        result = skill.run({"question": "test"}, {})
        assert isinstance(result, SkillResult)
        assert result.output.get("answer") == "container_result"

    def test_subprocess_mode_unchanged(self, tmp_path: Path) -> None:
        """subprocess 模式行为不变。"""
        from aegisqa.skills.packages import SubprocessPackageSkill

        skill_dir, handler_path = self._write_skill_package(tmp_path)
        manifest = SkillManifest(
            skill_id="test.subprocess@0.1.0",
            name="subprocess-test",
            version="0.1.0",
            description="子进程测试",
            author="test",
            permissions=[],
        )

        skill = SubprocessPackageSkill(
            manifest=manifest,
            handler_path=handler_path,
            package_root=skill_dir,
            runtime_mode="subprocess",
        )

        result = skill.run({"question": "test"}, {})
        assert isinstance(result, SkillResult)
        assert result.output.get("answer") == "container_result"

    def test_runtime_mode_attribute_stored(self, tmp_path: Path) -> None:
        """验证 runtime_mode 被正确存储。"""
        from aegisqa.skills.packages import SubprocessPackageSkill

        skill_dir, handler_path = self._write_skill_package(tmp_path)
        manifest = SkillManifest(
            skill_id="test.mode@0.1.0",
            name="mode-test",
            version="0.1.0",
            description="模式测试",
            author="test",
            permissions=[],
        )

        skill = SubprocessPackageSkill(
            manifest=manifest,
            handler_path=handler_path,
            package_root=skill_dir,
            runtime_mode="container",
        )
        assert skill.runtime_mode == "container"

        skill2 = SubprocessPackageSkill(
            manifest=manifest,
            handler_path=handler_path,
            package_root=skill_dir,
        )
        assert skill2.runtime_mode == "subprocess"


# ---------------------------------------------------------------------------
# Dockerfile 生成测试
# ---------------------------------------------------------------------------


class TestDockerfileGeneration:
    """验证 _generate_skill_dockerfile 输出内容。"""

    def test_with_dependencies(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        runtime = ContainerRuntime(docker_client=MagicMock())
        content = runtime._generate_skill_dockerfile(
            dependencies=["pandas>=2.0", "numpy"],
            entrypoint="handler.py:run",
        )

        assert "FROM aegisqa-skill-base" in content
        assert "pandas>=2.0" in content
        assert "numpy" in content
        assert "pip install" in content
        assert "COPY" in content
        assert "USER skilluser" in content
        assert "ENTRYPOINT" in content

    def test_without_dependencies(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        runtime = ContainerRuntime(docker_client=MagicMock())
        content = runtime._generate_skill_dockerfile(
            dependencies=[],
            entrypoint="main.py:execute",
        )

        assert "FROM aegisqa-skill-base" in content
        assert "pip install" not in content
        assert "main.py" in content
        assert "execute" in content

    def test_entrypoint_parsing(self) -> None:
        from aegisqa.skills.container_runtime import ContainerRuntime

        runtime = ContainerRuntime(docker_client=MagicMock())

        # 带函数名
        content = runtime._generate_skill_dockerfile([], "scripts/run.py:main")
        assert "scripts/run.py" in content
        assert "main" in content

        # 不带函数名
        content2 = runtime._generate_skill_dockerfile([], "handler.py")
        assert "handler.py" in content2
