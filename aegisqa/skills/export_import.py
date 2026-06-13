"""Skill 包导出/导入模块。

支持将 Skill 包导出为标准格式的 zip 文件，以及从标准格式导入 Skill 包。
标准格式包含：
- skill.yaml: Skill 清单定义
- handler.py: 执行脚本（script 模式）或 SKILL.md（instruction_model 模式）
- README.md: 说明文档
- metadata.json: 导出元数据（版本、时间戳、兼容性信息）
- tests/: 内置测试用例（可选）
"""

from __future__ import annotations

import base64
import io
import json
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aegisqa.skills.base import SkillManifest


@dataclass
class SkillExportPackage:
    """导出的 Skill 包。"""
    skill_id: str
    filename: str
    zip_bytes: bytes
    metadata: dict[str, Any]


@dataclass
class SkillImportResult:
    """导入结果。"""
    skill_id: str
    filename: str
    manifest: dict[str, Any]
    metadata: dict[str, Any]
    warnings: list[str]


# 当前支持的 schema 版本
CURRENT_SCHEMA_VERSION = 2


def export_skill_package(
    skill_id: str,
    manifest: SkillManifest,
    package_root: Path | None = None,
    include_tests: bool = False,
    include_history: bool = False,
    history_records: list[dict[str, Any]] | None = None,
) -> SkillExportPackage:
    """导出 Skill 包为标准 zip 格式。

    Args:
        skill_id: Skill ID。
        manifest: Skill 清单。
        package_root: Skill 包根目录（script 模式）。
        include_tests: 是否包含测试用例。
        include_history: 是否包含版本历史。
        history_records: 版本历史记录。

    Returns:
        SkillExportPackage 对象。
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 写入 skill.yaml
        skill_yaml = _manifest_to_yaml(manifest)
        zf.writestr('skill.yaml', skill_yaml)

        # 写入 metadata.json
        metadata = _build_export_metadata(manifest, include_history)
        zf.writestr('metadata.json', json.dumps(metadata, ensure_ascii=False, indent=2))

        # 写入 README.md
        readme = _generate_readme(manifest)
        zf.writestr('README.md', readme)

        # 如果有 package_root，复制包文件
        if package_root and package_root.is_dir():
            _add_directory_to_zip(zf, package_root, '', exclude_patterns=['__pycache__', '*.pyc', '.git'])

        # 写入版本历史（可选）
        if include_history and history_records:
            zf.writestr('history.json', json.dumps(history_records, ensure_ascii=False, indent=2))

    zip_bytes = buf.getvalue()
    filename = f"{manifest.skill_id.replace('@', '_v').replace('.', '_')}.zip"

    return SkillExportPackage(
        skill_id=skill_id,
        filename=filename,
        zip_bytes=zip_bytes,
        metadata=metadata,
    )


def import_skill_package(
    zip_bytes: bytes,
    validate_compatibility: bool = True,
) -> SkillImportResult:
    """从标准 zip 格式导入 Skill 包。

    Args:
        zip_bytes: zip 文件内容。
        validate_compatibility: 是否校验兼容性。

    Returns:
        SkillImportResult 对象。

    Raises:
        ValueError: 包格式不合法或兼容性校验失败。
    """
    warnings: list[str] = []

    with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
        # 校验必需文件
        names = zf.namelist()

        # 读取 skill.yaml
        if 'skill.yaml' not in names and 'skill.yml' not in names:
            raise ValueError("缺少 skill.yaml 文件。")
        yaml_name = 'skill.yaml' if 'skill.yaml' in names else 'skill.yml'
        skill_yaml_content = zf.read(yaml_name).decode('utf-8')

        # 解析 manifest
        import yaml
        manifest_dict = yaml.safe_load(skill_yaml_content)
        if not isinstance(manifest_dict, dict):
            raise ValueError("skill.yaml 格式不合法。")

        # 读取 metadata.json（可选）
        metadata: dict[str, Any] = {}
        if 'metadata.json' in names:
            try:
                metadata = json.loads(zf.read('metadata.json'))
            except json.JSONDecodeError:
                warnings.append("metadata.json 格式不合法，已忽略。")

        # 校验 schema 版本兼容性
        if validate_compatibility:
            schema_version = metadata.get('schema_version', 1)
            if schema_version > CURRENT_SCHEMA_VERSION:
                raise ValueError(
                    f"Skill 包 schema 版本 {schema_version} 高于当前支持的版本 {CURRENT_SCHEMA_VERSION}，"
                    "请升级 AegisQA 后再导入。"
                )
            if schema_version < CURRENT_SCHEMA_VERSION:
                warnings.append(f"Skill 包 schema 版本 {schema_version} 较旧，已自动适配。")

        # 检查是否有执行文件
        has_handler = any(n.endswith('handler.py') for n in names)
        has_skill_md = 'SKILL.md' in names
        if not has_handler and not has_skill_md:
            warnings.append("未发现 handler.py 或 SKILL.md，Skill 可能无法执行。")

        # 提取 manifest 字段
        skill_id = manifest_dict.get('skill_id', 'unknown@0.1.0')
        if '@' not in skill_id:
            warnings.append(f"skill_id '{skill_id}' 缺少版本号后缀，已自动添加 @0.1.0。")
            skill_id = f"{skill_id}@0.1.0"

    return SkillImportResult(
        skill_id=skill_id,
        filename=f"{skill_id.replace('@', '_v').replace('.', '_')}.zip",
        manifest=manifest_dict,
        metadata=metadata,
        warnings=warnings,
    )


def extract_zip_to_directory(zip_bytes: bytes, target_dir: Path) -> None:
    """将 zip 内容解压到目标目录。

    Args:
        zip_bytes: zip 文件内容。
        target_dir: 目标目录。
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
        zf.extractall(target_dir)


