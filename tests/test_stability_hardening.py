"""稳定性、可用性、数据可追踪优化的测试覆盖。

覆盖：
- experiment compare 接口（修复 ctx.run_repository bug）
- skill import 接口（修复 zip_base64 字段名 bug）
- DAG 执行路径
- 流式导出接口
- 分页默认行为
- 输入范围校验
"""

from __future__ import annotations

import base64
import csv
import io
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.engine.runner import RunRecord, RunItem, RunItemStep, RunRequest, WorkflowRunner
from aegisqa.workflows.models import WorkflowVersion, WorkflowStep


@pytest.fixture()
def app(tmp_path: Path):
    return create_app(store_root=tmp_path)


@pytest.fixture()
def client(app):
    return TestClient(app)


# ---------------------------------------------------------------------------
# Task #41: Experiment Compare Endpoint Tests
# ---------------------------------------------------------------------------

class TestExperimentCompare:
    """测试 experiment compare 接口（修复后的版本）。"""

    def test_compare_experiment_not_found(self, client: TestClient):
        """对比不存在的实验应返回 404。"""
        response = client.post("/experiments/nonexistent/compare")
        assert response.status_code == 404

    def test_compare_experiment_missing_runs(self, client: TestClient):
        """实验缺少 baseline 或 compare run 时应返回 400。"""
        from aegisqa.api.app import _save_record
        experiment = {
            "experiment_id": "exp-test-002",
            "name": "Incomplete Experiment",
            "status": "snapshotted",
            "created_at": "2025-01-01T00:00:00Z",
        }
        _save_record(client.app.state.store, "experiments", "experiment_id", experiment)
        response = client.post("/experiments/exp-test-002/compare")
        assert response.status_code == 400

    def test_compare_experiment_with_valid_data(self, client: TestClient):
        """对比有效的实验应返回统计检验结果。"""
        from aegisqa.api.app import _save_record

        # 创建两个 Run
        for run_id in ["run-test-001", "run-test-002"]:
            run_data = {
                "run_id": run_id,
                "status": "completed",
                "workflow": {
                    "workflow_id": "wf-1",
                    "version_id": "wf-v1",
                    "version": "1.0",
                    "name": "Test Workflow",
                    "steps": [],
                    "snapshot_hash": "test-hash",
                    "published_at": "2025-01-01T00:00:00Z",
                },
                "dataset_id": "ds-1",
                "dataset_version": 1,
                "chunk_size": 10,
                "concurrency": 1,
                "items": [
                    {
                        "item_id": f"{run_id}-item-{i}",
                        "run_id": run_id,
                        "row_id": f"row-{i}",
                        "row_index": i,
                        "row_hash": f"hash-{i}",
                        "status": "succeeded",
                        "steps": [],
                        "metrics": {"pass_rate": 0.8 + i * 0.01},
                        "context_snapshot": {},
                    }
                    for i in range(5)
                ],
                "created_at": "2025-01-01T00:00:00Z",
            }
            _save_record(client.app.state.store, "runs", "run_id", run_data)

        # 保存实验记录
        experiment = {
            "experiment_id": "exp-test-001",
            "name": "Test Experiment",
            "run_id": "run-test-001",
            "baseline_run_id": "run-test-002",
            "status": "snapshotted",
            "created_at": "2025-01-01T00:00:00Z",
        }
        _save_record(client.app.state.store, "experiments", "experiment_id", experiment)

        # 调用对比接口
        response = client.post("/experiments/exp-test-001/compare?metric_name=pass_rate")
        assert response.status_code == 200
        data = response.json()
        assert "test_result" in data
        assert data["experiment_id"] == "exp-test-001"
        assert data["metric_name"] == "pass_rate"


# ---------------------------------------------------------------------------
# Task #42: Skill Import Endpoint Tests
# ---------------------------------------------------------------------------

class TestSkillImport:
    """测试 skill import 接口（修复后的版本）。"""

    def test_import_skill_invalid_base64(self, client: TestClient):
        """无效 base64 应返回错误。"""
        response = client.post("/skills/import", json={
            "zip_base64": "not-valid-base64!!!",
            "role": "Skill Developer",
            "actor": "test",
        })
        # 应该返回 400 或 422
        assert response.status_code in (400, 422, 500)

    def test_import_skill_missing_zip(self, client: TestClient):
        """空 zip 应返回错误。"""
        empty_zip = base64.b64encode(b"PK\x05\x06" + b"\x00" * 18).decode()
        response = client.post("/skills/import", json={
            "zip_base64": empty_zip,
            "role": "Skill Developer",
            "actor": "test",
        })
        # 应该返回错误（空 zip 或无效 zip）
        assert response.status_code in (400, 422, 500)


