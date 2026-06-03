from __future__ import annotations

import base64
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.skills.base import SkillManifest


def test_phase1_spec_and_schema_files_exist() -> None:
    assert Path("docs/specs/skill-package-v1.md").exists()
    assert Path("aegisqa/skills/specs/skill_manifest.schema.json").exists()
    assert Path("aegisqa/skills/specs/prompt_manifest.schema.json").exists()


def test_legacy_skill_manifest_defaults_to_schema_version_zero() -> None:
    manifest = SkillManifest(
        skill_id="legacy.echo@0.1.0",
        name="Legacy Echo",
        version="0.1.0",
        description="Legacy manifest",
    )

    assert manifest.schema_version == 0
    assert manifest.type == "code"
    assert manifest.category == "legacy"
    assert manifest.runtime["kind"] == "python"


def test_v1_code_skill_uses_context_entrypoint(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    uploaded = client.post(
        "/skills/packages/upload",
        json={
            "filename": "code-v1.zip",
            "content_base64": _package_zip(
                manifest=_v1_manifest("plugin.code_v1@0.1.0", skill_type="code"),
                handler="""
def run(input_data, context):
    return {
        "output": {
            "echo": input_data["text"],
            "context_has_skill": bool(context.get("skill_id")),
        },
        "metrics": {"entrypoint": "v1"},
    }
""",
            ),
        },
    ).json()

    assert uploaded["manifest"]["schema_version"] == 1
    assert uploaded["manifest"]["type"] == "code"

    contract = client.post("/skills/plugin.code_v1@0.1.0/contract-test").json()
    assert contract["ok"] is True
    assert contract["output"] == {"echo": "hello", "context_has_skill": True}
    assert contract["metrics"]["entrypoint"] == "v1"


def test_v1_prompt_skill_requires_prompt_files(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.post(
        "/skills/packages/upload",
        json={
            "filename": "prompt-missing-files.zip",
            "content_base64": _package_zip(
                manifest=_v1_manifest(
                    "plugin.prompt_missing@0.1.0",
                    skill_type="prompt",
                    prompts=[{"name": "judge", "path": "prompts/judge"}],
                ),
                handler=None,
            ),
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "SKILL_PACKAGE_PROMPT_ASSET_INVALID"
    assert "prompts/judge/prompt.yaml" in payload["details"]["missing_files"]
    assert "prompts/judge/prompt.md" in payload["details"]["missing_files"]


def test_v1_prompt_skill_registers_prompt_assets_and_hash(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    uploaded = client.post(
        "/skills/packages/upload",
        json={
            "filename": "prompt-v1.zip",
            "content_base64": _package_zip(
                manifest=_v1_manifest(
                    "plugin.prompt_v1@0.1.0",
                    skill_type="prompt",
                    prompts=[{"name": "judge", "path": "prompts/judge"}],
                ),
                handler=None,
                prompts={
                    "judge": {
                        "yaml": {
                            "name": "judge",
                            "input_variables": {
                                "text": {"type": "string"},
                            },
                            "output_schema": _echo_output_schema(),
                            "model_policy": {"allowed_aliases": ["test.judge"]},
                            "retry_policy": {"max_retries": 0},
                        },
                        "markdown": "Judge {{ text }} and return JSON.",
                    }
                },
            ),
        },
    ).json()

    assets = uploaded["prompt_assets"]
    assert len(assets) == 1
    assert assets[0]["name"] == "judge"
    assert assets[0]["prompt_hash"]
    assert assets[0]["output_schema"]["required"] == ["echo", "context_has_skill"]


def test_skill_package_rejects_symlink_executable_binary_and_direct_model_sdk(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.post(
        "/skills/packages/upload",
        json={
            "filename": "unsafe.zip",
            "content_base64": _package_zip(
                manifest=_v1_manifest("plugin.unsafe@0.1.0", skill_type="code"),
                handler="import openai\n\ndef run(input_data, context):\n    return {'echo': input_data['text']}\n",
                extra_files={
                    "bin/tool.exe": b"MZ\x00\x00",
                    "bin/link": b"target",
                },
                symlink_names={"bin/link"},
            ),
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "SKILL_PACKAGE_UNSAFE_CONTENT"
    assert "bin/tool.exe" in payload["details"]["executable_binaries"]
    assert "bin/link" in payload["details"]["symlinks"]
    assert payload["details"]["direct_model_sdk_calls"] == ["handler.py"]


def test_phase1_example_packages_upload_contract_approve_and_run(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    examples_root = Path("examples/skill_packages")

    expected_skill_ids = {
        "prompt_skill_v1": "example.prompt_judge@0.1.0",
        "code_skill_v1": "example.code_echo@0.1.0",
        "hybrid_skill_a_v1": "example.hybrid_judge_review@0.1.0",
    }
    for package_dir, skill_id in expected_skill_ids.items():
        uploaded = client.post(
            "/skills/packages/upload",
            json={"filename": f"{package_dir}.zip", "content_base64": _zip_directory(examples_root / package_dir)},
        ).json()
        assert uploaded["manifest"]["skill_id"] == skill_id

        contract = client.post(f"/skills/{skill_id}/contract-test").json()
        assert contract["ok"] is True

        approved = client.post(f"/skills/{skill_id}/approve", json={"reason": "phase1 example"}).json()
        assert approved["status"] == "approved"


def _v1_manifest(skill_id: str, *, skill_type: str, prompts: list[dict[str, str]] | None = None) -> dict[str, object]:
    return {
        "schema_version": 1,
        "skill_id": skill_id,
        "name": skill_id,
        "version": "0.1.0",
        "description": "v1 package",
        "type": skill_type,
        "category": "judge",
        "runtime": {"kind": "python", "entrypoint": "handler.py"},
        "prompts": prompts or [],
        "llm_permissions": {
            "allowed_prompt_names": [item["name"] for item in prompts or []],
            "allowed_model_aliases": ["test.judge"],
            "max_calls_per_run": 2,
            "max_tokens_per_run": 1000,
        },
        "limits": {"timeout_seconds": 60},
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output_schema": _echo_output_schema(),
        "config_schema": {"type": "object"},
        "example_input": {"text": "hello"},
        "example_config": {},
    }


def _echo_output_schema() -> dict[str, object]:
    return {
        "type": "object",
        "properties": {"echo": {"type": "string"}, "context_has_skill": {"type": "boolean"}},
        "required": ["echo", "context_has_skill"],
    }


def _package_zip(
    *,
    manifest: dict[str, object],
    handler: str | None,
    prompts: dict[str, dict[str, object]] | None = None,
    extra_files: dict[str, bytes] | None = None,
    symlink_names: set[str] | None = None,
) -> str:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        if handler is not None:
            archive.writestr("handler.py", handler)
        for name, prompt in (prompts or {}).items():
            archive.writestr(f"prompts/{name}/prompt.yaml", json.dumps(prompt["yaml"], ensure_ascii=False))
            archive.writestr(f"prompts/{name}/prompt.md", str(prompt["markdown"]))
        for path, content in (extra_files or {}).items():
            info = archive.writestr(path, content)
            if symlink_names and path in symlink_names:
                # zipfile returns None from writestr, so set symlink attributes through getinfo.
                archive.getinfo(path).external_attr = 0o120777 << 16
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _zip_directory(root: Path) -> str:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    return base64.b64encode(buffer.getvalue()).decode("ascii")
