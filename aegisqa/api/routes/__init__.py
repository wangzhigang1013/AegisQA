"""AegisQA API 路由注册入口。"""

from aegisqa.api.routes.agent_skills import register_agent_skill_routes
from aegisqa.api.routes.auth import register_auth_routes
from aegisqa.api.routes.datasets import register_dataset_routes
from aegisqa.api.routes.experiments import register_experiment_routes
from aegisqa.api.routes.governance import register_governance_routes
from aegisqa.api.routes.judge import register_judge_routes
from aegisqa.api.routes.models import register_model_routes
from aegisqa.api.routes.playground import register_playground_routes
from aegisqa.api.routes.productization import register_productization_routes
from aegisqa.api.routes.repair_tasks import register_repair_task_routes
from aegisqa.api.routes.reports import register_report_routes
from aegisqa.api.routes.skills import register_skill_routes
from aegisqa.api.routes.task_lifecycle import register_task_lifecycle_routes
from aegisqa.api.routes.task_preflight import register_task_preflight_routes
from aegisqa.api.routes.task_reports import register_task_report_routes
from aegisqa.api.routes.tasks import register_task_routes
from aegisqa.api.routes.workflows import register_workflow_routes

__all__ = [
    "register_agent_skill_routes",
    "register_auth_routes",
    "register_dataset_routes",
    "register_experiment_routes",
    "register_governance_routes",
    "register_judge_routes",
    "register_model_routes",
    "register_playground_routes",
    "register_productization_routes",
    "register_repair_task_routes",
    "register_report_routes",
    "register_skill_routes",
    "register_task_lifecycle_routes",
    "register_task_preflight_routes",
    "register_task_report_routes",
    "register_task_routes",
    "register_workflow_routes",
]
