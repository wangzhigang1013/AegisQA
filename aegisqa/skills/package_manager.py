"""Skill 包生命周期管理。

从 api/app.py 提取的 Skill 包安装、安全扫描、冲突处理、合约记录等核心逻辑。
"""

from __future__ import annotations

import base64
import logging
import re
import zipfile
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

import yaml

from aegisqa.core.errors import AegisQAError
from aegisqa.core.time import now_beijing_str
from aegisqa.skills.base import SkillManifest
from aegisqa.skills.packages import (
    InstructionPackageSkill,
    SubprocessPackageSkill,
    build_instruction_manifest_from_skill_md,
    resolve_package_entrypoint,
)
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.artifacts import ArtifactStore
from aegisqa.storage.json_store import JsonStore
from aegisqa.storage.repositories import RepositoryRegistry

logger = logging.getLogger("aegisqa.skills.package_manager")

# ── 常量 ──────────────────────────────────────────────────────

MAX_SKILL_PACKAGE_FILES = 200
MAX_SKILL_PACKAGE_FILE_BYTES = 1_000_000
MAX_SKILL_PACKAGE_TOTAL_BYTES = 1_500_000
SKILL_PACKAGE_DEPENDENCY_FILES = {"requirements.txt", "pyproject.toml"}
SKILL_PACKAGE_EXECUTABLE_SUFFIXES = {".bat", ".bin", ".cmd", ".dll", ".dylib", ".exe", ".sh", ".so"}
SKILL_PACKAGE_TEXT_SUFFIXES = {".json", ".md", ".py", ".txt", ".yaml", ".yml"}
SKILL_PACKAGE_DIRECT_MODEL_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bimport\s+(openai|anthropic|cohere|boto3)\b",
        r"\bfrom\s+(openai|anthropic|cohere|boto3)\s+import\b",
        r"\bimport\s+google\.generativeai\b",
        r"\b(OpenAI|Anthropic)\s*\(",
    )
]
SKILL_PACKAGE_API_KEY_PATTERN = re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{12,}")

# 网络外传模式
SKILL_PACKAGE_NETWORK_EXFIL_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\brequests\.(post|put|patch)\s*\(",
        r"\burllib\.(request|urlopen)\s*\(",
        r"\bhttpx\.(post|put|patch)\s*\(",
        r"\bhttp\.client\.HTTP(S)?Connection\s*\(",
        r"\bsocket\.(socket|create_connection)\s*\(",
        r"\bftplib\.FTP\s*\(",
        r"\bsmtplib\.SMTP\s*\(",
    )
]

# Shell 注入模式
SKILL_PACKAGE_SHELL_INJECTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bos\.(system|popen|exec|execl|execle|execlp|execv|execve|execvp)\s*\(",
        r"\bsubprocess\.(run|call|check_call|check_output|Popen)\s*\(",
        r"\bcommands\.(getoutput|getstatusoutput)\s*\(",
        r"\bshell=True\b",
        r"\bos\.exec\s*\(",
    )
]

# 文件系统访问模式
SKILL_PACKAGE_FILE_ACCESS_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bopen\s*\([^)]*['\"](/|\\\\)",
        r"\bpathlib\.Path\s*\([^)]*['\"](/|\\\\)",
        r"\bos\.(chdir|chroot|mkdir|makedirs|remove|unlink|rmdir|rename)\s*\(",
        r"\bshutil\.(copy|move|rmtree)\s*\(",
        r"\bglob\.glob\s*\([^)]*['\"](/|\\\\)",
    )
]

# 高风险模式 — 直接阻断上传
_SKILL_PACKAGE_BLOCK_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"""(?:api[_-]?key|secret|token)\s*=\s*['"][A-Za-z0-9_\-]{20,}['"]""", re.IGNORECASE), "SKILL_PACKAGE_HARDCODED_SECRET_BLOCK", "插件包含硬编码密钥，禁止上传。请改用平台 secret_ref 或环境变量。"),
    (re.compile(r"""subprocess\.(?:call|run|Popen|check_output|check_call)\s*\(.*shell\s*=\s*True""", re.DOTALL), "SKILL_PACKAGE_SHELL_INJECTION_BLOCK", "插件包含 shell=True 的 subprocess 调用，存在命令注入风险。请改用 shell=False + 列表参数。"),
    (re.compile(r"""\bos\.(?:system|popen)\s*\(""", re.IGNORECASE), "SKILL_PACKAGE_OS_SYSTEM_BLOCK", "插件包含 os.system/os.popen 调用，存在命令注入风险。请改用 subprocess.run。"),
]

