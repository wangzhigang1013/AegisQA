from __future__ import annotations

import base64
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


SAFE_SKILL_ID = "agent.matrix_skill_md_safe@0.1.0"
SKILL_MD_ZIP_ID = "agent.matrix_skill_md_zip@0.1.0"
INSTRUCTION_REFS_ID = "agent.matrix_instruction_refs@0.1.0"
CODE_ONLY_ID = "agent.matrix_code_only@0.1.0"
CODE_PROMPT_ID = "agent.matrix_code_prompt@0.1.0"


def test_agent_skill_runtime_matrix_import_upload_contract_workflow_and_reload(tmp_path: Path, monkeypatch) -> None:
    skill_root = tmp_path / "agent_skill_roots"
    safe_skill_dir = _write_safe_skill_md_only(skill_root)
    monkeypatch.setenv("AEGISQA_AGENT_SKILL_ROOTS", str(skill_root))
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    discovered = client.get("/agent-skills/discover").json()
    assert discovered["count"] == 1
    assert discovered["items"][0]["name"] == "matrix-skill-md-safe"

    imported = client.post(
        "/agent-skills/import",
        json={"source_dir": str(safe_skill_dir), "skill_id": SAFE_SKILL_ID},
    ).json()
    assert imported["runtime_mode"] == "safe_model"
    assert imported["manifest"]["enabled"] is False

    uploaded_skill_md = _upload_skill_package(client, "matrix_skill_md_only.zip", _skill_md_only_zip())
    assert uploaded_skill_md["runtime_mode"] == "instruction_model"
    assert uploaded_skill_md["manifest"]["skill_id"] == SKILL_MD_ZIP_ID

    uploaded_instruction_refs = _upload_skill_package(client, "matrix_instruction_refs.zip", _instruction_with_references_zip())
    assert uploaded_instruction_refs["runtime_mode"] == "instruction_model"
    assert uploaded_instruction_refs["manifest"]["skill_id"] == INSTRUCTION_REFS_ID

    uploaded_code_only = _upload_skill_package(client, "matrix_code_only.zip", _code_only_zip())
    assert uploaded_code_only["runtime_mode"] == "script"
    assert uploaded_code_only["entrypoint"] == "scripts/run.py:run"

    uploaded_code_prompt = _upload_skill_package(client, "matrix_code_prompt.zip", _code_with_prompt_zip())
    assert uploaded_code_prompt["runtime_mode"] == "script"
    assert uploaded_code_prompt["entrypoint"] == "scripts/run.py:run"

    contract_results = {skill_id: client.post(f"/skills/{skill_id}/contract-test").json() for skill_id in _matrix_skill_ids()}
    assert contract_results[SAFE_SKILL_ID]["ok"] is True
    assert contract_results[SAFE_SKILL_ID]["output"]["runtime_mode"] == "safe_model"
    assert contract_results[SKILL_MD_ZIP_ID]["ok"] is True
    assert contract_results[SKILL_MD_ZIP_ID]["output"]["runtime_mode"] == "instruction_model"
    assert contract_results[INSTRUCTION_REFS_ID]["ok"] is True
    assert contract_results[INSTRUCTION_REFS_ID]["output"]["runtime_mode"] == "instruction_model"
    assert contract_results[CODE_ONLY_ID]["ok"] is True
    assert contract_results[CODE_ONLY_ID]["output"] == {"passed": True, "text_length": 12}
    assert contract_results[CODE_PROMPT_ID]["ok"] is True
    assert contract_results[CODE_PROMPT_ID]["output"]["used_prompt"] is True
    assert contract_results[CODE_PROMPT_ID]["output"]["prompt_count"] == 3
    assert contract_results[CODE_PROMPT_ID]["output"]["prompt_names"] == ["summary", "risk", "json_schema"]

    for skill_id in _matrix_skill_ids():
        approved = client.post(f"/skills/{skill_id}/approve", json={"reason": "多形态 Skill 测试通过"}).json()
        assert approved["status"] == "approved"

    dataset_path = tmp_path / "matrix_dataset.jsonl"
    dataset_path.write_text(
        json.dumps(
            {
                "task": "请归纳 AegisQA 的用途。",
                "text": "这条回答存在幻觉，需要标记。",
                "answer": "AegisQA 是用于 AI 评测和回归验证的平台。",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    dataset = client.post("/datasets/from-path", json={"name": "skill_runtime_matrix", "path": str(dataset_path)}).json()
    published = client.post("/workflow-graphs/publish", json={"graph": _matrix_graph()}).json()
    run = client.post(
        "/runs",
        json={"workflow": published, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]},
    ).json()
    executed = client.post(f"/runs/{run['run_id']}/execute").json()

    assert executed["status"] == "completed"
    steps_by_ref = {step["skill_ref"]: step for step in executed["items"][0]["steps"]}
    assert steps_by_ref[SAFE_SKILL_ID]["output_snapshot"]["runtime_mode"] == "safe_model"
    assert steps_by_ref[SKILL_MD_ZIP_ID]["output_snapshot"]["runtime_mode"] == "instruction_model"
    assert steps_by_ref[INSTRUCTION_REFS_ID]["output_snapshot"]["runtime_mode"] == "instruction_model"
    assert steps_by_ref[CODE_ONLY_ID]["output_snapshot"]["passed"] is True
    assert steps_by_ref[CODE_PROMPT_ID]["output_snapshot"]["used_prompt"] is True
    assert steps_by_ref[CODE_PROMPT_ID]["output_snapshot"]["prompt_count"] == 3
    assert steps_by_ref[CODE_PROMPT_ID]["output_snapshot"]["prompt_names"] == ["summary", "risk", "json_schema"]
    assert "prompt_digest" in steps_by_ref[CODE_PROMPT_ID]["output_snapshot"]

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": published["version_id"],
        },
    ).json()
    assert preflight["status"] in {"passed", "warning"}

    task = client.post(
        "/tasks",
        json={
            "name": "执行中心多形态 Skill 真实任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": published["version_id"],
            "preflight_id": preflight["preflight_id"],
            "preflight_result": preflight,
        },
    ).json()
    assert task["status"] == "queued"
    assert task["preflight_result"]["preflight_id"] == preflight["preflight_id"]

    executed_task = client.post(f"/tasks/{task['task_id']}/execute").json()
    assert executed_task["status"] == "completed"
    assert executed_task["completed_items"] == 1
    assert executed_task["failed_items"] == 0

    task_trace = client.get(f"/tasks/{task['task_id']}/trace-flow").json()
    task_steps_by_ref = {step["skill_ref"]: step for step in task_trace["items"][0]["steps"]}
    task_multi_prompt_output = task_steps_by_ref[CODE_PROMPT_ID]["output"]
    assert task_multi_prompt_output["used_prompt"] is True
    assert task_multi_prompt_output["prompt_count"] == 3
    assert task_multi_prompt_output["prompt_names"] == ["summary", "risk", "json_schema"]

    task_report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert task_report["task"]["status"] == "completed"
    assert task_report["task_summary"]["task_id"] == task["task_id"]
    assert any(item["skill_ref"] == CODE_PROMPT_ID for item in task_report["step_distribution"])

    # 重启后上传包和本地导入的 SKILL.md 都必须从持久化记录恢复，避免审批后丢失。
    reloaded = create_app(store_root=tmp_path / "store")
    for skill_id in _matrix_skill_ids():
        assert reloaded.state.registry.get_manifest(skill_id).status == "approved"


