"""Workflow 管理服务。"""

from __future__ import annotations
from typing import Any
from uuid import uuid4

from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowVersion
from aegisqa.workflows.validation import validate_workflow_step_contracts


class WorkflowService:
    """支持发布、复制、归档 Workflow。"""

    def __init__(self, store: JsonStore, registry: SkillRegistry, workflow_repository: Any | None = None) -> None:
        self.store = store
        self.registry = registry
        self.workflow_repository = workflow_repository

    def publish(self, draft: WorkflowDraft) -> WorkflowVersion:
        issues = validate_workflow_step_contracts(self.registry, draft.steps, include_skill_availability=True)
        if issues:
            first = issues[0]
            raise ValueError(str(first.get("message") or first.get("code") or "Workflow Step 合约校验失败"))
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
        if self.workflow_repository:
            try:
                payload = self.workflow_repository.get(version_id)
            except KeyError as exc:
                raise KeyError(f"Workflow 不存在：{version_id}") from exc
        else:
            payload = self.store.read_json(["workflows", f"{_safe(version_id)}.json"])
            if not payload:
                raise KeyError(f"Workflow 不存在：{version_id}")
        return WorkflowVersion(**payload)

    def list_versions(self) -> list[WorkflowVersion]:
        """列出已发布 Workflow 版本，支撑前端下拉选择与执行中心创建 Run。"""

        payloads = self.workflow_repository.list() if self.workflow_repository else self.store.list_json(["workflows"])
        return [WorkflowVersion(**payload) for payload in payloads]

    def _save(self, workflow: WorkflowVersion) -> None:
        if self.workflow_repository:
            self.workflow_repository.save(workflow.model_dump(mode="json"))
            return
        self.store.write_json(["workflows", f"{_safe(workflow.version_id)}.json"], workflow.model_dump(mode="json"))


def _safe(value: str) -> str:
    return value.replace(":", "_").replace("/", "_")
