"""AegisQA Streamlit 工作台。

页面以实际评测操作为第一屏，不做营销落地页。每个 Tab 对应 PRD 中的核心信息架构：
数据集、Skill 市场、Workflow、执行监控、报告/Badcase、Judge 审计和治理配置。
"""

from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile

import streamlit as st

from aegisqa.audit.service import AuditService
from aegisqa.badcases.service import BadcaseService
from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.infrastructure.manifest import production_readiness_manifest
from aegisqa.judge.profiles import JudgeProfileService
from aegisqa.judge.prompt_candidates import PromptCandidateService
from aegisqa.reports.aggregator import aggregate_run_report, export_report_html
from aegisqa.security.access import AccessControl
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep
from aegisqa.workflows.templates import WorkflowTemplateService


@st.cache_resource
def _services() -> dict[str, object]:
    store = JsonStore("data/aegisqa_store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    return {
        "store": store,
        "dataset_service": dataset_service,
        "registry": registry,
        "runner": WorkflowRunner(store, dataset_service, registry),
        "badcases": BadcaseService(store),
        "judge_profiles": JudgeProfileService(store),
        "prompt_candidates": PromptCandidateService(store),
        "templates": WorkflowTemplateService(registry),
        "audit": AuditService(store),
        "access": AccessControl(),
    }


services = _services()
store: JsonStore = services["store"]  # type: ignore[assignment]
dataset_service: DatasetService = services["dataset_service"]  # type: ignore[assignment]
registry: SkillRegistry = services["registry"]  # type: ignore[assignment]
runner: WorkflowRunner = services["runner"]  # type: ignore[assignment]
badcases: BadcaseService = services["badcases"]  # type: ignore[assignment]
judge_profiles: JudgeProfileService = services["judge_profiles"]  # type: ignore[assignment]
prompt_candidates: PromptCandidateService = services["prompt_candidates"]  # type: ignore[assignment]
templates: WorkflowTemplateService = services["templates"]  # type: ignore[assignment]
audit: AuditService = services["audit"]  # type: ignore[assignment]
access: AccessControl = services["access"]  # type: ignore[assignment]


st.set_page_config(page_title="AegisQA", layout="wide")
st.title("AegisQA")

tab_dataset, tab_skills, tab_workflow, tab_run, tab_report, tab_judge, tab_governance = st.tabs(
    ["数据集", "Skill 市场", "Workflow", "执行", "报告 / Badcase", "Judge 审计", "治理"]
)


with tab_dataset:
    left, right = st.columns([1, 1])
    with left:
        st.subheader("托管数据集")
        uploaded = st.file_uploader("上传 CSV 或 JSONL", type=["csv", "jsonl"])
        dataset_name = st.text_input("数据集名称", value="rag_regression")
        golden = st.checkbox("Golden Dataset")
        label_field = st.text_input("人工标签字段", value="expected_label")
        if uploaded and st.button("注册数据集", type="primary"):
            suffix = Path(uploaded.name).suffix
            with NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handle.write(uploaded.getvalue())
                temp_path = Path(handle.name)
            dataset = dataset_service.upload_dataset(dataset_name, temp_path, golden=golden, label_field=label_field or None)
            st.session_state["dataset"] = dataset
            audit.record(actor="streamlit", action="dataset.upload", target=dataset.version_id)
            st.success(f"已注册 {dataset.version_id}，共 {dataset.row_count} 条")

        st.subheader("Source Skill 物化")
        source_rows = st.text_area("粘贴 Source rows JSON 数组", value='[{"question":"Q","reference":"AegisQA","score":0.9}]', height=110)
        if st.button("物化 Source Rows"):
            import json

            rows = json.loads(source_rows)
            dataset = dataset_service.materialize_source_rows("source_materialized", rows, golden=False)
            st.session_state["dataset"] = dataset
            audit.record(actor="streamlit", action="dataset.materialize_source", target=dataset.version_id)
            st.success(f"已物化 {dataset.version_id}")

    with right:
        dataset = st.session_state.get("dataset")
        if dataset:
            st.metric("样本数", dataset.row_count)
            st.metric("版本", dataset.version_id)
            st.dataframe(dataset.preview, use_container_width=True, hide_index=True)
            st.json(dataset.field_schema)
            field_name = st.selectbox("修正字段", options=list(dataset.field_schema.keys()))
            field_type = st.text_input("字段类型", value=dataset.field_schema[field_name])
            if st.button("保存字段类型"):
                corrected = dataset_service.correct_field_type(dataset.dataset_id, dataset.version, field_name, field_type)
                st.session_state["dataset"] = corrected
                audit.record(actor="streamlit", action="dataset.field_type.correct", target=f"{corrected.version_id}:{field_name}")
                st.success("字段类型已更新")
        else:
            st.info("上传或物化数据后展示预览。")