def _write_safe_skill_md_only(root: Path) -> Path:
    skill_dir = root / "matrix-skill-md-safe"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: matrix-skill-md-safe
description: 只有 SKILL.md 的本地导入安全模式测试 Skill。
---

# Matrix Skill MD Safe

你是一个只读安全模式 Skill。请根据输入任务给出简短中文回答，不执行任何脚本。
""",
        encoding="utf-8",
    )
    return skill_dir


def _upload_skill_package(client: TestClient, filename: str, content_base64: str) -> dict[str, object]:
    response = client.post("/skills/packages/upload", json={"filename": filename, "content_base64": content_base64})
    assert response.status_code == 200
    return response.json()


def _skill_md_only_zip() -> str:
    return _zip_bytes(
        {
            "SKILL.md": f"""---
name: matrix-skill-md-zip
skill_id: "{SKILL_MD_ZIP_ID}"
version: "0.1.0"
description: 只有 SKILL.md 的上传说明型测试 Skill。
tags: [matrix, skill-md-only]
---

# Matrix Skill MD Zip

请把输入任务改写成适合评测报告的简洁结论。
""",
        }
    )


def _instruction_with_references_zip() -> str:
    skill_yaml = f"""
skill_id: {INSTRUCTION_REFS_ID}
name: Matrix Instruction References
version: 0.1.0
description: 说明型模型 Skill，包含 references 提示词。
tags: [agent-skill, instruction-model, matrix]
runtime:
  mode: instruction_model