# Skill 包生命周期状态的合法枚举
VALID_SKILL_PACKAGE_STATUSES: frozenset[str] = frozenset(
    {"pending_review", "approved", "deprecated", "replaced", "rejected", "draft"}
)


# ── 状态校验 ──────────────────────────────────────────────────

def validate_skill_package_status(status: str) -> str:
    """校验并返回合法 status；非法值记录日志后回退到 pending_review。"""
    if status in VALID_SKILL_PACKAGE_STATUSES:
        return status
    logger.warning("invalid skill_package status=%r fallback=pending_review", status)
    return "pending_review"


def _now() -> str:
    return now_beijing_str()


# ── 文件名安全 ────────────────────────────────────────────────

def safe_skill_package_filename(filename: str) -> str:
    candidate = PurePosixPath(str(filename or "").replace("\\", "/")).name.strip()
    if not candidate or candidate in {".", ".."}:
        return "package.zip"
    return candidate


# ── ZIP 安全解压 ──────────────────────────────────────────────

def safe_extract_zip(archive: zipfile.ZipFile, destination: Path) -> dict[str, Any]:
    destination = destination.resolve()
    file_count = 0
    total_size = 0
    max_file_size = 0
    warnings: list[dict[str, Any]] = []
    for member in archive.infolist():
        filename = member.filename.replace("\\", "/")
        parts = PurePosixPath(filename).parts
        if filename.startswith("/") or re.match(r"^[a-zA-Z]:", filename) or ".." in parts:
            raise AegisQAError(
                "SKILL_PACKAGE_INVALID_PATH",
                "插件包包含非法路径，禁止绝对路径或跨目录文件。",
                details={"filename": member.filename},
            )
        if member.is_dir():
            continue
        file_count += 1
        if file_count > MAX_SKILL_PACKAGE_FILES:
            raise AegisQAError(
                "SKILL_PACKAGE_TOO_MANY_FILES",
                "插件包文件数量超过安全限制。",
                details={"file_count": file_count, "max_files": MAX_SKILL_PACKAGE_FILES},
            )
        max_file_size = max(max_file_size, member.file_size)
        if member.file_size > MAX_SKILL_PACKAGE_FILE_BYTES:
            raise AegisQAError(
                "SKILL_PACKAGE_FILE_TOO_LARGE",
                "插件包内单个文件超过安全限制。",
                details={
                    "filename": member.filename,
                    "file_size_bytes": member.file_size,
                    "max_file_size_bytes": MAX_SKILL_PACKAGE_FILE_BYTES,
                },
            )
        total_size += member.file_size
        if total_size > MAX_SKILL_PACKAGE_TOTAL_BYTES:
            raise AegisQAError(
                "SKILL_PACKAGE_TOO_LARGE",
                "插件包解压后的总大小超过安全限制。",
                details={"total_size_bytes": total_size, "max_total_size_bytes": MAX_SKILL_PACKAGE_TOTAL_BYTES},
            )
        member_payload = archive.read(member)
        block_reason = skill_package_security_block(filename, member, member_payload)
        if block_reason:
            raise AegisQAError(
                "SKILL_PACKAGE_SECURITY_BLOCK",
                block_reason,
                status_code=400,
                details={"filename": filename},
            )
        warnings.extend(skill_package_member_warnings(filename, member, member_payload))
        target = (destination / member.filename).resolve()
        if destination not in target.parents and target != destination:
            raise AegisQAError(
                "SKILL_PACKAGE_INVALID_PATH",
                "插件包包含非法路径，禁止绝对路径或跨目录文件。",
                details={"filename": member.filename},
            )
    archive.extractall(destination)
    return {
        "file_count": file_count,
        "total_size_bytes": total_size,
        "max_file_size_bytes": max_file_size,
        "warnings": warnings,
        "limits": {
            "max_files": MAX_SKILL_PACKAGE_FILES,
            "max_file_size_bytes": MAX_SKILL_PACKAGE_FILE_BYTES,
            "max_total_size_bytes": MAX_SKILL_PACKAGE_TOTAL_BYTES,
        },
    }


