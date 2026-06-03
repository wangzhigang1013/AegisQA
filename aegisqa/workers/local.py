from __future__ import annotations

from collections import deque

from aegisqa.engine.runner import WorkflowRunner


class LocalRunWorker:
    """Single-process worker for local persistent trials.

    It consumes run IDs and delegates execution to WorkflowRunner. This keeps the
    API/worker boundary explicit without requiring Redis/Celery in local mode.
    """

    def __init__(self, runner: WorkflowRunner) -> None:
        self.runner = runner
        self._queue: deque[str] = deque()

    def enqueue_run(self, run_id: str) -> dict[str, str]:
        if run_id in self._queue:
            return {"run_id": run_id, "status": "queued"}
        self._queue.append(run_id)
        return {"run_id": run_id, "status": "queued"}

    def pending_runs(self) -> list[str]:
        return list(self._queue)

    def run_once(self) -> dict[str, object]:
        if not self._queue:
            return {"status": "idle", "processed_items": 0}
        run_id = self._queue.popleft()
        run, processed_items = self.runner.execute_next_item(run_id)
        if run.status == "running" and any(item.status == "pending" for item in run.items):
            self.enqueue_run(run.run_id)
        return {"run_id": run.run_id, "status": run.status, "run_status": run.status, "processed_items": processed_items}
