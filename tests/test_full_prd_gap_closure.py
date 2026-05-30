import json
import sqlite3
from pathlib import Path

from aegisqa.badcases.service import BadcaseService
from aegisqa.datasets.service import DatasetService
from aegisqa.infrastructure.manifest import production_readiness_manifest
from aegisqa.judge.prompt_candidates import PromptCandidateService
from aegisqa.reports.aggregator import RunReport, export_report_html
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.dag import DAGWorkflow, DAGWorkflowExecutor, DAGWorkflowStep


def test_source_skills_execute_db_api_online_sampling_and_materialize_dataset(tmp_path: Path) -> None:
    db_path = tmp_path / "source.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("create table samples (id integer primary key, question text, score real)")
        conn.executemany(
            "insert into samples (question, score) values (?, ?)",
            [("Q1", 0.9), ("Q2", 0.4), ("Q3", 0.8)],
        )
        conn.commit()

    api_payload = tmp_path / "api_rows.json"
    api_payload.write_text(
        json.dumps({"rows": [{"question": "API-Q1", "score": 0.7}, {"question": "API-Q2", "score": 0.2}]}, ensure_ascii=False),
        encoding="utf-8",
    )

    registry = SkillRegistry.with_builtin_skills()
    db_skill = registry.get("source.db_query@0.1.0")
    api_skill = registry.get("source.api_pull@0.1.0")
    sample_skill = registry.get("source.online_sample@0.1.0")

    db_result, _ = db_skill.execute(
        {"connection_id": "local", "sql": "select question, score from samples where score >= :min_score order by id", "params": {"min_score": 0.5}},
        {"connections": {"local": {"driver": "sqlite", "database": str(db_path)}}},
    )
    assert [row["question"] for row in db_result.output["rows"]] == ["Q1", "Q3"]
    assert db_result.output["schema"]["score"] == "number"

    api_result, _ = api_skill.execute({"endpoint": api_payload.as_uri(), "method": "GET", "params": {}}, {})
    assert api_result.output["rows"][0]["question"] == "API-Q1"

    sampled, _ = sample_skill.execute(
        {"rows": db_result.output["rows"] + api_result.output["rows"], "sample_size": 3},
        {"strategy": "first_n"},
    )
    assert len(sampled.output["rows"]) == 3

    dataset_service = DatasetService(JsonStore(tmp_path / "store"))
    dataset = dataset_service.materialize_source_rows("source_materialized", sampled.output["rows"], golden=True, label_field="question")
    assert dataset.row_count == 3
    assert dataset.field_schema["score"] == "number"


def test_dag_executor_runs_parallel_levels_and_conditions() -> None:
    registry = SkillRegistry.with_builtin_skills()
    dag = DAGWorkflow(
        name="parallel_dag",
        steps=[
            DAGWorkflowStep(
                step_id="answer_a",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer_a"},
                config={"model": "demo", "temperature": 0},
            ),
            DAGWorkflowStep(
                step_id="answer_b",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer_b"},
                config={"model": "demo", "temperature": 0},
            ),
            DAGWorkflowStep(
                step_id="judge",
                skill_ref="llm.judge@0.1.0",
                depends_on=["answer_a", "answer_b"],
                condition="context.answer_a exists",
                input_mapping={"question": "row.question", "answer": "context.answer_a", "reference": "row.reference"},
                output_mapping={"label": "context.judge_label"},
                config={"threshold": 0.6},
            ),
            DAGWorkflowStep(
                step_id="skipped",
                skill_ref="llm.judge@0.1.0",
                depends_on=["answer_a"],
                condition="context.missing exists",
                input_mapping={"question": "row.question", "answer": "context.answer_a", "reference": "row.reference"},
                output_mapping={"label": "context.skipped_label"},
            ),
        ],
    )

    assert dag.execution_levels() == [["answer_a", "answer_b"], ["judge", "skipped"]]
    result = DAGWorkflowExecutor(registry).execute_row(dag, {"question": "AegisQA 是什么?", "reference": "AegisQA"})

    assert result["context"]["judge_label"] == "pass"
    assert result["steps"]["skipped"]["status"] == "skipped"
    assert result["steps"]["answer_a"]["level"] == 0
    assert result["steps"]["answer_b"]["level"] == 0


def test_prompt_candidate_pool_badcase_filters_and_html_report_export(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    badcases = BadcaseService(store)
    first = badcases.create_badcase("run-1", "item-1", "judge_label=fail", {"question": "支付失败", "score": 0.2, "skill": "judge"})
    second = badcases.create_badcase("run-1", "item-2", "TypeMismatchError", {"question": "类型错误", "score": 0.0, "skill": "answer"})
    badcases.correct_badcase(first.badcase_id, human_label="incorrect", problem_type="payment", note="需要优化 Prompt", add_to_golden=True)

    filtered = badcases.filter_badcases(status="accepted_to_golden", problem_type="payment", query="支付", min_score=0.1, max_score=0.3)
    assert [item.badcase_id for item in filtered] == [first.badcase_id]
    assert second.badcase_id not in {item.badcase_id for item in filtered}

    embedding_clusters = badcases.cluster_badcases(method="embedding", text_field="question", similarity_threshold=0.2)
    assert embedding_clusters[0]["method"] == "embedding"
    assert embedding_clusters[0]["count"] >= 1

    candidates = PromptCandidateService(store)
    candidate = candidates.create_from_badcase(first, judge_profile_id="judge-v1", prompt_version="prompt-v1")
    candidate = candidates.mark_reviewed(candidate.candidate_id, decision="accepted", reviewer="qa-owner")
    assert candidate.status == "accepted"
    assert candidates.list_candidates(judge_profile_id="judge-v1")[0].source_badcase_id == first.badcase_id

    report = RunReport(
        run_id="run-1",
        total_items=2,
        completed_items=1,
        failed_items=1,
        pass_rate=0.5,
        error_rate=0.5,
        average_latency_ms=12,
        p95_latency_ms=15,
        metrics={"avg_judge_score": 0.5},
        error_distribution={"TypeMismatchError": 1},
        badcases=[],
    )
    html_path = export_report_html(report, tmp_path / "report.html")
    html = html_path.read_text(encoding="utf-8")
    assert "<html" in html
    assert "pass_rate" in html
    assert "avg_judge_score" in html


def test_production_readiness_manifest_and_infra_files_exist() -> None:
    manifest = production_readiness_manifest()

    assert manifest["queue"]["broker"] == "redis"
    assert manifest["worker"]["engine"] == "celery"
    assert manifest["database"]["default"] == "mysql8"
    assert Path("docker-compose.yml").exists()
    assert Path("infra/mysql/schema.sql").exists()
    assert Path("infra/celery/README.md").exists()
