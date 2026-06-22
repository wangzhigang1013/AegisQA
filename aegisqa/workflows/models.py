"""线性 Workflow DSL 模型。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from aegisqa.core.time import now_beijing_str
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class WorkflowStep(BaseModel):
    step_id: str
    skill_ref: str
    input_mapping: dict[str, str] = Field(default_factory=dict)
    output_mapping: dict[str, str] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    cacheable: bool = False


class RuntimeConfig(BaseModel):
    concurrency: int = 1
    chunk_size: int = 100
    retry: dict[str, Any] = Field(default_factory=lambda: {"max_attempts": 1, "backoff_seconds": 0})
    rate_limits: dict[str, Any] = Field(default_factory=dict)
    sample_repeat_times: int = 1
    cache: dict[str, Any] = Field(default_factory=lambda: {"enabled": False})


class WorkflowVersion(BaseModel):
    workflow_id: str
    name: str
    version: int
    version_id: str
    status: str = "published"
    steps: list[WorkflowStep]
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    graph: dict[str, Any] | None = None
    snapshot_hash: str
    published_at: str


class WorkflowDraft(BaseModel):
    name: str
    workflow_id: str | None = None
    steps: list[WorkflowStep]
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)
    graph: dict[str, Any] | None = None

    def publish(self, version: int = 1) -> WorkflowVersion:
        """发布不可变 Workflow 版本。

        修改草稿后应生成新版本，历史 Run 始终绑定已发布快照，保证可追溯。
        """

        workflow_id = self.workflow_id or f"wf-{uuid4().hex[:12]}"
        snapshot_payload = {
            "workflow_id": workflow_id,
            "name": self.name,
            "version": version,
            "steps": [step.model_dump(mode="json") for step in self.steps],
            "runtime": self.runtime.model_dump(mode="json"),
            "graph": self.graph,
        }
        snapshot_hash = hashlib.sha256(json.dumps(snapshot_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        return WorkflowVersion(
            workflow_id=workflow_id,
            name=self.name,
            version=version,
            version_id=f"{workflow_id}:v{version}",
            steps=self.steps,
            runtime=self.runtime,
            graph=self.graph,
            snapshot_hash=snapshot_hash,
            published_at=now_beijing_str(),
        )