def _manifest_to_yaml(manifest: SkillManifest) -> str:
    """将 SkillManifest 转换为 YAML 字符串。"""
    import yaml
    data = manifest.model_dump(exclude_none=True)
    return yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _build_export_metadata(manifest: SkillManifest, include_history: bool) -> dict[str, Any]:
    """构建导出元数据。"""
    return {
        'schema_version': CURRENT_SCHEMA_VERSION,
        'exported_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'exported_by': 'aegisqa',
        'skill_id': manifest.skill_id,
        'name': manifest.name,
        'version': manifest.version,
        'author': manifest.author,
        'tags': manifest.tags or [],
        'scenarios': manifest.scenarios or [],
        'permissions': manifest.permissions or [],
        'has_config_schema': manifest.config_schema is not None,
        'has_input_schema': manifest.input_schema is not None,
        'has_output_schema': manifest.output_schema is not None,
        'include_history': include_history,
        'compatibility': {
            'python': '>=3.10',
            'aegisqa': '>=0.1.0',
        },
    }


def _generate_readme(manifest: SkillManifest) -> str:
    """生成 README.md 内容。"""
    lines = [
        f"# {manifest.name}",
        '',
        f"**Skill ID**: `{manifest.skill_id}`",
        f"**Version**: {manifest.version}",
        f"**Author**: {manifest.author}",
        '',
    ]

    if manifest.description:
        lines.extend(['## 描述', '', manifest.description, ''])

    if manifest.tags:
        lines.extend(['## 标签', '', ', '.join(f'`{t}`' for t in manifest.tags), ''])

    if manifest.scenarios:
        lines.extend(['## 适用场景', '', *[f'- {s}' for s in manifest.scenarios], ''])

    if manifest.permissions:
        lines.extend(['## 所需权限', '', *[f'- `{p}`' for p in manifest.permissions], ''])

    if manifest.input_schema:
        lines.extend(['## 输入 Schema', '', '```json', json.dumps(manifest.input_schema, ensure_ascii=False, indent=2), '```', ''])

    if manifest.output_schema:
        lines.extend(['## 输出 Schema', '', '```json', json.dumps(manifest.output_schema, ensure_ascii=False, indent=2), '```', ''])

    if manifest.config_schema:
        lines.extend(['## 配置 Schema', '', '```json', json.dumps(manifest.config_schema, ensure_ascii=False, indent=2), '```', ''])

    lines.extend([
        '---',
        '',
        f'*由 AegisQA v{CURRENT_SCHEMA_VERSION} 导出*',
    ])

    return '\n'.join(lines)


def _add_directory_to_zip(zf: zipfile.ZipFile, source_dir: Path, prefix: str, exclude_patterns: list[str] | None = None) -> None:
    """将目录内容添加到 zip 文件。"""
    import fnmatch
    exclude_patterns = exclude_patterns or []

    for item in source_dir.rglob('*'):
        if item.is_dir():
            continue

        # 检查排除模式
        rel_path = item.relative_to(source_dir)
        rel_str = str(rel_path)
        if any(fnmatch.fnmatch(rel_str, p) or fnmatch.fnmatch(item.name, p) for p in exclude_patterns):
            continue

        arcname = f"{prefix}/{rel_str}" if prefix else rel_str
        zf.write(item, arcname)
