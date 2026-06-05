from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def test_p2_25_tutorial_docs_are_cross_linked() -> None:
    tutorial_paths = [
        "docs/tutorials/5-minute-asr-qa-eval.md",
        "docs/tutorials/write-script-skill.md",
        "docs/tutorials/connect-real-model.md",
        "docs/SKILL_EXAMPLES_INDEX.md",
    ]
    for path in tutorial_paths:
        assert (REPO_ROOT / path).exists(), f"{path} 缺失"

    five_minute = _read("docs/tutorials/5-minute-asr-qa-eval.md")
    for expected in ["ap_asr_lookup.zip", "answer_compare_rule.zip", "Skill 市场", "执行中心", "导出报告"]:
        assert expected in five_minute

    script_skill = _read("docs/tutorials/write-script-skill.md")
    for expected in ["runtime.mode=script", "scripts/run.py:run", "permissions", "合约测试", "SKILL_PACKAGE_DEPENDENCIES_UNSUPPORTED"]:
        assert expected in script_skill

    model_doc = _read("docs/tutorials/connect-real-model.md")
    for expected in ["/model-gateway/connections", "secret_ref", "env:", "api_key_configured", "model_connection_id"]:
        assert expected in model_doc

    examples = _read("docs/SKILL_EXAMPLES_INDEX.md")
    for expected in [
        "C:\\Users\\17343\\Desktop\\skills",
        "ap_asr_lookup.zip",
        "answer_compare_rule.zip",
        "agent_model_qa_helper.zip",
        "agent_code_multi_prompt_router.zip",
    ]:
        assert expected in examples

    readme = _read("README.md")
    for path in tutorial_paths:
        assert path in readme

    guide = _read("docs/AGENT_SKILL_PACKAGE_GUIDE.md")
    for path in tutorial_paths:
        assert path in guide
