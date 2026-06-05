import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_dataset_quality_diagnosis_and_repair_version_keep_lineage(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "dataset_quality.jsonl"
    rows = [
        {"question": "q1", "reference": "r1", "expected_label": "pass", "scene": "payment"},
        {"question": "q2", "reference": None, "expected_label": "fail", "scene": "payment"},
        {"question": "q2", "reference": None, "expected_label": "fail", "scene": "payment"},
        {"question": "q4", "expected_label": "pass", "scene": ""},
    ]
    data_path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows), encoding="utf-8")
    dataset = client.post(
        "/datasets/from-path",
        json={"name": "dataset_quality", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()

    quality_response = client.get(f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/quality")

    assert quality_response.status_code == 200
    quality = quality_response.json()
    assert quality["dataset_version_id"] == dataset["version_id"]
    assert quality["summary"]["row_count"] == 4
    assert quality["summary"]["duplicate_row_count"] == 1
    assert quality["summary"]["duplicate_rate"] == 0.25
    reference = next(field for field in quality["fields"] if field["field"] == "reference")
    assert reference["missing_count"] == 3
    assert reference["coverage_rate"] == 0.25
    assert reference["recommendation"]["action"] == "fill_missing"
    assert quality["duplicate_groups"][0]["row_ids"] == ["2", "3"]

    repaired_response = client.post(
        f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/repair-version",
        json={
            "drop_duplicate_rows": True,
            "fill_missing": {"reference": "待补充"},
            "reason": "根据字段治理诊断补齐 reference 并去重。",
        },
    )

    assert repaired_response.status_code == 200
    repaired = repaired_response.json()
    assert repaired["version"] == 2
    assert repaired["row_count"] == 3
    lineage = client.get(f"/datasets/{repaired['dataset_id']}/versions/{repaired['version']}/lineage").json()
    assert lineage["source"]["type"] == "dataset_repair"
    assert lineage["source"]["ref"]["parent_version_id"] == dataset["version_id"]
    repaired_quality = client.get(f"/datasets/{repaired['dataset_id']}/versions/{repaired['version']}/quality").json()
    repaired_reference = next(field for field in repaired_quality["fields"] if field["field"] == "reference")
    assert repaired_quality["summary"]["duplicate_row_count"] == 0
    assert repaired_reference["missing_count"] == 0
