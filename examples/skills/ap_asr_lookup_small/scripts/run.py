from __future__ import annotations

import csv
from pathlib import Path


def run(inputs, config):
    ap_code = str(inputs["ap_code"]).strip()
    fallback = str((config or {}).get("fallback_text") or "")
    data_path = Path(__file__).resolve().parents[1] / "data" / "ap_cache_sample.csv"

    # 脚本型 Skill 只能读取包内资源；这里用入口文件定位包根目录，避免依赖绝对路径。
    with data_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if str(row.get("ap_code", "")).strip() == ap_code:
                text = str(row.get("text", ""))
                return {
                    "output": {"ap_code": ap_code, "text": text, "found": True},
                    "metrics": {"lookup_hit": 1},
                    "artifacts": {},
                    "logs": ["ap_code 命中包内 CSV"],
                }

    return {
        "output": {"ap_code": ap_code, "text": fallback, "found": False},
        "metrics": {"lookup_hit": 0},
        "artifacts": {},
        "logs": ["ap_code 未命中包内 CSV"],
    }