def skill_package_member_warnings(filename: str, member: zipfile.ZipInfo, payload: bytes) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    suffix = Path(filename).suffix.lower()
    executable_bits = (member.external_attr >> 16) & 0o111
    if suffix in SKILL_PACKAGE_EXECUTABLE_SUFFIXES or executable_bits:
        warnings.append(
            {
                "code": "SKILL_PACKAGE_EXECUTABLE_FILE_WARNING",
                "message": "插件包包含可执行或二进制文件，审批时需要确认其必要性。",
                "filename": filename,
            }
        )
    elif b"\x00" in payload[:4096]:
        warnings.append(
            {
                "code": "SKILL_PACKAGE_BINARY_FILE_WARNING",
                "message": "插件包包含二进制内容，审批时需要确认来源和用途。",
                "filename": filename,
            }
        )
    text = _decode_skill_package_text(filename, payload)
    if text is None:
        return warnings
    if any(pattern.search(text) for pattern in SKILL_PACKAGE_DIRECT_MODEL_PATTERNS):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_DIRECT_MODEL_SDK_WARNING",
                "message": "插件包源码疑似直接调用模型 SDK，应改用平台模型网关和 model alias。",
                "filename": filename,
            }
        )
    if SKILL_PACKAGE_API_KEY_PATTERN.search(text):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_API_KEY_WARNING",
                "message": "插件包疑似包含硬编码 API key，审批前必须移除或改用平台 secret_ref。",
                "filename": filename,
            }
        )
    if any(pattern.search(text) for pattern in SKILL_PACKAGE_NETWORK_EXFIL_PATTERNS):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_NETWORK_EXFIL_WARNING",
                "message": "插件包源码疑似包含网络外传代码（HTTP 请求、Socket 连接等），审批时需要确认其必要性和目标地址。",
                "filename": filename,
            }
        )
    if any(pattern.search(text) for pattern in SKILL_PACKAGE_SHELL_INJECTION_PATTERNS):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_SHELL_INJECTION_WARNING",
                "message": "插件包源码疑似包含 Shell 注入代码（subprocess、os.system 等），审批时需要确认其必要性和安全性。",
                "filename": filename,
            }
        )
    if any(pattern.search(text) for pattern in SKILL_PACKAGE_FILE_ACCESS_PATTERNS):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_FILE_ACCESS_WARNING",
                "message": "插件包源码疑似访问受限文件路径（绝对路径、系统目录等），审批时需要确认其必要性和权限范围。",
                "filename": filename,
            }
        )
    return warnings


def skill_package_security_block(filename: str, member: zipfile.ZipInfo, payload: bytes) -> str | None:
    """检查高风险安全模式，返回错误信息或 None。"""
    text = _decode_skill_package_text(filename, payload)
    if text is None:
        return None
    for pattern, code, message in _SKILL_PACKAGE_BLOCK_PATTERNS:
        if pattern.search(text):
            return f"[{code}] {message} (文件: {filename})"
    return None


def _decode_skill_package_text(filename: str, payload: bytes) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix not in SKILL_PACKAGE_TEXT_SUFFIXES:
        return None
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return None