with tab_skills:
    st.subheader("Skill 市场")
    skill_rows = [skill.model_dump(mode="json") for skill in registry.list_skills()]
    st.dataframe(skill_rows, use_container_width=True, hide_index=True)
    selected_skill = st.selectbox("选择 Skill", options=[skill["skill_id"] for skill in skill_rows])
    manifest = registry.get_manifest(selected_skill)
    col_a, col_b, col_c = st.columns(3)
    col_a.metric("状态", manifest.status)
    col_b.metric("启用", "是" if manifest.enabled else "否")
    col_c.metric("版本", manifest.version)
    st.json(manifest.model_dump(mode="json"))
    if st.button("运行合约测试"):
        st.json(registry.get(selected_skill).contract_test())


with tab_workflow:
    st.subheader("Workflow 模板")
    template_options = {template.template_id: template for template in templates.list_templates()}
    template_id = st.selectbox("模板", options=list(template_options.keys()))
    threshold = st.slider("Judge 阈值", min_value=0.0, max_value=1.0, value=0.6, step=0.05)
    draft = templates.create_workflow(template_id, name=f"streamlit_{template_id}")

    # 当前模板服务给出默认配置；这里覆盖 Judge 阈值，让测试人员能在 UI 中调参。
    for step in draft.steps:
        if step.skill_ref == "llm.judge@0.1.0":
            step.config["threshold"] = threshold

    workflow = draft.publish()
    st.session_state["workflow"] = workflow
    st.code(workflow.model_dump_json(indent=2), language="json")


with tab_run:
    st.subheader("执行控制")
    dataset = st.session_state.get("dataset")
    workflow = st.session_state.get("workflow")
    chunk_size = st.number_input("Chunk Size", min_value=1, max_value=1000, value=100)
    concurrency = st.number_input("Run 并发", min_value=1, max_value=64, value=4)
    repeat_times = st.number_input("Sample Repeat Times", min_value=1, max_value=10, value=1)
    qps = st.number_input("LLM Call QPS", min_value=0.0, max_value=100.0, value=0.0, step=1.0)
    run_disabled = not dataset or not workflow

    action_a, action_b, action_c = st.columns(3)
    if action_a.button("试运行", disabled=run_disabled):
        run = runner.dry_run(workflow, dataset.dataset_id, dataset.version, sample_size=3)
        st.session_state["run"] = run
        st.success(f"试运行 {run.status}")
    if action_b.button("批量执行", type="primary", disabled=run_disabled):
        rate_limits = {"llm.call@0.1.0": qps} if qps else {}
        run = runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=dataset.dataset_id,
                dataset_version=dataset.version,
                chunk_size=int(chunk_size),
                concurrency=int(concurrency),
                sample_repeat_times=int(repeat_times),
                rate_limits=rate_limits,
            )
        )
        run = runner.execute_run(run.run_id)
        st.session_state["run"] = run
        audit.record(actor="streamlit", action="run.execute", target=run.run_id)
        st.success(f"Run {run.run_id} 状态：{run.status}")
    if action_c.button("暂停当前 Run", disabled="run" not in st.session_state):
        st.session_state["run"] = runner.pause_run(st.session_state["run"].run_id)

    if "run" in st.session_state:
        run = st.session_state["run"]
        metric_a, metric_b, metric_c = st.columns(3)
        metric_a.metric("总样本", run.total_items)
        metric_b.metric("状态", run.status)
        metric_c.metric("队列消息字段", ",".join(run.queue_messages[0].keys()) if run.queue_messages else "-")
        st.dataframe([item.model_dump(mode="json") for item in run.items], use_container_width=True, hide_index=True)