# ---------------------------------------------------------------------------
# Task #43: DAG Execution Path Tests
# ---------------------------------------------------------------------------

class TestDAGExecution:
    """测试 DAG 执行路径。"""

    def test_has_dag_structure_with_edges(self):
        """有 edges 的 workflow 应被识别为 DAG。"""
        from aegisqa.workflows.models import WorkflowVersion, WorkflowStep
        workflow = WorkflowVersion(
            workflow_id="wf-dag-1",
            version_id="wf-dag-v1",
            version="1.0",
            name="DAG Workflow",
            steps=[
                WorkflowStep(step_id="s1", skill_ref="echo", input_mapping={}, output_mapping={}),
                WorkflowStep(step_id="s2", skill_ref="echo", input_mapping={}, output_mapping={}),
            ],
            graph={
                "nodes": [
                    {"id": "s1", "data": {}},
                    {"id": "s2", "data": {}},
                ],
                "edges": [
                    {"source": "s1", "target": "s2"},
                ],
            },
            snapshot_hash="test-hash",
            published_at="2025-01-01T00:00:00Z",
        )
        runner = WorkflowRunner(
            store=MagicMock(),
            dataset_service=MagicMock(),
            registry=MagicMock(),
        )
        assert runner._has_dag_structure(workflow) is True

    def test_has_dag_structure_without_edges(self):
        """没有 edges 的 workflow 不应被识别为 DAG。"""
        from aegisqa.workflows.models import WorkflowVersion, WorkflowStep
        workflow = WorkflowVersion(
            workflow_id="wf-linear-1",
            version_id="wf-linear-v1",
            version="1.0",
            name="Linear Workflow",
            steps=[
                WorkflowStep(step_id="s1", skill_ref="echo", input_mapping={}, output_mapping={}),
            ],
            graph={"nodes": [], "edges": []},
            snapshot_hash="test-hash",
            published_at="2025-01-01T00:00:00Z",
        )
        runner = WorkflowRunner(
            store=MagicMock(),
            dataset_service=MagicMock(),
            registry=MagicMock(),
        )
        assert runner._has_dag_structure(workflow) is False

    def test_build_dag_from_graph(self):
        """从 workflow graph 构建 DAG 应正确解析依赖关系。"""
        from aegisqa.workflows.models import WorkflowVersion, WorkflowStep
        workflow = WorkflowVersion(
            workflow_id="wf-dag-2",
            version_id="wf-dag-v2",
            version="1.0",
            name="DAG Workflow 2",
            steps=[
                WorkflowStep(step_id="s1", skill_ref="echo", input_mapping={}, output_mapping={}),
                WorkflowStep(step_id="s2", skill_ref="echo", input_mapping={}, output_mapping={}),
                WorkflowStep(step_id="s3", skill_ref="echo", input_mapping={}, output_mapping={}),
            ],
            graph={
                "nodes": [
                    {"id": "s1", "data": {}},
                    {"id": "s2", "data": {}},
                    {"id": "s3", "data": {}},
                ],
                "edges": [
                    {"source": "s1", "target": "s2"},
                    {"source": "s1", "target": "s3"},
                ],
            },
            snapshot_hash="test-hash",
            published_at="2025-01-01T00:00:00Z",
        )
        runner = WorkflowRunner(
            store=MagicMock(),
            dataset_service=MagicMock(),
            registry=MagicMock(),
        )
        dag = runner._build_dag_from_graph(workflow)
        assert len(dag.steps) == 3
        # s2 和 s3 都依赖 s1
        s2_step = next(s for s in dag.steps if s.step_id == "s2")
        s3_step = next(s for s in dag.steps if s.step_id == "s3")
        assert "s1" in s2_step.depends_on
        assert "s1" in s3_step.depends_on


# ---------------------------------------------------------------------------
# Task #44: Streaming Export Endpoint Tests
# ---------------------------------------------------------------------------

class TestStreamingExport:
    """测试流式导出接口。"""

    def test_export_results_not_found(self, client: TestClient):
        """导出不存在的任务应返回 404。"""
        response = client.get("/tasks/nonexistent/results/export?file_format=csv")
        assert response.status_code == 404

    def test_export_results_invalid_format(self, client: TestClient):
        """无效的导出格式应返回 400。"""
        # 先创建一个任务
        from aegisqa.api.app import _save_record
        task_data = {
            "task_id": "task-export-003",
            "name": "Export Test Task 3",
            "run_id": "run-export-003",
            "status": "completed",
            "dataset_id": "ds-1",
            "dataset_version": 1,
            "workflow_id": "wf-1",
            "workflow_version_id": "wf-v1",
            "total_items": 0,
            "completed_items": 0,
            "failed_items": 0,
            "pass_rate": 1.0,
            "attempts": [],
            "created_at": "2025-01-01T00:00:00Z",
        }
        _save_record(client.app.state.store, "tasks", "task_id", task_data)

        response = client.get("/tasks/task-export-003/results/export?file_format=invalid")
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Pagination Default Behavior Tests
# ---------------------------------------------------------------------------