def reject_unsupported_skill_package_dependencies(package_dir: Path, runtime_payload: dict[str, Any]) -> list[dict[str, Any]]:
    """检查依赖声明，返回警告列表而非阻断上传。"""
    warnings: list[dict[str, Any]] = []
    dependencies = runtime_payload.get("dependencies")
    if dependencies:
        warnings.append({
            "code": "SKILL_PACKAGE_DEPENDENCIES_WARNING",
            "message": f"插件声明了 {len(dependencies)} 个第三方依赖，本地运行时不会自动安装，请确保运行环境已包含这些依赖。",
            "details": {"dependencies": list(dependencies.keys()) if isinstance(dependencies, dict) else dependencies},
        })
    dependency_files = sorted(name for name in SKILL_PACKAGE_DEPENDENCY_FILES if (package_dir / name).exists())
    if dependency_files:
        warnings.append({
            "code": "SKILL_PACKAGE_DEPENDENCY_FILES_WARNING",
            "message": f"插件包含依赖声明文件 ({', '.join(dependency_files)})，本地运行时不会自动安装依赖。",
            "details": {"files": dependency_files},
        })
    return warnings


# ── 包内容检测 ────────────────────────────────────────────────

def first_existing(root: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = root / name
        if candidate.exists():
            return candidate
    return None


def detect_package_content_root(extraction_root: Path) -> Path:
    """兼容 zip 包外层多包了一层目录的常见情况。"""
    if any((extraction_root / name).exists() for name in ["SKILL.md", "skill.yaml", "skill.yml", "skill.json", "handler.py", "scripts"]):
        return extraction_root
    children = list(extraction_root.iterdir())
    directories = [item for item in children if item.is_dir()]
    files = [item for item in children if item.is_file()]
    if len(directories) == 1 and not files:
        return directories[0]
    return extraction_root


def resolve_skill_package_runtime_mode(runtime_payload: dict[str, Any], package_dir: Path) -> str:
    """根据 manifest.runtime 和包内容推断 Skill 包执行模式。"""
    raw_mode = str(runtime_payload.get("mode") or "").strip().lower()
    aliases = {
        "python": "script",
        "subprocess": "script",
        "safe_model": "instruction_model",
        "model": "instruction_model",
        "instructions": "instruction_model",
    }
    if raw_mode:
        return aliases.get(raw_mode, raw_mode)
    if (package_dir / "handler.py").exists():
        return "script"
    if (package_dir / "SKILL.md").exists():
        return "instruction_model"
    return "script"


# ── 版本管理 ──────────────────────────────────────────────────

def skill_base_id(skill_id: str) -> str:
    return skill_id.rsplit("@", 1)[0] if "@" in skill_id else skill_id


def skill_version_label(manifest: SkillManifest) -> str:
    if manifest.version:
        return manifest.version
    return manifest.skill_id.rsplit("@", 1)[1] if "@" in manifest.skill_id else "unversioned"


def find_max_version(records: list[dict[str, Any]]) -> str:
    """从现有记录中找到最大版本号。"""
    max_version = "0.0.0"
    for record in records:
        manifest = record.get("manifest", {})
        version = str(manifest.get("version") or record.get("skill_version") or "0.0.0")
        if compare_versions(version, max_version) > 0:
            max_version = version
    return max_version


def increment_version(version: str) -> str:
    """递增版本号（语义化版本）。"""
    parts = version.split(".")
    if len(parts) < 3:
        parts.extend(["0"] * (3 - len(parts)))
    try:
        major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
        patch += 1
        return f"{major}.{minor}.{patch}"
    except (ValueError, IndexError):
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        return f"{version}.{timestamp}"


def compare_versions(v1: str, v2: str) -> int:
    """比较两个版本号。"""
    from packaging.version import InvalidVersion, Version
    try:
        parsed1 = Version(v1)
        parsed2 = Version(v2)
    except InvalidVersion:
        return (v1 > v2) - (v1 < v2)
    if parsed1 > parsed2:
        return 1
    if parsed1 < parsed2:
        return -1
    return 0


# ── 记录查找与更新 ────────────────────────────────────────────

def find_skill_package(store: JsonStore, skill_id: str) -> dict[str, Any] | None:
    """查找 skill_id 对应的活跃 package 记录。"""
    repositories = _repositories_for_store(store)
    skill_packages = repositories.skill_packages
    candidates = skill_packages.find_by_skill_id(skill_id)
    if not candidates:
        return None
    active = [record for record in candidates if record.get("status") != "replaced"]
    pool = active if active else candidates
    pool.sort(key=lambda record: str(record.get("updated_at") or ""), reverse=True)
    return pool[0]


def update_skill_package_status(store: JsonStore, manifest: SkillManifest) -> None:
    package = find_skill_package(store, manifest.skill_id)
    if not package:
        return
    package["status"] = validate_skill_package_status(manifest.status)
    package["manifest"] = manifest.model_dump(mode="json")
    package["updated_at"] = _now()
    written_updated_at = str(package["updated_at"])
    _save_record(store, "skill_packages", "package_id", package)
    ensure_no_concurrent_overwrite(store, manifest.skill_id, package.get("package_id"), written_updated_at)


def mark_skill_package_approved(store: JsonStore, skill_id: str, approval_note: str, *, actor: str = "api", role: str | None = None) -> None:
    package = find_skill_package(store, skill_id)
    if not package:
        return
    package["approved_by"] = actor
    if role:
        package["approved_by_role"] = role
    package["approved_at"] = _now()
    package["approval_note"] = approval_note
    append_skill_package_lifecycle_event(package, action="approve", actor=actor, role=role, reason=approval_note)
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)


