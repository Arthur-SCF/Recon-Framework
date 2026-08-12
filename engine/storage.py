"""
Storage helpers for pipeline execution.

  save_raw_output()  — persist stdout/stderr/meta to /data/scans/...
  run_subprocess()   — async subprocess with SIGTERM+SIGKILL timeout
  check_disk_space() — returns (used_pct, free_bytes); auto-pause threshold
  cleanup_old_sessions() — delete oldest session dirs beyond retention_runs
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from engine.pipeline.base import StepContext

log = logging.getLogger("engine.storage")

# Auto-pause scan when disk usage exceeds this threshold
DISK_PAUSE_THRESHOLD_PCT = 90.0

# Data root — matches Docker volume mount
DATA_ROOT = Path(os.environ.get("DATA_DIR", "/data"))

# Hard caps on captured subprocess output read back into worker RAM.
# Child output is redirected to disk (below); only these many bytes are ever
# loaded into the process, so a tool with unbounded output (e.g. `gau --subs`
# on a large domain) cannot grow the worker heap past this bound.
_MAX_STDOUT_BYTES = 200 * 1024 * 1024
_MAX_STDERR_BYTES = 4 * 1024 * 1024

# Disk-backed scratch dir for subprocess capture files. MUST be on the /data
# volume, not /tmp — /tmp is tmpfs (RAM) and would still count against the
# container memory cgroup, defeating the purpose.
_SUBPROC_TMP = DATA_ROOT / "tmp"


def _read_capped(path: Path, cap: int) -> str:
    """Read at most `cap` bytes from `path`, utf-8 decoded. Bounds memory."""
    try:
        with open(path, "rb") as fh:
            data = fh.read(cap + 1)
    except OSError:
        return ""
    if len(data) > cap:
        data = data[:cap]
        log.warning("run_subprocess: captured output truncated to %d bytes (%s)", cap, path.name)
    return data.decode("utf-8", errors="replace")


# ── Subprocess execution ───────────────────────────────────────────────────────

async def run_subprocess(
    cmd: list[str],
    timeout: int = 600,
    cwd: str | None = None,
    env: dict | None = None,
) -> tuple[str, str, int]:
    """
    Run an external command as a subprocess (shell=False, always).

    Returns (stdout, stderr, returncode).
    On timeout: sends SIGTERM, waits 5s, then SIGKILL. Returns returncode -9,
    preserving whatever partial output the tool wrote.

    Memory: child stdout/stderr are redirected to disk files and read back with
    a hard byte cap (_MAX_STDOUT_BYTES/_MAX_STDERR_BYTES), so the worker never
    buffers a tool's full output in RAM.

    Security: shell=False is enforced by asyncio.create_subprocess_exec.
    Never pass user input into cmd without prior validation.
    """
    try:
        _SUBPROC_TMP.mkdir(parents=True, exist_ok=True)
        tmp_dir = str(_SUBPROC_TMP)
    except OSError:
        tmp_dir = tempfile.gettempdir()

    out_fd, out_name = tempfile.mkstemp(prefix="subproc_out_", suffix=".bin", dir=tmp_dir)
    err_fd, err_name = tempfile.mkstemp(prefix="subproc_err_", suffix=".bin", dir=tmp_dir)
    out_path, err_path = Path(out_name), Path(err_name)

    async def _kill(process) -> None:
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            log.warning("SIGTERM ignored — sending SIGKILL to %s", cmd[0])
            process.kill()
            await process.wait()

    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=out_fd, stderr=err_fd, cwd=cwd, env=env,
        )
        os.close(out_fd); out_fd = -1
        os.close(err_fd); err_fd = -1

        try:
            await asyncio.wait_for(process.wait(), timeout=timeout)
            return (
                _read_capped(out_path, _MAX_STDOUT_BYTES),
                _read_capped(err_path, _MAX_STDERR_BYTES),
                process.returncode or 0,
            )
        except asyncio.TimeoutError:
            log.warning("Process %s timed out after %ds — sending SIGTERM", cmd[0], timeout)
            await _kill(process)
            err = _read_capped(err_path, _MAX_STDERR_BYTES)
            marker = f"Process killed after {timeout}s timeout"
            return (
                _read_capped(out_path, _MAX_STDOUT_BYTES),
                f"{err}\n{marker}" if err else marker,
                -9,
            )
        except asyncio.CancelledError:
            log.info("run_subprocess: CancelledError — killing %s", cmd[0])
            await _kill(process)
            raise
    finally:
        for fd in (out_fd, err_fd):
            if fd is not None and fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
        for path in (out_path, err_path):
            try:
                path.unlink()
            except OSError:
                pass


# ── Raw output persistence ─────────────────────────────────────────────────────

async def save_raw_output(
    ctx: "StepContext",
    cmd: list[str],
    stdout: str,
    stderr: str,
    status: str,
    elapsed: float,
    data: dict,
) -> None:
    """
    Write stdout.txt, stderr.txt, and meta.json to
    /data/scans/<domain>/<session_id>/<step_id>/
    """
    step_dir = DATA_ROOT / "scans" / ctx.domain / ctx.session_id / ctx.step_id
    try:
        step_dir.mkdir(parents=True, exist_ok=True)

        if stdout:
            (step_dir / "stdout.txt").write_text(stdout, encoding="utf-8")
        if stderr:
            (step_dir / "stderr.txt").write_text(stderr, encoding="utf-8")

        meta = {
            "step_id":        ctx.step_id,
            "step_run_id":    ctx.step_run_id,
            "session_id":     ctx.session_id,
            "target_id":      ctx.target_id,
            "domain":         ctx.domain,
            "command":        cmd,
            "status":         status,
            "execution_time": round(elapsed, 3),
            "result_count":   data.get("count", 0),
            "recorded_at":    _now_iso(),
        }
        (step_dir / "meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        log.error("Failed to save raw output for %s/%s: %s", ctx.session_id, ctx.step_id, exc)


def _safe_scan_path(domain: str, session_id: str, step_id: str, filename: str) -> Path | None:
    """Build a path under DATA_ROOT/scans/ with traversal guard. Returns None if unsafe."""
    base = (DATA_ROOT / "scans").resolve()
    target = (base / domain / session_id / step_id / filename).resolve()
    if not target.is_relative_to(base):
        log.warning("Path traversal blocked: %s/%s/%s/%s", domain, session_id, step_id, filename)
        return None
    return target


def read_stdout(domain: str, session_id: str, step_id: str) -> str | None:
    """Return stdout content for a step run, or None if not found."""
    path = _safe_scan_path(domain, session_id, step_id, "stdout.txt")
    if path and path.exists():
        return path.read_text(encoding="utf-8", errors="replace")
    return None


def read_stderr(domain: str, session_id: str, step_id: str) -> str | None:
    """Return stderr content for a step run, or None if not found."""
    path = _safe_scan_path(domain, session_id, step_id, "stderr.txt")
    if path and path.exists():
        return path.read_text(encoding="utf-8", errors="replace")
    return None


# ── Disk space monitoring ──────────────────────────────────────────────────────

def check_disk_space(path: str | Path = DATA_ROOT) -> tuple[float, int]:
    """
    Returns (used_pct: float, free_bytes: int) for the filesystem at `path`.
    Raises OSError if the path doesn't exist.
    """
    usage = shutil.disk_usage(str(path))
    used_pct = (usage.used / usage.total) * 100
    return round(used_pct, 1), usage.free


def is_disk_full() -> bool:
    """Return True if disk usage exceeds DISK_PAUSE_THRESHOLD_PCT."""
    try:
        used_pct, _ = check_disk_space()
        return used_pct >= DISK_PAUSE_THRESHOLD_PCT
    except OSError:
        return False


# ── Session cleanup ────────────────────────────────────────────────────────────

async def cleanup_old_sessions(domain: str, target_id: str, db, retention_runs: int) -> int:
    """
    Delete the oldest session directories for a domain, keeping only
    `retention_runs` most recent sessions.

    Returns number of sessions deleted.
    """
    rows = await db.fetchall(
        """
        SELECT id, started_at FROM scan_sessions
        WHERE target_id = ?
          AND status IN ('completed', 'cancelled', 'error')
        ORDER BY started_at ASC
        """,
        (target_id,),
    )

    to_delete = rows[: max(0, len(rows) - retention_runs)]
    deleted = 0
    for row in to_delete:
        session_id = row["id"]
        session_dir = DATA_ROOT / "scans" / domain / session_id
        if session_dir.exists():
            try:
                shutil.rmtree(session_dir)
                log.info("Deleted old session dir: %s", session_dir)
                deleted += 1
            except OSError as exc:
                log.error("Failed to delete session dir %s: %s", session_dir, exc)

    return deleted


# ── Utilities ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