input_schema:
  type: object
  required: [task]
  properties:
    task:
      type: string
output_schema:
  type: object
  required: [answer, text]
  properties:
    answer:
      type: string
    text:
      type: string
    skill_id:
      type: string
    runtime_mode:
      type: string
config_schema:
  type: object
  properties:
    model:
      type: string
    max_reference_chars:
      type: integer
example_input:
  task: 请总结一次评测结果
example_config:
  max_reference_chars: 2000
permissions: [model:call]
"""
    return _zip_bytes(
        {
            "SKILL.md": """---
name: matrix-instruction-refs
description: 根据 SKILL.md 和 references 生成评测总结。
---

# Matrix Instruction References

使用 references 中的风格要求生成简短中文输出。
""",
            "skill.yaml": skill_yaml,
            "references/style.md": "输出必须包含结论、风险和下一步三个要点，整体保持简短。",
        }
    )


def _code_only_zip() -> str:
    skill_yaml = f"""
skill_id: {CODE_ONLY_ID}
name: Matrix Code Only
version: 0.1.0
description: 仅脚本代码执行的确定性 Skill。
tags: [agent-skill, script, matrix]
runtime:
  mode: script
  entrypoint: scripts/run.py:run
input_schema:
  type: object
  required: [text]
  properties:
    text:
      type: string
config_schema:
  type: object
  properties:
    min_length:
      type: integer
output_schema:
  type: object
  required: [passed, text_length]
  properties:
    passed:
      type: boolean
    text_length:
      type: integer
example_input:
  text: AegisQA 质量检查
example_config:
  min_length: 6
permissions: []
"""
    script = """
def run(inputs, config):
    text = str(inputs["text"])
    min_length = int(config.get("min_length") or 0)
    return {
        "output": {"passed": len(text) >= min_length, "text_length": len(text)},
        "metrics": {"min_length": min_length},
        "logs": ["code-only"],
    }
"""
    return _zip_bytes(
        {
            "SKILL.md": """---
name: matrix-code-only
description: 使用 Python 脚本做确定性文本长度检查。
---

# Matrix Code Only

该 Skill 只执行脚本，不调用模型。
""",
            "skill.yaml": skill_yaml,
            "scripts/run.py": script,
        }
    )


def _code_with_prompt_zip() -> str:
    skill_yaml = f"""
skill_id: {CODE_PROMPT_ID}
name: Matrix Code Multi Prompt
version: 0.1.0
description: 脚本代码读取多份提示词后执行的混合型 Skill。
tags: [agent-skill, script, prompt, matrix]
runtime:
  mode: script
  entrypoint: scripts/run.py:run
input_schema:
  type: object
  required: [text]
  properties:
    text:
      type: string
config_schema:
  type: object
  properties:
    instruction:
      type: string
    prompt_keys:
      type: array
      items:
        type: string
output_schema:
  type: object
  required: [summary, prompt_digest, used_prompt, prompt_count, prompt_names]
  properties:
    summary:
      type: string
    prompt_digest:
      type: string
    used_prompt:
      type: boolean
    prompt_count:
      type: integer
    prompt_names:
      type: array
      items:
        type: string
example_input:
  text: 这是一条需要结构化输出的评测结论
example_config:
  instruction: 生成 JSON 摘要
  prompt_keys: [summary, risk, json_schema]
permissions: [filesystem:skill_package_read]
"""
    script = """
from hashlib import sha1
from pathlib import Path


