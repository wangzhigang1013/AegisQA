"""Workflow 管理服务。"""

from __future__ import annotations

import json
from uuid import uuid4

from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowVersion


class WorkflowService:
    """支持发布、复制、归档 Workflow。"""

    def __init__(self, store: JsonStore, registry: SkillRegistry) -> None:
        self.store = store
        self.registry = registry

    def publish(self, draft: WorkflowDraft) -> WorkflowVersion:
        for step in draft.steps:
            if not self.registry.can_reference_new_workflow(step.skill_ref):
                raise ValueError(f"Skill 不允许被新 Workflow 引用：{step.skill_ref}")
        version = draft.publish()
        self._save(version)
        return version

    def copy_workflow(self, version_id: str, *, name: str | None = None) -> WorkflowDraft:
        source = self.get(version_id)
        return WorkflowDraft(
            workflow_id=f"wf-{uuid4().hex[:12]}",
            name=name or f"{source.name}_copy",
            steps=source.steps,
            runtime=source.runtime,
        )

    def archive(self, version_id: str) -> WorkflowVersion:
        workflow = self.get(version_id)
        workflow.status = "archived"
        self._save(workflow)
        return workflow

    def get(self, version_id: str) -> WorkflowVersion:
        payload = self.store.read_json(["workflows", f"{_safe(version_id)}.json"])
        if not payload:
            raise KeyError(f"Workflow 不存在：{version_id}")
        return WorkflowVersion(**payload)

    def list_versions(self) -> list[WorkflowVersion]:
        """列出已发布 Workflow 版本，支撑前端下拉选择与执行中心创建 Run。"""

        root = self.store.root / "workflows"
        if not root.exists():
            return []
        workflows: list[WorkflowVersion] = []
        for path in sorted(root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            payload = json.loads(path.read_text(encoding="utf-8"))
            workflows.append(WorkflowVersion(**payload))
        return workflows

    def _save(self, workflow: WorkflowVersion) -> None:
        self.store.write_json(["workflows", f"{_safe(workflow.version_id)}.json"], workflow.model_dump(mode="json"))


def _safe(value: str) -> str:
    return value.replace(":", "_").replace("/", "_")
