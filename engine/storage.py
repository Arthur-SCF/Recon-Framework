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
    On timeout: sends SIGTERM, waits 5s, then SIGKILL. Returns returncode -9.

    Security: shell=False is enforced by asyncio.create_subprocess_exec.
    Never pass user input into cmd without prior validation.
    """
    # shell=False: using create_subprocess_exec, not create_subprocess_shell
    _spawn = asyncio.create_subprocess_exec
    process = await _spawn(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        env=env,
    )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            process.communicate(), timeout=timeout
        )
        return (
            stdout_bytes.decode("utf-8", errors="replace"),
            stderr_bytes.decode("utf-8", errors="replace"),
            process.returncode or 0,
        )
    except asyncio.TimeoutError:
        log.warning("Process %s timed out after %ds — sending SIGTERM", cmd[0], timeout)
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            log.warning("SIGTERM ignored — sending SIGKILL to %s", cmd[0])
            process.kill()
            await process.wait()
        return ("", f"Process killed after {timeout}s timeout", -9)
    except asyncio.CancelledError:
        # User-requested skip: kill subprocess cleanly, then re-raise so the
        # runner can catch it and mark the step as SKIPPED.
        log.info("run_subprocess: CancelledError — killing %s", cmd[0])
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
        raise


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