def record_skill_package_contract_result(store: JsonStore, skill_id: str, result: dict[str, Any], *, actor: str = "api") -> dict[str, Any] | None:
    package = find_skill_package(store, skill_id)
    if not package:
        return None
    package["last_contract_ok"] = bool(result.get("ok"))
    package["last_contract_result"] = result
    package["last_contract_at"] = _now()
    history = package.setdefault("contract_history", [])
    if isinstance(history, list):
        history.append(
            {
                "ok": bool(result.get("ok")),
                "actor": actor,
                "created_at": package["last_contract_at"],
                "latency_ms": result.get("latency_ms"),
                "error": result.get("error"),
                "code": result.get("code"),
                "message": result.get("message"),
            }
        )
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)
    return package


def record_skill_package_lifecycle_event(
    store: JsonStore,
    skill_id: str,
    *,
    action: str,
    actor: str = "api",
    role: str | None = None,
    reason: str = "",
    target_skill_id: str | None = None,
) -> dict[str, Any] | None:
    package = find_skill_package(store, skill_id)
    if not package:
        return None
    append_skill_package_lifecycle_event(package, action=action, actor=actor, role=role, reason=reason, target_skill_id=target_skill_id)
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)
    return package


def append_skill_package_lifecycle_event(
    package: dict[str, Any],
    *,
    action: str,
    actor: str = "api",
    role: str | None = None,
    reason: str = "",
    target_skill_id: str | None = None,
) -> None:
    history = package.setdefault("approval_history", [])
    if not isinstance(history, list):
        package["approval_history"] = history = []
    event = {"action": action, "actor": actor, "reason": reason, "created_at": _now()}
    if role:
        event["role"] = role
    if target_skill_id:
        event["target_skill_id"] = target_skill_id
    history.append(event)


# ── 并发检测 ──────────────────────────────────────────────────

def ensure_no_concurrent_overwrite(
    store: JsonStore, skill_id: str, package_id: str | None, written_updated_at: str
) -> None:
    if package_id is None:
        return
    current = find_skill_package(store, skill_id)
    if not current:
        return
    if current.get("package_id") != package_id:
        return
    if str(current.get("updated_at", "")) != written_updated_at:
        logger.warning(
            "skill_package concurrent overwrite detected skill_id=%s package_id=%s",
            skill_id, package_id,
        )


# ── 包安装 ────────────────────────────────────────────────────