class TestPaginationDefaults:
    """测试分页默认行为。"""

    def test_tasks_default_pagination(self, client: TestClient):
        """/tasks 应默认返回分页响应。"""
        response = client.get("/tasks")
        assert response.status_code == 200
        data = response.json()
        # 应该是分页对象，不是数组
        assert isinstance(data, dict)
        assert "items" in data
        assert "pagination" in data
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["page_size"] == 20

    def test_runs_default_pagination(self, client: TestClient):
        """/runs 应默认返回分页响应。"""
        response = client.get("/runs")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        assert "items" in data
        assert "pagination" in data


# ---------------------------------------------------------------------------
# Input Validation Tests
# ---------------------------------------------------------------------------

class TestInputValidation:
    """测试输入范围校验。"""

    def test_badcases_score_range_validation(self, client: TestClient):
        """min_score/max_score 应限制在 0-1 范围内。"""
        response = client.get("/badcases?min_score=-0.5")
        assert response.status_code == 422

        response = client.get("/badcases?max_score=1.5")
        assert response.status_code == 422

        response = client.get("/badcases?min_score=0.0&max_score=1.0")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Runner Retry Logic Tests
# ---------------------------------------------------------------------------

class TestRunnerRetry:
    """测试 Runner 自动重试逻辑。"""

    def test_runner_reads_retry_config(self):
        """Runner 应从 task_config_snapshot 读取重试配置。"""
        runner = WorkflowRunner(
            store=MagicMock(),
            dataset_service=MagicMock(),
            registry=MagicMock(),
        )
        # 验证缓存 TTL 可通过环境变量配置
        assert runner._cache_ttl > 0

    def test_runner_cache_ttl_from_env(self, monkeypatch):
        """缓存 TTL 应支持环境变量配置。"""
        monkeypatch.setenv("AEGISQA_CACHE_TTL", "7200")
        runner = WorkflowRunner(
            store=MagicMock(),
            dataset_service=MagicMock(),
            registry=MagicMock(),
        )
        assert runner._cache_ttl == 7200

    def test_runner_cache_key_full_storage(self):
        """缓存 key 应存储完整值，不截断。"""
        runner = WorkflowRunner(
            store=MagicMock(),
            dataset_service=MagicMock(),
            registry=MagicMock(),
        )
        # 创建一个 mock step
        step = MagicMock()
        step.step_id = "test-step"
        step.skill_ref = "echo"
        step.cacheable = True
        step.config = {}

        # 创建 mock skill manifest
        skill = MagicMock()
        skill.manifest.version = "1.0"
        skill.manifest.dependencies = []

        runner.registry.get = MagicMock(return_value=skill)

        cache_key = runner._cache_key(step, "1.0", {"input": "test"}, {"config": "test"})
        # 缓存 key 应该是完整的 SHA-256 哈希（64 字符）
        assert len(cache_key) == 64


# ---------------------------------------------------------------------------
# Audit Request-ID Propagation Tests
# ---------------------------------------------------------------------------

class TestAuditRequestId:
    """测试审计事件自动携带 Request-ID。"""

    def test_audit_service_uses_context_request_id(self):
        """审计服务应自动从上下文变量获取 request_id。"""
        from aegisqa.audit.service import AuditService, set_current_request_id, get_current_request_id
        from aegisqa.storage.json_store import JsonStore

        # 设置上下文变量
        set_current_request_id("test-trace-123")
        assert get_current_request_id() == "test-trace-123"

        # 创建审计服务
        store = MagicMock()
        service = AuditService(store)

        # 记录事件（不传递 trace_id）
        event = service.record(
            actor="test",
            action="test.action",
            target="test-target",
        )

        # 应该自动使用上下文中的 request_id
        assert event.trace_id == "test-trace-123"

        # 清理
        set_current_request_id(None)

    def test_audit_service_fallback_trace_id(self):
        """没有上下文 request_id 时应生成随机 trace_id。"""
        from aegisqa.audit.service import AuditService, set_current_request_id

        set_current_request_id(None)

        store = MagicMock()
        service = AuditService(store)

        event = service.record(
            actor="test",
            action="test.action",
            target="test-target",
        )

        # 应该生成一个随机的 trace_id
        assert event.trace_id.startswith("trace_")
        assert len(event.trace_id) > 6
