"""AegisQA SDK 资源类。"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from .http import HTTPClient


class Skills:
    """Skill 管理。"""

    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def list(self) -> list[dict[str, Any]]:
        """列出所有 Skill。"""
        return self._http.get("/skills")

    def get(self, skill_id: str) -> dict[str, Any]:
        """获取 Skill 详情。"""
        skills = self.list()
        for skill in skills:
            if skill.get("skill_id") == skill_id:
                return skill
        from .exceptions import NotFoundError
        raise NotFoundError(f"Skill {skill_id} 不存在")

    def packages(self) -> list[dict[str, Any]]:
        """列出所有 Skill 包。"""
        return self._http.get("/skills/packages")

    def upload(self, zip_path: str | Path, filename: str | None = None) -> dict[str, Any]:
        """上传 Skill 包。

        Args:
            zip_path: zip 文件路径。
            filename: 文件名（可选）。

        Returns:
            上传结果。
        """
        path = Path(zip_path)
        if not path.exists():
            from .exceptions import ValidationError
            raise ValidationError(f"文件不存在：{zip_path}")

        zip_bytes = path.read_bytes()
        zip_base64 = base64.b64encode(zip_bytes).decode("ascii")

        return self._http.post("/skills/packages/upload", {
            "filename": filename or path.name,
            "zip_base64": zip_base64,
        })

    def export(self, skill_id: str, include_tests: bool = False, include_history: bool = False) -> dict[str, Any]:
        """导出 Skill 包。

        Args:
            skill_id: Skill ID。
            include_tests: 是否包含测试用例。
            include_history: 是否包含版本历史。

        Returns:
            导出结果（含 zip_base64）。
        """
        params = {}
        if include_tests:
            params["include_tests"] = "true"
        if include_history:
            params["include_history"] = "true"
        return self._http.get(f"/skills/{skill_id}/export", params=params or None)

    def export_to_file(self, skill_id: str, output_path: str | Path, **kwargs: Any) -> Path:
        """导出 Skill 包到文件。

        Args:
            skill_id: Skill ID。
            output_path: 输出文件路径。
            **kwargs: 传递给 export() 的参数。

        Returns:
            输出文件路径。
        """
        result = self.export(skill_id, **kwargs)
        zip_base64 = result.get("zip_base64", "")
        zip_bytes = base64.b64decode(zip_base64)

        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(zip_bytes)
        return path

    def import_package(self, zip_path: str | Path) -> dict[str, Any]:
        """导入 Skill 包。

        Args:
            zip_path: zip 文件路径。

        Returns:
            导入结果。
        """
        path = Path(zip_path)
        if not path.exists():
            from .exceptions import ValidationError
            raise ValidationError(f"文件不存在：{zip_path}")

        zip_bytes = path.read_bytes()
        zip_base64 = base64.b64encode(zip_bytes).decode("ascii")

        return self._http.post("/skills/import", {"zip_base64": zip_base64})

    def contract_test(self, skill_id: str) -> dict[str, Any]:
        """运行 Skill 合约测试。"""
        return self._http.post(f"/skills/{skill_id}/contract-test")

    def approve(self, skill_id: str, reason: str = "") -> dict[str, Any]:
        """审批 Skill。"""
        return self._http.post(f"/skills/{skill_id}/approve", {"reason": reason})

    def disable(self, skill_id: str, reason: str = "") -> dict[str, Any]:
        """禁用 Skill。"""
        return self._http.post(f"/skills/{skill_id}/disable", {"reason": reason})

    def versions(self, skill_id: str) -> dict[str, Any]:
        """获取 Skill 版本历史。"""
        return self._http.get(f"/skills/{skill_id}/versions")


class Tasks:
    """任务管理。"""

    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def list(self, page: int = 1, page_size: int = 20, status: str | None = None) -> dict[str, Any]:
        """列出任务。"""
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if status:
            params["status"] = status
        return self._http.get("/tasks", params=params)

    def get(self, task_id: str) -> dict[str, Any]:
        """获取任务详情。"""
        return self._http.get(f"/tasks/{task_id}")

    def create(
        self,
        name: str,
        dataset_id: str,
        dataset_version: int,
        workflow_version_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """创建任务。"""
        data = {
            "name": name,
            "dataset_id": dataset_id,
            "dataset_version": dataset_version,
            "workflow_version_id": workflow_version_id,
            **kwargs,
        }
        return self._http.post("/tasks", data)

    def preflight(
        self,
        dataset_id: str,
        dataset_version: int,
        workflow_version_id: str,
    ) -> dict[str, Any]:
        """运行任务预检。"""
        return self._http.post("/tasks/preflight", {
            "dataset_id": dataset_id,
            "dataset_version": dataset_version,
            "workflow_version_id": workflow_version_id,
        })

    def diagnostics(self, task_id: str) -> dict[str, Any]:
        """获取任务诊断。"""
        return self._http.get(f"/tasks/{task_id}/diagnostics")

    def trace_flow(self, task_id: str, page: int = 1, page_size: int = 10) -> dict[str, Any]:
        """获取任务 Trace Flow。"""
        return self._http.get(f"/tasks/{task_id}/trace-flow", {"page": page, "page_size": page_size})

    def trace_tree(self, task_id: str, page: int = 1, page_size: int = 10) -> dict[str, Any]:
        """获取任务 Trace Tree。"""
        return self._http.get(f"/tasks/{task_id}/trace-tree", {"page": page, "page_size": page_size})


class Workflows:
    """Workflow 管理。"""

    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def list(self) -> list[dict[str, Any]]:
        """列出所有 Workflow 版本。"""
        return self._http.get("/workflows")

    def templates(self) -> list[dict[str, Any]]:
        """列出 Workflow 模板。"""
        return self._http.get("/workflow-templates")

    def drafts(self) -> list[dict[str, Any]]:
        """列出所有草稿。"""
        return self._http.get("/workflow-drafts")

    def create_draft(self, name: str, steps: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """创建 Workflow 草稿。"""
        data: dict[str, Any] = {"name": name}
        if steps:
            data["steps"] = steps
        return self._http.post("/workflow-drafts", data)

    def publish_draft(self, draft_id: str) -> dict[str, Any]:
        """发布草稿。"""
        return self._http.post(f"/workflow-drafts/{draft_id}/publish")

    def copy(self, workflow_version_id: str) -> dict[str, Any]:
        """复制 Workflow。"""
        return self._http.post(f"/workflows/{workflow_version_id}/copy")


class Datasets:
    """数据集管理。"""

    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def list(self) -> list[dict[str, Any]]:
        """列出所有数据集。"""
        return self._http.get("/datasets")

    def get(self, dataset_id: str) -> dict[str, Any]:
        """获取数据集详情。"""
        return self._http.get(f"/datasets/{dataset_id}")

    def versions(self, dataset_id: str) -> list[dict[str, Any]]:
        """列出数据集版本。"""
        return self._http.get(f"/datasets/{dataset_id}/versions")


class Runs:
    """执行记录管理。"""

    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def list(self, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        """列出执行记录。"""
        return self._http.get("/runs", {"page": page, "page_size": page_size})

    def get(self, run_id: str) -> dict[str, Any]:
        """获取执行记录详情。"""
        return self._http.get(f"/runs/{run_id}")

    def execute(self, run_id: str) -> dict[str, Any]:
        """执行 Run。"""
        return self._http.post(f"/runs/{run_id}/execute")

    def cancel(self, run_id: str) -> dict[str, Any]:
        """取消 Run。"""
        return self._http.post(f"/runs/{run_id}/cancel")

    def pause(self, run_id: str) -> dict[str, Any]:
        """暂停 Run。"""
        return self._http.post(f"/runs/{run_id}/pause")

    def resume(self, run_id: str) -> dict[str, Any]:
        """恢复 Run。"""
        return self._http.post(f"/runs/{run_id}/resume")

    def retry_failed(self, run_id: str) -> dict[str, Any]:
        """重试失败项。"""
        return self._http.post(f"/runs/{run_id}/retry-failed")


class Reports:
    """报告管理。"""

    def __init__(self, http: HTTPClient) -> None:
        self._http = http

    def task_report(self, task_id: str) -> dict[str, Any]:
        """获取任务报告。"""
        return self._http.get(f"/tasks/{task_id}/report")

    def score_analytics(self, **kwargs: Any) -> dict[str, Any]:
        """获取分数分析。"""
        return self._http.get("/score-analytics", params=kwargs or None)

    def badcases(self, task_id: str, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        """获取 Badcase 列表。"""
        return self._http.get(f"/tasks/{task_id}/report", {"badcase_page": page, "badcase_page_size": page_size})
