# Runtime Infrastructure v1

## Scope

Runtime Infrastructure v1 defines the local, reality-first execution baseline for AegisQA. It is intended for local persistent trials and debugging, not for production multi-tenant deployment.

The first version covers:

- metadata store boundary;
- artifact store boundary;
- local worker behavior;
- run state machine;
- Sandbox Lite guarantees and non-guarantees.

## Storage Boundary

`JsonStore` is dev-only. It is useful for local demos and quick debugging because records are easy to inspect on disk, but it does not provide database transactions, indexes, high-concurrency writes, or distributed consistency.

`SQLiteStore` is the supported local persistent trial backend. It keeps the same minimal store interface as `JsonStore` and is appropriate for single-machine trials where data should survive restarts.

Production direction is:

- PostgreSQL or MySQL for metadata such as Dataset, Skill, Workflow, Task, Run, Audit, Gate and Model Alias records;
- ArtifactStore or object storage for uploaded datasets, skill packages, rendered prompts, raw LLM responses, reports and repro bundles;
- queue-backed workers for asynchronous execution.

The API should not assume direct filesystem paths for production artifacts. Runtime objects should carry stable IDs and artifact URIs.

## ArtifactStore

`ArtifactStore` is the interface for large or replayable runtime assets. The current `LocalArtifactStore` stores artifacts under a configured local root and returns `local://` URIs.

Current guarantees:

- path traversal is rejected;
- artifact bytes can be written and read by URI;
- JSON artifacts can be written and read through helper methods;
- metadata includes content type, size and key.

Current intended artifact classes:

- uploaded dataset source files;
- skill packages;
- rendered prompts;
- raw LLM responses;
- generated reports;
- repro bundles.

Production replacement should implement the same interface over object storage or an equivalent blob store.

## Local Worker

`LocalRunWorker` is a single-process worker for local trials. It keeps an in-memory queue of `run_id` values and delegates execution to `WorkflowRunner.execute_next_item()`.

Behavior:

- `POST /runs` and `POST /tasks` enqueue the created Run;
- `GET /workers/local/status` returns `status=ready` and queued Run IDs;
- `POST /workers/local/run-once` processes at most one pending RunItem;
- if a Run still has pending items and remains running, it is re-enqueued;
- `pause` and `cancel` prevent new RunItems from starting;
- a running Step is allowed to finish before the runner stops launching later steps or items.

This local worker is intentionally explicit and debuggable. It is not a replacement for Celery, Redis, Kubernetes jobs, or another production worker system.

## State Machine

The runtime preserves legacy lowercase `status` fields for compatibility and exposes uppercase `state` fields for the rebuild runtime contract.

Run states:

- `PENDING`
- `QUEUED`
- `RUNNING`
- `PAUSED`
- `CANCEL_REQUESTED`
- `CANCELLED`
- `SUCCEEDED`
- `FAILED`
- `TIMEOUT`

RunItem states:

- `PENDING`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `SKIPPED`

Step states:

- `PENDING`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `SKIPPED`
- `TIMEOUT`
- `SCHEMA_INVALID`

Schema validation failures must preserve raw output, keep validated output empty, and expose `OUTPUT_SCHEMA_INVALID`.

## Sandbox Lite

Sandbox Lite applies to package Skill execution through `SubprocessPackageSkill`.

Current guarantees:

- package code runs in a short-lived subprocess, not imported into the FastAPI process;
- execution timeout is configurable and bounded;
- stdout output size has a hard safety limit;
- stdout and stderr returned to the API are truncated when too large;
- local package paths are cleaned from error output;
- subprocess working directory is isolated to the unpacked package directory;
- provider API keys, access tokens and secret-like environment variables are not injected into the subprocess;
- package validation warns on direct model SDK or API key usage patterns.

Current non-guarantees:

- no CPU quota;
- no memory quota;
- no network egress block;
- no dependency sandbox or virtual environment isolation;
- no package signature verification;
- no malware scanning;
- no OS-level container boundary.

Production Sandbox direction:

- run package execution in an isolated worker or container;
- enforce CPU, memory, wall-clock and output limits at the OS or orchestrator layer;
- restrict network egress by policy;
- inject platform services through narrow context APIs only;
- keep provider secrets outside package process environments.

## Operational Rules

- Missing real metrics must produce `skipped` or `unavailable`, not synthetic pass/fail results.
- Replay and repro bundle data should reference artifact URIs where payload size or retention matters.
- Local worker APIs are debugging controls; production should expose queue/worker health through a separate operations surface.
- Any production backend must keep the same public runtime semantics before replacing local implementations.