with tab_report:
    st.subheader("报告与 Badcase")
    if "run" in st.session_state:
        report = aggregate_run_report(st.session_state["run"])
        metric_a, metric_b, metric_c, metric_d = st.columns(4)
        metric_a.metric("通过率", f"{report.pass_rate:.1%}")
        metric_b.metric("错误率", f"{report.error_rate:.1%}")
        metric_c.metric("P95 耗时", f"{report.p95_latency_ms:.2f} ms")
        metric_d.metric("Badcase", len(report.badcases))
        st.bar_chart({"count": report.metrics})
        st.dataframe([badcase.model_dump(mode="json") for badcase in report.badcases], use_container_width=True, hide_index=True)
        if st.button("导出 HTML 报告"):
            path = export_report_html(report, store.path("exports", f"{report.run_id}.html"))
            st.success(f"已导出 {path}")

        if report.badcases:
            selected = report.badcases[0]
            record = badcases.create_badcase(selected.run_id if hasattr(selected, "run_id") else report.run_id, selected.item_id, selected.reason, selected.payload)
            corrected = badcases.correct_badcase(record.badcase_id, human_label="incorrect", problem_type="review", note="从报告页加入候选", add_to_golden=True)
            candidate = prompt_candidates.create_from_badcase(corrected, judge_profile_id="streamlit-judge", prompt_version="prompt-v1")
            st.caption(f"已生成 Prompt 候选：{candidate.candidate_id}")
    else:
        st.info("执行 Run 后展示报告和 Badcase。")


with tab_judge:
    st.subheader("Judge Profile")
    profile_name = st.text_input("Profile 名称", value="streamlit_judge")
    prompt = st.text_area("Judge Prompt", value="判断回答是否命中参考答案")
    if st.button("保存 Judge Profile"):
        profile = judge_profiles.create_profile(
            name=profile_name,
            model="judge-model",
            prompt=prompt,
            rubric={"pass": "命中", "fail": "未命中"},
            threshold=0.6,
            output_schema={"type": "object", "properties": {"label": {"type": "string"}}},
        )
        st.session_state["judge_profile"] = profile
        audit.record(actor="streamlit", action="judge_profile.create", target=profile.profile_id)
        st.success(profile.profile_id)

    if "run" in st.session_state and "judge_profile" in st.session_state:
        run = st.session_state["run"]
        human_labels = [item.context_snapshot.get("row", {}).get("expected_label", "fail") for item in run.items]
        judge_labels = [item.context_snapshot.get("context", {}).get("judge_label", "fail") for item in run.items]
        if st.button("审计当前 Run"):
            profile = st.session_state["judge_profile"]
            audit_result = judge_profiles.audit_and_store(
                profile.profile_id,
                dataset_version_id=run.snapshot.get("dataset_version", "dataset"),
                human_labels=human_labels,
                judge_labels=judge_labels,
            )
            st.json(audit_result.model_dump(mode="json"))
            st.json(judge_profiles.bias_analysis(audit_result.audit_id))


with tab_governance:
    st.subheader("权限与生产适配")
    role = st.selectbox("角色", options=["Admin", "Skill Developer", "Evaluator", "Viewer"])
    permission = st.text_input("权限", value="workflow:publish")
    st.metric("允许", "是" if access.can(role, permission) else "否")
    st.json(production_readiness_manifest())
    st.subheader("审计日志")
    st.dataframe([event.model_dump(mode="json") for event in audit.list_events()], use_container_width=True, hide_index=True)

