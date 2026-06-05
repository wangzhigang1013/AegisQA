from importlib import import_module

from aegisqa.api.app import create_app


def test_task_routes_are_split_into_focused_modules(tmp_path) -> None:
    modules = {
        "aegisqa.api.routes.task_lifecycle": "register_task_lifecycle_routes",
        "aegisqa.api.routes.task_preflight": "register_task_preflight_routes",
        "aegisqa.api.routes.repair_tasks": "register_repair_task_routes",
    }

    for module_name, register_name in modules.items():
        module = import_module(module_name)
        assert callable(getattr(module, register_name))

    app = create_app(store_root=tmp_path / "store")
    route_paths = {route.path for route in app.routes}
    assert {
        "/tasks",
        "/tasks/{task_id}/execute",
        "/tasks/{task_id}/pause",
        "/tasks/preflight",
        "/task-preflights/{preflight_id}",
        "/repair-tasks",
        "/repair-tasks/{repair_task_id}/actions",
        "/tasks/{task_id}/repair-tasks/from-diagnostics",
    } <= route_paths
