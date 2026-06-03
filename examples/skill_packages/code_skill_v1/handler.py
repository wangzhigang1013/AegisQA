def run(input_data, context):
    return {
        "output": {
            "echo": input_data["text"],
            "context_has_skill": bool(context.get("skill_id")),
        },
        "metrics": {"entrypoint": "v1"},
    }
