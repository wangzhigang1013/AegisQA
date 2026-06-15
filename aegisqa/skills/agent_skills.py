"""Agent 风格 `SKILL.md` 的安全模式适配。

本模块把 Codex/Agent 生态里的说明型 Skill 转换成 AegisQA Workflow 可引用的
Skill。第一版只做安全模式：读取 `SKILL.md` 和同目录 references 文档，通过统一
模型网关生成结果，不执行脚本、不运行命令、不访问网络。
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

import yaml

from aegisqa.core.errors import AegisQAError
from aegisqa.models.gateway import ModelGateway, model_response_usage_metrics
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.registry import SkillRegistry


AGENT_SKILL_ROOTS_ENV = "AEGISQA_AGENT_SKILL_ROOTS"
AGENT_SKILL_RUNTIME_MODE = "safe_model"
DEFAULT_REFERENCE_CHAR_LIMIT = 6000
MAX_REFERENCE_CHAR_LIMIT = 30000


@dataclass(slots=True)
class DiscoveredAgentSkill:
    """一次目录扫描发现的 Agent Skill。"""

    name: str
    description: str
    source_dir: Path
    skill_md_path: Path
    source_root: Path
    skill_id_candidate: str

    def to_payload(self, *, already_imported: bool = False) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "source_dir": str(self.source_dir),
            "skill_md_path": str(self.skill_md_path),
            "source_root": str(self.source_root),
            "skill_id_candidate": self.skill_id_candidate,
            "runtime_mode": AGENT_SKILL_RUNTIME_MODE,
            "already_imported": already_imported,
        }


class AgentInstructionSkill(BaseSkill):
    """把说明型 Agent Skill 包装成 AegisQA 可执行 Skill。"""

    def __init__(self, manifest: SkillManifest, source_dir: Path) -> None:
        self.manifest = manifest
        self.source_dir = source_dir.resolve()
        super().__init__()

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        config = config or {}
        max_reference_chars = _bounded_int(config.get("max_reference_chars"), DEFAULT_REFERENCE_CHAR_LIMIT, MAX_REFERENCE_CHAR_LIMIT)
        skill_md = _read_skill_md(self.source_dir)
        references = _read_reference_bundle(self.source_dir, max_chars=max_reference_chars)
        task_payload = {
            "task": inputs.get("task", ""),
            "row": inputs.get("row", {}),
            "context": inputs.get("context", {}),
            "extra": {key: value for key, value in inputs.items() if key not in {"task", "row", "context"}},
        }
        messages = [
            {
                "role": "system",
                "content": (
                    "你正在以 AegisQA 安全模式执行一个 Agent Skill。"
                    "只能根据 SKILL.md、references 和输入数据生成结果；不要假设可以运行本地脚本、命令或网络请求。"
                    "请输出适合下游 Workflow 继续消费的简洁中文结果。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"## SKILL.md\n{skill_md}\n\n"
                    f"## references\n{references or '无'}\n\n"
                    f"## 输入\n{yaml.safe_dump(task_payload, allow_unicode=True, sort_keys=False)}"
                ),
            },
        ]
        response = ModelGateway.from_env(connection_id=config.get("model_connection_id")).generate(
            messages=messages,
            model=config.get("model"),
            temperature=config.get("temperature"),
            max_tokens=config.get("max_tokens"),
        )
        metrics = model_response_usage_metrics(response, connection_id=config.get("model_connection_id"))
        metrics["latency_ms"] = response.latency_ms
        # answer/text 两个字段保持同值：answer 更符合评测语义，text 更方便和模型节点互通。
        return SkillResult(
            output={
                "answer": response.text,
                "text": response.text,
                "skill_id": self.manifest.skill_id,
                "runtime_mode": AGENT_SKILL_RUNTIME_MODE,
            },
            metrics=metrics,
            artifacts={"model": response.model, "provider": response.provider, "usage": response.usage},
            logs=["Agent Skill 安全模式：已读取 SKILL.md/references，未执行本机脚本或命令。"],
        )


def configured_agent_skill_roots(project_root: Path | None = None) -> list[Path]:
    """返回允许扫描和导入的 Agent Skill 根目录。"""

    raw = os.getenv(AGENT_SKILL_ROOTS_ENV)
    if raw:
        return [_normalise_path(item) for item in raw.split(os.pathsep) if item.strip()]
    home = Path.home()
    root = project_root or Path.cwd()
    return [
        home / ".codex" / "skills",
        home / ".agents" / "skills",
        root / "skills",
    ]


def discover_agent_skills(roots: list[Path] | None = None, *, imported_source_dirs: set[str] | None = None) -> list[dict[str, Any]]:
    """扫描允许根目录下的 `SKILL.md`，返回前端可展示的候选列表。"""

    imported_source_dirs = imported_source_dirs or set()
    discovered: list[DiscoveredAgentSkill] = []
    for root in roots or configured_agent_skill_roots():
        root = _normalise_path(root)
        if not root.exists():
            continue
        for skill_md in sorted(root.rglob("SKILL.md")):
            source_dir = skill_md.parent.resolve()
            metadata, body = _parse_skill_markdown(skill_md.read_text(encoding="utf-8"))
            name = str(metadata.get("name") or source_dir.name)
            description = str(metadata.get("description") or _first_paragraph(body) or f"Agent Skill：{name}")
            discovered.append(
                DiscoveredAgentSkill(
                    name=name,
                    description=description,
                    source_dir=source_dir,
                    skill_md_path=skill_md.resolve(),
                    source_root=root.resolve(),
                    skill_id_candidate=_agent_skill_id(name, source_dir),
                )
            )
    return [
        item.to_payload(already_imported=str(item.source_dir) in imported_source_dirs)
        for item in sorted(discovered, key=lambda value: (value.name.lower(), str(value.source_dir)))
    ]


def import_agent_skill(
    store: Any,
    registry: SkillRegistry,
    *,
    source_dir: str | Path,
    skill_id: str | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    """把一个 `SKILL.md` 目录导入为待审批的 AegisQA Skill。"""

    source_path = _ensure_allowed_agent_skill_dir(Path(source_dir), configured_agent_skill_roots())
    skill_md_path = source_path / "SKILL.md"
    metadata, body = _parse_skill_markdown(skill_md_path.read_text(encoding="utf-8"))
    display_name = name or str(metadata.get("name") or source_path.name)
    description = str(metadata.get("description") or _first_paragraph(body) or f"Agent Skill：{display_name}")
    manifest = _build_manifest(
        skill_id=skill_id or _agent_skill_id(display_name, source_path),
        name=display_name,
        description=description,
        metadata=metadata,
    )
    registry.register(AgentInstructionSkill(manifest, source_path))
    existing = find_agent_skill_record(store, manifest.skill_id)
    record = {
        "agent_skill_id": existing.get("agent_skill_id") if existing else f"agent-{uuid4().hex[:12]}",
        "source_dir": str(source_path),
        "skill_md_path": str(skill_md_path.resolve()),
        "runtime_mode": AGENT_SKILL_RUNTIME_MODE,
        "status": manifest.status,
        "manifest": manifest.model_dump(mode="json"),
        "last_contract_ok": existing.get("last_contract_ok", False) if existing else False,
        "last_contract_result": existing.get("last_contract_result") if existing else None,
        "last_contract_at": existing.get("last_contract_at") if existing else None,
        "approved_by": existing.get("approved_by") if existing else None,
        "approved_at": existing.get("approved_at") if existing else None,
        "approval_note": existing.get("approval_note") if existing else None,
        "created_at": existing.get("created_at") if existing else _now(),
        "updated_at": _now(),
    }
    _save_record(store, "agent_skills", "agent_skill_id", record)
    return record


def load_agent_skills_from_store(store: Any, registry: SkillRegistry) -> None:
    """应用启动时从持久化记录恢复 Agent Skill 注册表。"""

    for record in _list_records(store, "agent_skills"):
        source_dir = Path(str(record.get("source_dir", "")))
        if not (source_dir / "SKILL.md").exists():
            continue
        manifest = SkillManifest(**record["manifest"])
        registry.register(AgentInstructionSkill(manifest, source_dir))


def imported_agent_skill_source_dirs(store: Any) -> set[str]:
    return {str(Path(record.get("source_dir", "")).resolve()) for record in _list_records(store, "agent_skills") if record.get("source_dir")}


def agent_skill_ids_from_store(store: Any) -> set[str]:
    return {
        str(record.get("manifest", {}).get("skill_id"))
        for record in _list_records(store, "agent_skills")
        if record.get("manifest", {}).get("skill_id")
    }


def find_agent_skill_record(store: Any, skill_id: str) -> dict[str, Any] | None:
    for record in _list_records(store, "agent_skills"):
        if record.get("manifest", {}).get("skill_id") == skill_id:
            return record
    return None


def update_agent_skill_contract_result(store: Any, skill_id: str, result: dict[str, Any]) -> None:
    record = find_agent_skill_record(store, skill_id)
    if not record:
        return
    record["last_contract_ok"] = bool(result.get("ok"))
    record["last_contract_result"] = result
    record["last_contract_at"] = _now()
    record["updated_at"] = _now()
    _save_record(store, "agent_skills", "agent_skill_id", record)


def update_agent_skill_status(store: Any, manifest: SkillManifest) -> None:
    record = find_agent_skill_record(store, manifest.skill_id)
    if not record:
        return
    record["status"] = manifest.status
    record["manifest"] = manifest.model_dump(mode="json")
    record["updated_at"] = _now()
    _save_record(store, "agent_skills", "agent_skill_id", record)


def mark_agent_skill_approved(store: Any, skill_id: str, approval_note: str) -> None:
    record = find_agent_skill_record(store, skill_id)
    if not record:
        return
    record["approved_by"] = "api"
    record["approved_at"] = _now()
    record["approval_note"] = approval_note
    record["updated_at"] = _now()
    _save_record(store, "agent_skills", "agent_skill_id", record)


def _build_manifest(*, skill_id: str, name: str, description: str, metadata: dict[str, Any]) -> SkillManifest:
    tags = ["agent-skill", "safe-model", *_metadata_string_list(metadata.get("tags"))]
    return SkillManifest(
        skill_id=skill_id,
        name=name,
        version=str(metadata.get("version") or "0.1.0"),
        description=description,
        author=str(metadata.get("author") or "Agent Skill"),
        tags=tags,
        scenarios=_metadata_string_list(metadata.get("scenarios")) or ["agent-workflow"],
        input_schema={
            "type": "object",
            "required": ["task"],
            "properties": {
                "task": {"type": "string", "description": "本次样本要交给 Agent Skill 处理的问题或任务。"},
                "row": {"type": "object", "description": "可选：完整数据集行。"},
                "context": {"type": "object", "description": "可选：上游节点输出和任务上下文。"},
            },
        },
        output_schema={
            "type": "object",
            "required": ["answer", "text"],
            "properties": {
                "answer": {"type": "string", "description": "Agent Skill 生成的主要结果。"},
                "text": {"type": "string", "description": "与 answer 同值，便于和通用模型节点互通。"},
                "skill_id": {"type": "string"},
                "runtime_mode": {"type": "string"},
            },
        },
        config_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string", "description": "可选：覆盖模型网关默认模型。"},
                "temperature": {"type": "number", "description": "可选：模型采样温度。"},
                "max_tokens": {"type": "integer", "description": "可选：模型最大输出 token。"},
                "max_reference_chars": {"type": "integer", "default": DEFAULT_REFERENCE_CHAR_LIMIT, "description": "最多读取 references 的字符数。"},
            },
        },
        cacheable=False,
        permissions=["model:call", "filesystem:skill_dir_read"],
        enabled=False,
        status="pending_review",
        governance_note="Agent Skill 安全模式导入，需合约测试通过并审批后才能用于 Workflow。",
        example_input={"task": f"请用一句话说明 {name} 这个 Skill 的用途。"},
        example_config={},
    )


def _ensure_allowed_agent_skill_dir(source_dir: Path, roots: list[Path]) -> Path:
    source_dir = source_dir.resolve()
    if not (source_dir / "SKILL.md").exists():
        raise AegisQAError("AGENT_SKILL_NOT_FOUND", "目录中没有 SKILL.md。", details={"source_dir": str(source_dir)})
    allowed_roots = [_normalise_path(root).resolve() for root in roots]
    if not any(source_dir == root or root in source_dir.parents for root in allowed_roots):
        raise AegisQAError(
            "AGENT_SKILL_SOURCE_NOT_ALLOWED",
            "Agent Skill 只能从已配置的安全根目录导入。",
            details={"source_dir": str(source_dir), "allowed_roots": [str(root) for root in allowed_roots]},
        )
    return source_dir


def _read_skill_md(source_dir: Path) -> str:
    return (source_dir / "SKILL.md").read_text(encoding="utf-8")


def _read_reference_bundle(source_dir: Path, *, max_chars: int) -> str:
    references_dir = source_dir / "references"
    if not references_dir.exists():
        return ""
    chunks: list[str] = []
    remaining = max_chars
    for path in sorted(references_dir.rglob("*")):
        if remaining <= 0:
            break
        if not path.is_file() or path.suffix.lower() not in {".md", ".txt", ".json", ".yaml", ".yml"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        text = text[:remaining]
        remaining -= len(text)
        chunks.append(f"### {path.relative_to(source_dir).as_posix()}\n{text}")
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


def _agent_skill_id(name: str, source_dir: Path) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name.strip().lower()).strip("-") or source_dir.name.lower()
    digest = hashlib.sha1(str(source_dir.resolve()).encode("utf-8")).hexdigest()[:6]
    return f"agent.{slug}@0.1.0-{digest}"


def _bounded_int(value: Any, default: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(0, min(parsed, maximum))


def _metadata_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (str, int, float)):
        return [str(value)]
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, (str, int, float))]


def _normalise_path(value: str | Path) -> Path:
    return Path(str(value)).expanduser().resolve()


def _save_record(store: Any, collection: str, id_key: str, record: dict[str, Any]) -> None:
    store.write_json([collection, f"{record[id_key]}.json"], record)


def _list_records(store: Any, collection: str) -> list[dict[str, Any]]:
    return store.list_json([collection])


def _now() -> str:
    from aegisqa.core.time import now_beijing_iso
    return now_beijing_str()
