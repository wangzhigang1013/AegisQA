"""跨平台锁文件。

本地 JSON Store 只是 demo 存储，但在前后端联调、Playwright 并发和多线程
测试中仍会出现多个写入同时落到同一个文件的情况。这里用“进程内线程锁 +
独占创建 .lock 文件”的组合，覆盖单进程多线程与多进程本地开发场景。
"""

from __future__ import annotations

import os
from pathlib import Path
from threading import Lock, RLock
from time import monotonic, sleep


_PROCESS_LOCKS: dict[Path, RLock] = {}
_PROCESS_LOCKS_GUARD = Lock()


class FileLock:
    """用独占 lock 文件保护一个目标文件的临界区。"""

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
        """获取锁；超时说明有其他进程长期占用或残留锁文件。"""

        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._thread_lock.acquire()
        deadline = monotonic() + self.timeout_seconds
        try:
            while True:
                try:
                    # O_EXCL + O_CREAT 在 Windows/Linux/macOS 上都能保证同一时刻只有一个创建者。
                    self._fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                    os.write(self._fd, f"pid={os.getpid()}\n".encode("utf-8"))
                    self._acquired = True
                    return self
                except FileExistsError:
                    if monotonic() >= deadline:
                        raise TimeoutError(f"等待文件锁超时：{self.lock_path}")
                    sleep(self.poll_interval_seconds)
        except BaseException:
            self._thread_lock.release()
            raise

    def release(self) -> None:
        """释放锁并清理 lock 文件。"""

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
    """同一进程内先串行化，避免多个线程反复轮询同一个 lock 文件。"""

    key = lock_path.resolve()
    with _PROCESS_LOCKS_GUARD:
        if key not in _PROCESS_LOCKS:
            _PROCESS_LOCKS[key] = RLock()
        return _PROCESS_LOCKS[key]
