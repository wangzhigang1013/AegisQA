"""
试驾算法结果获取 Skill

根据 AP/AT/PATC 编号获取试驾算法 5 个模块的完整评测数据。
"""

from __future__ import annotations

import json
import os


def _load_from_cache(code: str, cache_file: str = "") -> dict | None:
    """从本地缓存文件查询数据"""
    if not cache_file or not os.path.exists(cache_file):
        return None

    code_upper = code.strip().upper()
    with open(cache_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ap = str(entry.get("ap_code", "")).strip().upper()
                at = str(entry.get("at_code", "")).strip().upper()
                task = str(entry.get("task_id", "")).strip().upper()

                if (code_upper.startswith("AP") and ap == code_upper) or \
                   (code_upper.startswith("AT") and at == code_upper) or \
                   (code_upper.startswith("PATC") and task == code_upper):
                    return entry
            except json.JSONDecodeError:
                continue
    return None


def _fetch_from_api(code: str, api_base: str) -> dict:
    """调用接口获取算法数据"""
    import requests

    code_upper = code.strip().upper()
    headers = {
        "User-Agent": "Apifox/1.0.0",
        "Accept": "*/*",
    }

    session = requests.Session()
    session.headers.update(headers)

    try:
        # Step 1: AP → AT
        if code_upper.startswith("AP"):
            url = f"{api_base}/chj-service-rb/chj-service-rb/api/rb-attempt-drive-record/get-attempts-by-appoint"
            resp = session.get(url, params={"appointCode": code}, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("data")
            target = raw[0] if isinstance(raw, list) and raw else raw
            if not target:
                raise ValueError(f"未找到试驾单信息: {code}")

            attempt_code = str(target.get("attemptCode", "")).strip()
            employee_id = str(target.get("employeeAccountId", "")).strip()
            ap_code = code
        elif code_upper.startswith("AT"):
            attempt_code = code
            employee_id = ""
            ap_code = ""
        else:
            raise ValueError(f"不支持的编号格式: {code}（仅支持 AP/AT）")

        # Step 2: AT → TaskId + Record
        url = f"{api_base}/saos-dm-api/saos-dm-api/test-drive-quality/v1-1/findTestDriveQualityVoList"
        resp = session.get(url, params={"attemptCodeList": attempt_code}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("data") or []
        if not records:
            raise ValueError(f"未找到记录: {attempt_code}")

        record = records[0] if isinstance(records, list) else records
        report = record.get("testDriveQualityInspectionReport") or {}
        task_id = str(report.get("taskId", "")).strip()

        if not task_id:
            raise ValueError(f"未能提取 taskId: {attempt_code}")

        # 提取车型
        vehicle_name = ""
        concern_list = record.get("testDriveQualityConcernList") or []
        for concern in concern_list:
            if isinstance(concern, dict):
                vn = str(concern.get("vehicleName") or "").strip()
                if vn:
                    vehicle_name = vn
                    break

        # 提取 AP 编号
        if not ap_code:
            trace = record.get("dmAttemptDriveTrace") or {}
            ap_code = str(trace.get("appointCode", "")).strip()

        # 统计各模块数据量
        import json
        emotion = record.get("testDriveQualityEmotion") or {}
        positive = json.loads(emotion.get("positive", "[]")) if isinstance(emotion.get("positive"), str) else emotion.get("positive", [])
        negative = json.loads(emotion.get("negative", "[]")) if isinstance(emotion.get("negative"), str) else emotion.get("negative", [])

        return {
            "record": record,
            "task_id": task_id,
            "ap_code": ap_code,
            "at_code": attempt_code,
            "vehicle_name": vehicle_name,
            "employee_id": employee_id,
            "concern_count": len(concern_list),
            "emotion_positive_count": len(positive),
            "emotion_negative_count": len(negative),
        }

    finally:
        session.close()


def run(inputs, config):
    """Skill 入口函数"""
    code = str(inputs.get("code", "")).strip()
    offline = bool(inputs.get("offline", False))
    config = config or {}

    api_base = str(config.get("api_base") or "http://bcs-jedi-stub-service.prod.k8s.chehejia.com")
    cache_file = str(config.get("cache_file") or "")

    if not code:
        return {
            "output": {"found": False, "error": "code 参数为空"},
            "metrics": {},
            "artifacts": {},
            "logs": ["错误: code 参数为空"],
        }

    try:
        # 尝试从缓存加载
        cached = _load_from_cache(code, cache_file)
        if cached:
            record = cached.get("record", {})
            concern_list = record.get("testDriveQualityConcernList") or []
            return {
                "output": {
                    "record": record,
                    "task_id": cached.get("task_id", ""),
                    "ap_code": cached.get("ap_code", ""),
                    "at_code": cached.get("at_code", ""),
                    "vehicle_name": "",
                    "employee_id": "",
                    "concern_count": len(concern_list),
                    "emotion_positive_count": 0,
                    "emotion_negative_count": 0,
                    "found": True,
                    "error": "",
                },
                "metrics": {"cache_hit": 1},
                "artifacts": {},
                "logs": [f"缓存命中: {code}"],
            }

        # 离线模式
        if offline:
            return {
                "output": {"found": False, "error": f"离线模式缓存未命中: {code}"},
                "metrics": {"cache_hit": 0},
                "artifacts": {},
                "logs": [f"离线模式缓存未命中: {code}"],
            }

        # 调用接口
        result = _fetch_from_api(code, api_base)

        return {
            "output": {
                "record": result.get("record", {}),
                "task_id": result.get("task_id", ""),
                "ap_code": result.get("ap_code", ""),
                "at_code": result.get("at_code", ""),
                "vehicle_name": result.get("vehicle_name", ""),
                "employee_id": result.get("employee_id", ""),
                "concern_count": result.get("concern_count", 0),
                "emotion_positive_count": result.get("emotion_positive_count", 0),
                "emotion_negative_count": result.get("emotion_negative_count", 0),
                "found": True,
                "error": "",
            },
            "metrics": {"cache_hit": 0, "api_call": 1},
            "artifacts": {},
            "logs": [f"接口获取成功: {code} → {result.get('task_id', '')}"],
        }

    except Exception as e:
        return {
            "output": {"found": False, "error": str(e)},
            "metrics": {"error": 1},
            "artifacts": {},
            "logs": [f"获取失败: {code} - {e}"],
        }
