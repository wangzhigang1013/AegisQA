# Skill Package Spec v1

## Goal

Skill Package v1 makes package capability explicit before runtime execution. A package declares whether it is a `prompt`, `code`, or `hybrid` skill, which prompt assets it owns, which model aliases it may call, and what limits the platform must enforce.

Legacy packages remain valid. A manifest without `schema_version` is treated as `schema_version: 0`, `type: code`, and `category: legacy`.

## Package Layout

```text
skill.json | skill.yaml
handler.py                       # required for code/hybrid, optional for prompt before LLM Gateway
prompts/<name>/prompt.yaml       # required for each declared prompt
prompts/<name>/prompt.md         # required for each declared prompt
prompts/<name>/output_schema.json # optional override
```

## Manifest Fields

- `schema_version`: `1` for v1 packages.
- `type`: one of `prompt`, `code`, `hybrid`.
- `category`: business role such as `judge`, `extractor`, `aggregator`, `source`, `transformer`, or `reporter`.
- `runtime`: runtime descriptor. The first implementation supports Python `handler.py`.
- `prompts`: prompt assets owned by this package, each with `name` and `path`.
- `llm_permissions`: allowed prompt names, model aliases, and per-run call/token limits.
- `limits`: package runtime limits such as `timeout_seconds`.
- Existing fields remain required for execution contracts: `skill_id`, `name`, `version`, `description`, `input_schema`, `output_schema`, `config_schema`, `example_input`, and `example_config`.

## Prompt Manifest

Each `prompt.yaml` must declare:

- `input_variables`
- `output_schema`
- `model_policy`
- `retry_policy`

The platform stores a stable prompt hash derived from `prompt.yaml` and `prompt.md`.

## Security Rules

Upload validation rejects path traversal, absolute paths, symlinks, executable binaries, excessive package size, excessive file count, and excessive extracted size. Direct model SDK imports are recorded as warnings because production execution must go through the platform LLM Gateway.

## Entrypoints

Legacy packages continue to expose:

```python
def run(inputs, config):
    ...
```

v1 `code` and `hybrid` packages expose:

```python
def run(input_data, context):
    ...
```

`context` includes `skill_id`, `skill_version`, `schema_version`, `type`, `category`, `config`, `llm_permissions`, and `limits`.
