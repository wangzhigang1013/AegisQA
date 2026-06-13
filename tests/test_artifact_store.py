from pathlib import Path

import pytest

from aegisqa.api.app import create_app
from aegisqa.storage.artifacts import ArtifactStoreError, LocalArtifactStore


def test_local_artifact_store_writes_bytes_and_metadata(tmp_path: Path) -> None:
    store = LocalArtifactStore(tmp_path / "artifacts", max_artifact_bytes=128)

    metadata = store.put_bytes(
        "repro_bundles",
        "run-1/item-1/bundle.json",
        b'{"ok": true}',
        content_type="application/json",
        metadata={"run_id": "run-1", "item_id": "item-1"},
    )

    assert store.read_bytes("repro_bundles", "run-1/item-1/bundle.json") == b'{"ok": true}'
    loaded = store.get_metadata("repro_bundles", "run-1/item-1/bundle.json")

    assert loaded == metadata
    assert metadata.kind == "repro_bundles"
    assert metadata.artifact_id == "run-1/item-1/bundle.json"
    assert metadata.size_bytes == len(b'{"ok": true}')
    assert metadata.content_type == "application/json"
    assert metadata.metadata == {"run_id": "run-1", "item_id": "item-1"}
    assert metadata.storage_path == "repro_bundles/run-1/item-1/bundle.json"
    assert not Path(metadata.storage_path).is_absolute()


@pytest.mark.parametrize(
    "artifact_id",
    [
        "../escape.json",
        "safe/../../escape.json",
        "/absolute/escape.json",
        "C:/absolute/escape.json",
        r"..\escape.json",
    ],
)
def test_local_artifact_store_rejects_unsafe_artifact_paths(tmp_path: Path, artifact_id: str) -> None:
    store = LocalArtifactStore(tmp_path / "artifacts")

    with pytest.raises(ArtifactStoreError) as exc:
        store.put_bytes("reports", artifact_id, b"unsafe")

    assert exc.value.code == "ARTIFACT_PATH_INVALID"


def test_local_artifact_store_rejects_oversized_payload(tmp_path: Path) -> None:
    store = LocalArtifactStore(tmp_path / "artifacts", max_artifact_bytes=4)

    with pytest.raises(ArtifactStoreError) as exc:
        store.put_bytes("raw_llm_responses", "run-1/response.json", b"12345")

    assert exc.value.code == "ARTIFACT_TOO_LARGE"
    assert not (tmp_path / "artifacts" / "raw_llm_responses" / "run-1" / "response.json").exists()


def test_create_app_exposes_local_artifact_store(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")

    metadata = app.state.artifact_store.put_bytes("reports", "task-1/report.json", b"{}")

    assert isinstance(app.state.artifact_store, LocalArtifactStore)
    assert metadata.storage_path == "reports/task-1/report.json"
    assert (tmp_path / "store" / "artifacts" / "reports" / "task-1" / "report.json").exists()
