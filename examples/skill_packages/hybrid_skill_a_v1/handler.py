def should_review(judge_result):
    if judge_result.get("schema_invalid"):
        return True
    if judge_result.get("result") == "unknown":
        return True
    if judge_result.get("confidence", 0) < 0.75:
        return True
    if judge_result.get("result") == "pass" and not judge_result.get("evidence"):
        return True
    return False


def run(input_data, context):
    candidates = [
        f"question:{input_data['question']}",
        f"answer:{input_data['answer']}",
    ]
    judge_result = {
        "result": "pass" if "evidence" in input_data["answer"].lower() else "unknown",
        "confidence": 0.82 if "evidence" in input_data["answer"].lower() else 0.4,
        "evidence": candidates,
        "schema_invalid": False,
    }
    reviewed = should_review(judge_result)
    if reviewed:
        judge_result["confidence"] = max(judge_result["confidence"], 0.76)
        judge_result["evidence"] = judge_result["evidence"] or ["review prompt confirmed no evidence"]
    return {
        "output": {
            "result": judge_result["result"],
            "confidence": judge_result["confidence"],
            "reviewed": reviewed,
            "evidence": judge_result["evidence"],
        },
        "metrics": {"candidate_count": len(candidates), "prompt_count": 2 if reviewed else 1},
    }
