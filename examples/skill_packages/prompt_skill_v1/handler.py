def run(input_data, context):
    text = input_data["text"]
    verdict = "pass" if text.strip() else "unknown"
    return {
        "output": {
            "verdict": verdict,
            "evidence": f"mock prompt judge saw {len(text)} characters",
        },
        "metrics": {"prompt_runtime": "test_provider"},
    }
