"""Skill 导出/导入测试。"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
import yaml

from aegisqa.skills.base import SkillManifest
from aegisqa.skills.export_import import (
    CURRENT_SCHEMA_VERSION,
    SkillExportPackage,
    SkillImportResult,
    export_skill_package,
    import_skill_package,
    extract_zip_to_directory,
)


# ---------------------------------------------------------------------------
# 测试数据
# ---------------------------------------------------------------------------


def _make_manifest(skill_id: str = "test.export@0.1.0") -> SkillManifest:
    """创建测试用 SkillManifest。"""
    return SkillManifest(
        skill_id=skill_id,
        name="Test Export Skill",
        version="0.1.0",
        description="测试导出功能的 Skill",
        author="Test",
        tags=["test", "export"],
        scenarios=["unit-test"],
        permissions=[],
        input_schema={
            "type": "object",
            "required": ["question"],
            "properties": {"question": {"type": "string"}},
        },
        output_schema={
            "type": "object",
            "required": ["answer"],
            "properties": {"answer": {"type": "string"}},
        },
        config_schema={
            "type": "object",
            "properties": {"temperature": {"type": "number", "default": 0.7}},
        },
        example_input={"question": "What is AegisQA?"},
        example_config={"temperature": 0.5},
    )


def _make_handler_file(tmp_path: Path) -> Path:
    """创建测试用 handler.py。"""
    handler_dir = tmp_path / "test_skill"
    handler_dir.mkdir(parents=True, exist_ok=True)
    handler_path = handler_dir / "handler.py"
    handler_path.write_text(
        'def run(inputs, config):\n'
        '    return {"output": {"answer": "test"}, "metrics": {}, "artifacts": {}, "logs": []}\n',
        encoding="utf-8",
    )
    return handler_dir


# ---------------------------------------------------------------------------
# 导出测试
# ---------------------------------------------------------------------------


class TestExportSkillPackage:
    """测试 Skill 包导出。"""

    def test_export_basic(self) -> None:
        """基本导出功能。"""
        manifest = _make_manifest()
        result = export_skill_package("test.export@0.1.0", manifest)

        assert isinstance(result, SkillExportPackage)
        assert result.skill_id == "test.export@0.1.0"
        assert result.filename.endswith(".zip")
        assert len(result.zip_bytes) > 0
        assert result.metadata["schema_version"] == CURRENT_SCHEMA_VERSION
        assert result.metadata["skill_id"] == "test.export@0.1.0"

    def test_export_contains_required_files(self) -> None:
        """导出的 zip 包含必需文件。"""
        import zipfile
        import io

        manifest = _make_manifest()
        result = export_skill_package("test.export@0.1.0", manifest)

        with zipfile.ZipFile(io.BytesIO(result.zip_bytes), 'r') as zf:
            names = zf.namelist()
            assert "skill.yaml" in names
            assert "metadata.json" in names
            assert "README.md" in names

    def test_export_skill_yaml_content(self) -> None:
        """导出的 skill.yaml 内容正确。"""
        import zipfile
        import io

        manifest = _make_manifest()
        result = export_skill_package("test.export@0.1.0", manifest)

        with zipfile.ZipFile(io.BytesIO(result.zip_bytes), 'r') as zf:
            content = zf.read("skill.yaml").decode("utf-8")
            data = yaml.safe_load(content)
            assert data["skill_id"] == "test.export@0.1.0"
            assert data["name"] == "Test Export Skill"
            assert data["version"] == "0.1.0"

    def test_export_metadata_content(self) -> None:
        """导出的 metadata.json 内容正确。"""
        import zipfile
        import io

        manifest = _make_manifest()
        result = export_skill_package("test.export@0.1.0", manifest)

        with zipfile.ZipFile(io.BytesIO(result.zip_bytes), 'r') as zf:
            content = zf.read("metadata.json").decode("utf-8")
            data = json.loads(content)
            assert data["schema_version"] == CURRENT_SCHEMA_VERSION
            assert data["skill_id"] == "test.export@0.1.0"
            assert data["has_config_schema"] is True
            assert data["has_input_schema"] is True
            assert data["has_output_schema"] is True

    def test_export_readme_content(self) -> None:
        """导出的 README.md 内容正确。"""
        import zipfile
        import io

        manifest = _make_manifest()
        result = export_skill_package("test.export@0.1.0", manifest)

        with zipfile.ZipFile(io.BytesIO(result.zip_bytes), 'r') as zf:
            content = zf.read("README.md").decode("utf-8")
            assert "Test Export Skill" in content
            assert "test.export@0.1.0" in content
            assert "测试导出功能的 Skill" in content

    def test_export_with_package_root(self, tmp_path: Path) -> None:
        """导出包含包文件。"""
        import zipfile
        import io

        handler_dir = _make_handler_file(tmp_path)
        manifest = _make_manifest()
        result = export_skill_package("test.export@0.1.0", manifest, package_root=handler_dir)

        with zipfile.ZipFile(io.BytesIO(result.zip_bytes), 'r') as zf:
            names = zf.namelist()
            assert any("handler.py" in n for n in names)

    def test_export_with_history(self) -> None:
        """导出包含版本历史。"""
        import zipfile
        import io

        manifest = _make_manifest()
        history = [
            {"skill_id": "test.export@0.1.0", "version": "0.1.0", "status": "approved"},
        ]
        result = export_skill_package(
            "test.export@0.1.0", manifest,
            include_history=True, history_records=history,
        )

        with zipfile.ZipFile(io.BytesIO(result.zip_bytes), 'r') as zf:
            assert "history.json" in zf.namelist()
            content = zf.read("history.json").decode("utf-8")
            data = json.loads(content)
            assert len(data) == 1


# ---------------------------------------------------------------------------
# 导入测试
# ---------------------------------------------------------------------------


class TestImportSkillPackage:
    """测试 Skill 包导入。"""

    def _make_zip_bytes(self, manifest_dict: dict, files: dict[str, str] | None = None) -> bytes:
        """创建测试用 zip 包。"""
        import zipfile
        import io

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("skill.yaml", yaml.dump(manifest_dict, allow_unicode=True))
            zf.writestr("metadata.json", json.dumps({
                "schema_version": CURRENT_SCHEMA_VERSION,
                "skill_id": manifest_dict.get("skill_id", "test@0.1.0"),
            }))
            zf.writestr("handler.py", "def run(inputs, config):\n    return {'output': {}}\n")
            if files:
                for name, content in files.items():
                    zf.writestr(name, content)
        return buf.getvalue()

    def test_import_basic(self) -> None:
        """基本导入功能。"""
        manifest_dict = {
            "skill_id": "test.import@0.1.0",
            "name": "Test Import",
            "version": "0.1.0",
            "description": "测试导入",
            "author": "Test",
        }
        zip_bytes = self._make_zip_bytes(manifest_dict)
        result = import_skill_package(zip_bytes)

        assert isinstance(result, SkillImportResult)
        assert result.skill_id == "test.import@0.1.0"
        assert result.manifest["name"] == "Test Import"
        assert len(result.warnings) == 0

    def test_import_missing_skill_yaml(self) -> None:
        """缺少 skill.yaml 时抛出异常。"""
        import zipfile
        import io

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("handler.py", "def run(i, c): return {}")

        with pytest.raises(ValueError, match="缺少 skill.yaml"):
            import_skill_package(buf.getvalue())

    def test_import_old_schema_version(self) -> None:
        """旧 schema 版本给出警告。"""
        manifest_dict = {
            "skill_id": "test.old@0.1.0",
            "name": "Old Skill",
            "version": "0.1.0",
            "description": "旧版本",
            "author": "Test",
        }
        zip_bytes = self._make_zip_bytes(manifest_dict)

        # 修改 metadata 为旧版本
        import zipfile
        import io
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf_in:
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf_out:
                for item in zf_in.infolist():
                    content = zf_in.read(item.filename)
                    if item.filename == "metadata.json":
                        data = json.loads(content)
                        data["schema_version"] = 1
                        content = json.dumps(data).encode("utf-8")
                    zf_out.writestr(item, content)

        result = import_skill_package(buf.getvalue(), validate_compatibility=True)
        assert any("较旧" in w for w in result.warnings)

    def test_import_future_schema_version(self) -> None:
        """未来 schema 版本抛出异常。"""
        manifest_dict = {
            "skill_id": "test.future@0.1.0",
            "name": "Future Skill",
            "version": "0.1.0",
            "description": "未来版本",
            "author": "Test",
        }
        zip_bytes = self._make_zip_bytes(manifest_dict)

        # 修改 metadata 为未来版本
        import zipfile
        import io
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf_in:
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf_out:
                for item in zf_in.infolist():
                    content = zf_in.read(item.filename)
                    if item.filename == "metadata.json":
                        data = json.loads(content)
                        data["schema_version"] = CURRENT_SCHEMA_VERSION + 1
                        content = json.dumps(data).encode("utf-8")
                    zf_out.writestr(item, content)

        with pytest.raises(ValueError, match="高于当前支持的版本"):
            import_skill_package(buf.getvalue(), validate_compatibility=True)

    def test_import_skill_id_without_version(self) -> None:
        """skill_id 缺少版本号时自动添加。"""
        manifest_dict = {
            "skill_id": "test.no_version",
            "name": "No Version",
            "version": "0.1.0",
            "description": "无版本号",
            "author": "Test",
        }
        zip_bytes = self._make_zip_bytes(manifest_dict)
        result = import_skill_package(zip_bytes)

        assert "@0.1.0" in result.skill_id
        assert any("缺少版本号" in w for w in result.warnings)


# ---------------------------------------------------------------------------
# 导入/导出往返测试
# ---------------------------------------------------------------------------


class TestExportImportRoundTrip:
    """测试导出后再导入的往返一致性。"""

    def test_roundtrip_basic(self, tmp_path: Path) -> None:
        """基本往返测试。"""
        manifest = _make_manifest()
        handler_dir = _make_handler_file(tmp_path)

        # 导出
        export_result = export_skill_package("test.export@0.1.0", manifest, package_root=handler_dir)

        # 导入
        import_result = import_skill_package(export_result.zip_bytes)

        assert import_result.skill_id == export_result.skill_id
        assert import_result.manifest["name"] == manifest.name
        assert import_result.manifest["version"] == manifest.version
        assert len(import_result.warnings) == 0

    def test_roundtrip_with_all_schemas(self) -> None:
        """包含所有 schema 的往返测试。"""
        manifest = _make_manifest()

        # 导出
        export_result = export_skill_package("test.export@0.1.0", manifest)

        # 导入
        import_result = import_skill_package(export_result.zip_bytes)

        assert import_result.manifest.get("input_schema") is not None
        assert import_result.manifest.get("output_schema") is not None
        assert import_result.manifest.get("config_schema") is not None


# ---------------------------------------------------------------------------
# 目录解压测试
# ---------------------------------------------------------------------------


class TestExtractZipToDirectory:
    """测试 zip 解压到目录。"""

    def test_extract_creates_directory(self, tmp_path: Path) -> None:
        """解压创建目录。"""
        import zipfile
        import io

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("test.txt", "hello")
            zf.writestr("sub/nested.txt", "world")

        target = tmp_path / "extracted"
        extract_zip_to_directory(buf.getvalue(), target)

        assert (target / "test.txt").read_text() == "hello"
        assert (target / "sub" / "nested.txt").read_text() == "world"

    def test_extract_overwrites_existing(self, tmp_path: Path) -> None:
        """解压覆盖已有文件。"""
        import zipfile
        import io

        target = tmp_path / "extracted"
        target.mkdir()
        (target / "old.txt").write_text("old")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("new.txt", "new")

        extract_zip_to_directory(buf.getvalue(), target)

        assert (target / "new.txt").read_text() == "new"
        # 旧文件仍然存在（解压不清理）
        assert (target / "old.txt").read_text() == "old"
