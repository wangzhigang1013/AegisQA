"""Cross-platform file lock.

Local JSON Store is just a demo storage, but during front-end/back-end integration,
Playwright concurrency and multi-thread testing, multiple writers may hit the same file.
This module uses "in-process thread lock + exclusive .lock file creation" combination
to cover single-process multi-thread and multi-process local development scenarios.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from threading import Lock, RLock
from time import monotonic, sleep

logger = logging.getLogger(__name__)

_PROCESS_LOCKS: dict[Path, RLock] = {}
_PROCESS_LOCKS_GUARD = Lock()


class FileLock:
    """Protect a critical section of a target file with an exclusive lock file."""

    def __init__(self, lock_path: Path | str, *, timeout_seconds: float = 10.0, poll_interval_seconds: float = 0.01) -> None:
        self.lock_path = Path(lock_path)
        self.timeout_seconds = timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self._thread_lock = _process_lock_for(self.lock_path)
        self._fd: int | None = None
        self._acquired = False

    def __enter__(self) -> "FileLock":
        return self.acquire()

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.release()

    def acquire(self) -> "FileLock":
        """Acquire the lock; timeout means another process is holding or stale lock file exists."""

        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._thread_lock.acquire()
        deadline = monotonic() + self.timeout_seconds
        try:
            while True:
                try:
                    # O_EXCL + O_CREAT ensures only one creator at a time on Windows/Linux/macOS.
                    self._fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                    os.write(self._fd, f"pid={os.getpid()}\n".encode("utf-8"))
                    self._acquired = True
                    return self
                except FileExistsError:
                    # Try to clean up stale lock (process that held it has exited)
                    if self._try_cleanup_stale_lock():
                        continue
                    if monotonic() >= deadline:
                        raise TimeoutError(f"File lock timeout: {self.lock_path}")
                    sleep(self.poll_interval_seconds)
        except BaseException:
            self._thread_lock.release()
            raise

    def _try_cleanup_stale_lock(self) -> bool:
        """Try to clean up stale lock file if the owning process has exited."""
        try:
            content = self.lock_path.read_text(encoding="utf-8").strip()
            if not content.startswith("pid="):
                return False
            pid = int(content.split("=")[1])
            if _is_process_alive(pid):
                return False
            logger.info("Cleaning stale lock file %s (pid=%d is dead)", self.lock_path, pid)
            self.lock_path.unlink(missing_ok=True)
            return True
        except (OSError, ValueError):
            return False

    def release(self) -> None:
        """Release lock and clean up lock file."""

        if not self._acquired:
            return
        try:
            if self._fd is not None:
                os.close(self._fd)
                self._fd = None
        finally:
            try:
                self.lock_path.unlink()
            except FileNotFoundError:
                pass
            self._acquired = False
            self._thread_lock.release()


def _process_lock_for(lock_path: Path) -> RLock:
    """Serialize within the same process first, avoiding multiple threads polling the same lock file."""

    key = lock_path.resolve()
    with _PROCESS_LOCKS_GUARD:
        if key not in _PROCESS_LOCKS:
            _PROCESS_LOCKS[key] = RLock()
        return _PROCESS_LOCKS[key]


def _is_process_alive(pid: int) -> bool:
    """Check if a process with the given PID is still running."""
    try:
        if os.name == "nt":
            # Windows: use tasklist to check process
            import subprocess
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            return str(pid) in result.stdout
        else:
            # Unix: use os.kill(pid, 0) to check process
            os.kill(pid, 0)
            return True
    except (OSError, Exception):
        return False
