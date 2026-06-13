"""AegisQA SDK 客户端。"""

from __future__ import annotations

from typing import Any

from .http import HTTPClient
from .resources import Skills, Tasks, Workflows, Datasets, Runs, Reports


class AegisQA:
    """AegisQA SDK 客户端入口。

    使用方式：
        client = AegisQA(base_url="http://localhost:8000")
        skills = client.skills.list()
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        api_key: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._http = HTTPClient(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
        )
        self._skills = Skills(self._http)
        self._tasks = Tasks(self._http)
        self._workflows = Workflows(self._http)
        self._datasets = Datasets(self._http)
        self._runs = Runs(self._http)
        self._reports = Reports(self._http)

    @property
    def skills(self) -> Skills:
        """Skill 管理。"""
        return self._skills

    @property
    def tasks(self) -> Tasks:
        """任务管理。"""
        return self._tasks

    @property
    def workflows(self) -> Workflows:
        """Workflow 管理。"""
        return self._workflows

    @property
    def datasets(self) -> Datasets:
        """数据集管理。"""
        return self._datasets

    @property
    def runs(self) -> Runs:
        """执行记录管理。"""
        return self._runs

    @property
    def reports(self) -> Reports:
        """报告管理。"""
        return self._reports

    def health(self) -> dict[str, Any]:
        """检查服务健康状态。"""
        return self._http.get("/health")

    def dashboard(self) -> dict[str, Any]:
        """获取 Dashboard 摘要。"""
        return self._http.get("/dashboard/summary")

    def close(self) -> None:
        """关闭 HTTP 客户端。"""
        self._http.close()

    def __enter__(self) -> "AegisQA":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
