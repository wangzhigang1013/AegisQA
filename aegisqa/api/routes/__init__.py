"""AegisQA API 路由注册入口。"""

from aegisqa.api.routes.datasets import register_dataset_routes
from aegisqa.api.routes.governance import register_governance_routes
from aegisqa.api.routes.judge import register_judge_routes
from aegisqa.api.routes.productization import register_productization_routes
from aegisqa.api.routes.reports import register_report_routes
from aegisqa.api.routes.skills import register_skill_routes
from aegisqa.api.routes.tasks import register_task_routes
from aegisqa.api.routes.workflows import register_workflow_routes

__all__ = [
    "register_dataset_routes",
    "register_governance_routes",
    "register_judge_routes",
    "register_productization_routes",
    "register_report_routes",
    "register_skill_routes",
    "register_task_routes",
    "register_workflow_routes",
]