def install_skill_package(
    store: JsonStore,
    registry: SkillRegistry,
    artifact_store: ArtifactStore,
    filename: str,
    content_base64: str,
    conflict_strategy: str = "error",
    actor: str = "api",
    role: str = "Skill Developer",
) -> dict[str, Any]:
    """安装 Skill 包：解压、安全扫描、冲突处理、注册。"""
    try:
        raw = base64.b64decode(content_base64)
    except Exception as exc:
        raise AegisQAError("SKILL_PACKAGE_INVALID", "插件包内容不是合法 base64。") from exc

    package_id = f"pkg-{uuid4().hex[:12]}"
    package_filename = safe_skill_package_filename(filename)
    package_dir = store.path("uploaded_skill_packages", package_id, "package")
    package_dir.mkdir(parents=True, exist_ok=True)
    zip_path = store.path("uploaded_skill_packages", package_id, package_filename)
    zip_path.write_bytes(raw)

    try:
        with zipfile.ZipFile(zip_path) as archive:
            package_security = safe_extract_zip(archive, package_dir)
    except zipfile.BadZipFile as exc:
        raise AegisQAError("SKILL_PACKAGE_INVALID", "插件包必须是合法 zip 文件。") from exc

    warnings: list[dict[str, Any]] = list(package_security.get("warnings", []))

    package_dir = detect_package_content_root(package_dir)
    manifest_path = first_existing(package_dir, ["skill.yaml", "skill.yml", "skill.json"])
    skill_md_path = package_dir / "SKILL.md"
    handler_path = package_dir / "handler.py"
    if not manifest_path:
        if handler_path.exists() or (package_dir / "scripts").exists():
            raise AegisQAError(
                "SKILL_PACKAGE_MANIFEST_MISSING",
                "纯参数或脚本型 Agent Skill 必须提供 skill.yaml 或 skill.json，用来声明输入、输出、配置和 runtime.entrypoint。",
            )
        if not skill_md_path.exists():
            raise AegisQAError("SKILL_PACKAGE_MANIFEST_MISSING", "插件包缺少 skill.yaml、skill.json 或 SKILL.md。")
        manifest = build_instruction_manifest_from_skill_md(package_dir)
        runtime_payload: dict[str, Any] = {"mode": "instruction_model"}
    else:
        manifest_payload = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
        if not isinstance(manifest_payload, dict):
            raise AegisQAError("SKILL_PACKAGE_MANIFEST_INVALID", "skill.yaml 或 skill.json 必须是对象。")
        if "permissions" not in manifest_payload:
            raise AegisQAError(
                "SKILL_PACKAGE_PERMISSIONS_REQUIRED",
                "脚本型或参数型 Agent Skill 必须在 manifest 中显式声明 permissions，空列表表示无需额外权限。",
            )
        runtime_payload = manifest_payload.pop("runtime", {}) or {}
        if not isinstance(runtime_payload, dict):
            raise AegisQAError("SKILL_PACKAGE_RUNTIME_INVALID", "runtime 必须是对象。")
        dep_warnings = reject_unsupported_skill_package_dependencies(package_dir, runtime_payload)
        warnings.extend(dep_warnings)
        manifest = SkillManifest(**manifest_payload)

        if manifest_payload.get("openai_tool") or manifest_payload.get("tool_type") == "openai":
            tool_name = manifest_payload.get("name", "")
            if tool_name and not runtime_payload.get("entrypoint"):
                runtime_payload["entrypoint"] = f"handler.py:{tool_name}"

    manifest.enabled = False
    manifest.status = "pending_review"

    # 冲突检测
    conflict_strategy = conflict_strategy or "error"
    existing_package = find_skill_package(store, manifest.skill_id)
    replaced_package: dict[str, Any] | None = None

    if existing_package:
        if conflict_strategy == "error":
            import shutil
            package_root = store.path("uploaded_skill_packages", package_id)
            shutil.rmtree(package_root, ignore_errors=True)
            raise AegisQAError(
                "SKILL_ALREADY_EXISTS",
                f"已存在同名 Skill：{manifest.skill_id}。请选择「替换」或「创建新版本」。",
                details={
                    "existing_skill_id": manifest.skill_id,
                    "existing_package_id": existing_package.get("package_id"),
                    "existing_status": existing_package.get("status"),
                    "conflict_strategy": conflict_strategy,
                },
            )
        elif conflict_strategy == "replace":
            replaced_package = existing_package
        elif conflict_strategy == "new_version":
            base_id = skill_base_id(manifest.skill_id)
            from aegisqa.api.app import _list_records
            existing_versions = [
                record for record in _list_records(store, "skill_packages")
                if skill_base_id(str(record.get("manifest", {}).get("skill_id", ""))) == base_id
            ]
            max_version = find_max_version(existing_versions)
            new_version = increment_version(max_version)
            manifest.skill_id = f"{base_id}@{new_version}"
            manifest.version = new_version
        else:
            raise AegisQAError(
                "INVALID_CONFLICT_STRATEGY",
                f"不支持的冲突处理策略：{conflict_strategy}。",
                details={"supported_strategies": ["error", "replace", "new_version"]},
            )

    runtime_mode = resolve_skill_package_runtime_mode(runtime_payload, package_dir)
    entrypoint: str | None = None
    handler_record_path: str | None = None
    if runtime_mode == "script":
        entrypoint_path, function_name, entrypoint = resolve_package_entrypoint(
            package_dir,
            str(runtime_payload.get("entrypoint") or "handler.py:run"),
        )
        if handler_path.exists() and entrypoint_path == handler_path.resolve():
            handler_record_path = str(handler_path.resolve())
        registry.register(SubprocessPackageSkill(manifest, entrypoint_path, package_root=package_dir, function_name=function_name))
    elif runtime_mode == "instruction_model":
        if not skill_md_path.exists():
            raise AegisQAError("SKILL_PACKAGE_SKILL_MD_MISSING", "说明型 Agent Skill 包缺少 SKILL.md。")
        registry.register(InstructionPackageSkill(manifest, package_dir, runtime_mode=runtime_mode))
    else:
        raise AegisQAError(
            "SKILL_PACKAGE_RUNTIME_UNSUPPORTED",
            f"不支持的 Skill 包运行模式：{runtime_mode}",
            details={"supported": ["script", "instruction_model"]},
        )
    artifact = artifact_store.put_bytes(
        "skill_packages",
        f"packages/{package_id}/{package_filename}",
        raw,
        content_type="application/zip",
        metadata={
            "package_id": package_id,
            "filename": package_filename,
            "original_filename": filename,
            "skill_id": manifest.skill_id,
            "runtime_mode": runtime_mode,
        },
    )
    record = {
        "package_id": package_id,
        "filename": package_filename,
        "original_filename": filename,
        "status": manifest.status,
        "manifest": manifest.model_dump(mode="json"),
        "package_dir": str(package_dir),
        "handler_path": handler_record_path,
        "skill_md_path": str(skill_md_path.resolve()) if skill_md_path.exists() else None,
        "runtime_mode": runtime_mode,
        "entrypoint": entrypoint,
        "artifact": asdict(artifact),
        "package_security": {**package_security, "warnings": warnings},
        "base_skill_id": skill_base_id(manifest.skill_id),
        "skill_version": skill_version_label(manifest),
        "last_contract_ok": False,
        "last_contract_result": None,
        "last_contract_at": None,
        "contract_history": [],
        "approval_history": [],
        "approved_by": None,
        "approved_at": None,
        "approval_note": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _save_record(store, "skill_packages", "package_id", record)

    if replaced_package is not None:
        replaced_package["status"] = "replaced"
        replaced_package["replaced_at"] = _now()
        replaced_package["replaced_by"] = record["package_id"]
        _save_record(store, "skill_packages", "package_id", replaced_package)

        replaced_package_id = replaced_package.get("package_id")
        if replaced_package_id:
            import shutil
            replaced_package_root = store.path("uploaded_skill_packages", str(replaced_package_id))
            shutil.rmtree(replaced_package_root, ignore_errors=True)

    if replaced_package is not None:
        record["_replaced_package_id"] = replaced_package.get("package_id")

    return record


# ── 内部辅助 ──────────────────────────────────────────────────

def _save_record(store: JsonStore, collection: str, id_key: str, record: dict[str, Any]) -> None:
    _repositories_for_store(store).collection(collection, id_key).save(record)


def _repositories_for_store(store: JsonStore) -> RepositoryRegistry:
    repositories = getattr(store, "repositories", None)
    if repositories is None:
        repositories = RepositoryRegistry(store)
        setattr(store, "repositories", repositories)
    return repositories
