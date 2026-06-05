import json

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_dataset_upload_persists_source_file_in_artifact_store(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    content = json.dumps({"question": "Q1", "expected_label": "pass"}, ensure_ascii=False) + "\n"

    dataset = client.post(
        "/datasets/upload",
        json={
            "name": "artifact_dataset",
            "filename": "artifact_dataset.jsonl",
            "content": content,
            "golden": True,
            "label_field": "expected_label",
        },
    ).json()

    artifact = dataset["source_ref"]["artifact"]
    assert artifact["kind"] == "uploaded_datasets"
    assert artifact["artifact_id"] == f"datasets/{dataset['dataset_id']}/v{dataset['version']}/source.jsonl"
    assert artifact["metadata"]["dataset_version_id"] == dataset["version_id"]
    saved_content = client.app.state.artifact_store.read_bytes(artifact["kind"], artifact["artifact_id"]).decode("utf-8")
    assert saved_content == content

    stored = client.get(f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}").json()
    assert stored["source_ref"]["artifact"]["sha256"] == artifact["sha256"]