def run(inputs, config):
    prompt_keys = config.get("prompt_keys") or ["summary", "risk", "json_schema"]
    prompt_parts = []
    prompt_names = []
    for key in prompt_keys:
        prompt_path = Path("prompts") / f"{key}.md"
        text = prompt_path.read_text(encoding="utf-8").strip()
        prompt_names.append(str(key))
        prompt_parts.append(f"## {key}\\n{text}")
    prompt_bundle = "\\n\\n".join(prompt_parts)
    instruction = str(config.get("instruction") or "")
    text = str(inputs["text"])
    return {
        "output": {
            "summary": f"{instruction}｜{text[:16]}",
            "prompt_digest": sha1(prompt_bundle.encode("utf-8")).hexdigest()[:8],
            "used_prompt": all(marker in prompt_bundle for marker in ["摘要口径", "风险分层", "严格 JSON 输出"]),
            "prompt_count": len(prompt_names),
            "prompt_names": prompt_names,
        },
        "metrics": {"prompt_chars": len(prompt_bundle), "prompt_count": len(prompt_names)},
        "logs": ["code-with-multi-prompt"],
    }
"""
    return _zip_bytes(
        {
            "SKILL.md": """---
name: matrix-code-multi-prompt
description: 使用脚本和多份提示词共同生成结构化摘要。
---

# Matrix Code Multi Prompt

脚本会读取包内 prompts/summary.md、prompts/risk.md 和 prompts/json_schema.md，并按 config.prompt_keys 组合使用。
""",
            "skill.yaml": skill_yaml,
            "scripts/run.py": script,
            "prompts/summary.md": "摘要口径：先给一句结论，再列出评测对象。",
            "prompts/risk.md": "风险分层：必须判断高、中、低风险，并说明触发原因。",
            "prompts/json_schema.md": "严格 JSON 输出：字段包含 summary、risk_level、next_action。",
        }
    )


def _zip_bytes(files: dict[str, str]) -> str:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _matrix_skill_ids() -> list[str]:
    return [SAFE_SKILL_ID, SKILL_MD_ZIP_ID, INSTRUCTION_REFS_ID, CODE_ONLY_ID, CODE_PROMPT_ID]


def _matrix_graph() -> dict[str, object]:
    return {
        "name": "Agent Skill Runtime Matrix",
        "nodes": [
            {
                "node_id": "safe_agent",
                "node_type": "skill",
                "label": "纯 SKILL.md 安全模式",
                "skill_ref": SAFE_SKILL_ID,
                "input_mapping": {"task": "row.task", "row": "row"},
                "config": {"max_reference_chars": 1000},
            },
            {
                "node_id": "skill_md_zip",
                "node_type": "skill",
                "label": "纯 SKILL.md 上传包",
                "skill_ref": SKILL_MD_ZIP_ID,
                "input_mapping": {"task": "row.task"},
                "config": {},
            },
            {
                "node_id": "instruction_refs",
                "node_type": "skill",
                "label": "说明型提示词包",
                "skill_ref": INSTRUCTION_REFS_ID,
                "input_mapping": {"task": "row.task"},
                "config": {"max_reference_chars": 2000},
            },
            {
                "node_id": "code_only",
                "node_type": "skill",
                "label": "代码型 Skill",
                "skill_ref": CODE_ONLY_ID,
                "input_mapping": {"text": "row.text"},
                "config": {"min_length": 8},
            },
            {
                "node_id": "code_prompt",
                "node_type": "skill",
                "label": "代码+提示词 Skill",
                "skill_ref": CODE_PROMPT_ID,
                "input_mapping": {"text": "row.answer"},
                "config": {"instruction": "生成 JSON 摘要", "prompt_keys": ["summary", "risk", "json_schema"]},
            },
            {"node_id": "join_matrix_outputs", "node_type": "join", "label": "合并多形态 Skill 输出"},
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [
            {"source": "safe_agent", "target": "join_matrix_outputs"},
            {"source": "skill_md_zip", "target": "join_matrix_outputs"},
            {"source": "instruction_refs", "target": "join_matrix_outputs"},
            {"source": "code_only", "target": "join_matrix_outputs"},
            {"source": "code_prompt", "target": "join_matrix_outputs"},
            {"source": "join_matrix_outputs", "target": "report"},
        ],
    }
