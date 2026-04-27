"""
Scan scheduler — 10-second tick loop that picks the next target to scan.

Priority rules (highest → lowest):
  1. Manual queue (_manual_queue) — always drained first, LIFO.
  2. Auto-resume: auto-paused loop sessions whose preempting target has finished.
  3. Due scheduled targets (loop=0, rescan_interval elapsed).
  4. Loop targets (loop=1) — run only when nothing else is pending.

Loop mode:
  A loop target re-enters as a candidate immediately after completion (no
  rescan_interval wait).  It yields to any manual scan and any due scheduled
  target.  If a loop scan is running and a higher-priority target becomes due,
  the loop scan is preempted (auto-paused) at the next group boundary and
  auto-resumed once the preempting scan finishes.

Crash recovery:
  On startup, any session with status='running' is set to
  status='paused', pause_type='auto_recovery'.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone, timedelta

log = logging.getLogger("engine.scheduler")

# One scan at a time (8 GB RAM constraint from BRAINSTORM)
_active_session: str | None = None
_manual_queue:   list[str]  = []   # list of target_id strings
_tick_task:      asyncio.Task | None = None
_mode:           str         = "sequential"  # "sequential" | "priority"
_report_tick:    int         = 0   # incremented each tick, reports checked every 6 ticks (60s)
_loops_paused:   bool        = False  # when True, loop tier is skipped in _pick_next()
_queue_paused:   bool        = False  # when True, manual queue tier is frozen in _pick_next()


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def is_scheduled_target_due(row, now: datetime) -> bool:
    """
    Return True if a scheduled (non-loop, non-manual) target is due to run.

    Three schedule modes (schedule_mode column):
      • "hourly"  — every rescan_interval hours (legacy, default)
      • "daily"   — every schedule_days days, at schedule_hour:schedule_minute
      • "weekly"  — every schedule_weekday (0=Mon…6=Sun), at schedule_hour:schedule_minute
    """
    last_str = row["last_scan_at"]
    if not last_str:
        return True  # never scanned → always due

    last = datetime.fromisoformat(last_str.replace("Z", "+00:00"))
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)

    mode = row["schedule_mode"] if row["schedule_mode"] else "hourly"

    if mode == "hourly":
        hours = row["rescan_interval"] if row["rescan_interval"] else 24
        return (now - last).total_seconds() >= hours * 3600

    elif mode == "daily":
        days = row["schedule_days"] if row["schedule_days"] else 1
        hour = row["schedule_hour"] if row["schedule_hour"] is not None else 0
        minute = row["schedule_minute"] if row["schedule_minute"] is not None else 0
        # Must have waited at least `days` days
        if (now - last).total_seconds() < days * 86400:
            return False
        # Must be at or past the scheduled time of day today
        scheduled_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return now >= scheduled_today

    elif mode == "weekly":
        weekday = row["schedule_weekday"] if row["schedule_weekday"] is not None else 0
        hour = row["schedule_hour"] if row["schedule_hour"] is not None else 0
        minute = row["schedule_minute"] if row["schedule_minute"] is not None else 0
        # Must be the right weekday
        if now.weekday() != weekday:
            return False
        # Must be at or past the scheduled time
        scheduled_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if now < scheduled_today:
            return False
        # Must not have already run today
        return last.astimezone(timezone.utc).date() < now.date()

    return False


# ── Public API ─────────────────────────────────────────────────────────────────

def set_mode(mode: str) -> None:
    """Set scheduler mode. 'sequential' or 'priority'."""
    global _mode
    if mode not in ("sequential", "priority"):
        raise ValueError(f"Invalid scheduler mode: {mode!r}")
    _mode = mode
    log.info("Scheduler mode set to: %s", mode)


def get_mode() -> str:
    return _mode


def enqueue_manual(target_id: str) -> None:
    """Add a target to the front of the manual queue (if not already there)."""
    if target_id not in _manual_queue:
        _manual_queue.insert(0, target_id)
        log.info("Enqueued target %s for immediate scan", target_id)
        try:
            from engine.metrics import queue_depth
            queue_depth.set(len(_manual_queue))
        except Exception:
            pass


def get_queue() -> list[str]:
    return list(_manual_queue)


def remove_from_queue(target_id: str) -> bool:
    """Remove a target from the manual queue. Returns True if found and removed."""
    if target_id in _manual_queue:
        _manual_queue.remove(target_id)
        try:
            from engine.metrics import queue_depth
            queue_depth.set(len(_manual_queue))
        except Exception:
            pass
        return True
    return False


def get_active_session() -> str | None:
    return _active_session


def set_loops_paused(paused: bool) -> None:
    global _loops_paused
    _loops_paused = paused
    log.info("Loop scheduling %s", "paused" if paused else "resumed")


def get_loops_paused() -> bool:
    return _loops_paused


def set_queue_paused(paused: bool) -> None:
    global _queue_paused
    _queue_paused = paused
    log.info("Queue scheduling %s", "paused" if paused else "resumed")


def get_queue_paused() -> bool:
    return _queue_paused


def is_queue_paused() -> bool:
    return _queue_paused


def is_loops_paused() -> bool:
    return _loops_paused


async def should_preempt(db, current_target_id: str) -> tuple[bool, str | None]:
    """
    Check whether the running scan should be preempted by a higher-priority target.

    Only loop targets are preemptable.  Returns (True, preempting_target_id) when
    a manual scan is queued or a due scheduled (non-loop) target exists.
    """
    row = await db.fetchone(
        "SELECT loop FROM targets WHERE id=?", (current_target_id,)
    )
    if not row or not row["loop"]:
        return False, None

    # Manual queue always preempts — return the highest-priority queued target
    # (unless the queue itself is paused by the user)
    if not _queue_paused and _manual_queue:
        placeholders = ",".join("?" * len(_manual_queue))
        rows = await db.fetchall(
            f"SELECT id, scan_priority FROM targets WHERE id IN ({placeholders})",
            tuple(_manual_queue),
        )
        if rows:
            best = max(rows, key=lambda r: r["scan_priority"])
            return True, best["id"]
        return True, _manual_queue[0]

    # Any due non-loop scheduled target preempts
    preempt_candidates = await db.fetchall(
        """
        SELECT t.id, t.last_scan_at, t.rescan_interval, t.scan_priority,
               t.schedule_mode, t.schedule_days, t.schedule_weekday,
               t.schedule_hour, t.schedule_minute
        FROM targets t
        WHERE t.manual_only = 0
          AND t.loop = 0
          AND t.id != ?
          AND t.status NOT IN ('running', 'paused')
        ORDER BY t.scan_priority DESC, COALESCE(t.last_scan_at, '1970-01-01') ASC
        """,
        (current_target_id,),
    )
    now_utc = datetime.now(timezone.utc)
    for candidate in preempt_candidates:
        if is_scheduled_target_due(candidate, now_utc):
            return True, candidate["id"]

    return False, None


def start(db) -> None:
    """Start the scheduler tick loop. Called from app lifespan."""
    global _tick_task
    if _tick_task is None or _tick_task.done():
        _tick_task = asyncio.create_task(_tick_loop(db))
        log.info("Scheduler started")


def stop() -> None:
    """Cancel the tick loop."""
    global _tick_task
    if _tick_task and not _tick_task.done():
        _tick_task.cancel()
        log.info("Scheduler stopped")


# ── Crash recovery ─────────────────────────────────────────────────────────────

async def recover_running_sessions(db) -> None:
    """
    On startup: any session with status='running' means the app crashed mid-scan.
    Mark them as paused so the user can resume.
    """
    rows = await db.fetchall(
        "SELECT id, target_id FROM scan_sessions WHERE status = 'running'",
        (),
    )
    for row in rows:
        session_id = row["id"]
        target_id  = row["target_id"]
        log.warning(
            "Crash recovery: session %s (target %s) was running — marking paused",
            session_id[:8], target_id,
        )
        await db.execute(
            """
            UPDATE scan_sessions
            SET status='paused', pause_type='auto_recovery', paused_at=?
            WHERE id=?
            """,
            (_now(), session_id),
        )
        await db.execute(
            "UPDATE targets SET status='paused' WHERE id=?",
            (target_id,),
        )

    # Also clean up any step_runs that were mid-flight when the process died.
    await db.execute(
        """
        UPDATE step_runs SET status='error', finished_at=?
        WHERE status = 'running'
        """,
        (_now(),),
    )

    await db.commit()
    log.info("Crash recovery: %d session(s) marked as paused", len(rows))


# ── Tick loop ──────────────────────────────────────────────────────────────────

async def _tick_loop(db) -> None:
    """Run forever; check every 10 seconds if a scan should start."""
    global _report_tick
    # Load persisted scheduler mode from settings on first tick
    try:
        row = await db.fetchone(
            "SELECT value FROM settings WHERE key = 'scheduler.mode'"
        )
        if row and row["value"] in ("sequential", "priority"):
            set_mode(row["value"])
    except Exception as exc:
        log.warning("Could not load scheduler mode from DB: %s", exc)

    while True:
        try:
            await _tick(db)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("Scheduler tick error: %s", exc, exc_info=True)

        # Check report schedules every 6 ticks = 60 seconds
        _report_tick += 1
        if _report_tick % 6 == 0:
            try:
                from engine.reports import dispatch_scheduled_reports
                await dispatch_scheduled_reports(db)
            except Exception as exc:
                log.error("Report dispatch error: %s", exc)

        await asyncio.sleep(10)


async def _tick(db) -> None:
    global _active_session

    # DB-authoritative check: is ANY session currently running?
    running_row = await db.fetchone(
        "SELECT id FROM scan_sessions WHERE status = 'running' LIMIT 1", ()
    )
    if running_row:
        _active_session = running_row["id"]
        return

    # No session running — clear in-memory cache
    _active_session = None
    try:
        from engine.metrics import active_scans, queue_depth
        active_scans.set(0)
        queue_depth.set(len(_manual_queue))
    except Exception:
        pass

    # ── Auto-resume: loop sessions paused by a preempting target ──────────────
    # Only resumes the oldest auto-paused session whose preempter has finished.
    # (Re-check happens naturally on subsequent ticks if more preempters are due.)
    auto_paused = await db.fetchall(
        """
        SELECT id, target_id, resume_after, pause_type
        FROM scan_sessions
        WHERE status = 'paused'
          AND pause_type IN ('auto', 'queued_resume')
          AND resume_after IS NOT NULL
        ORDER BY paused_at ASC
        """,
        (),
    )
    for p in auto_paused:
        # pause_type='auto' means a loop scan was preempted mid-run.
        # If loops are globally paused, don't resume it — it stays paused until
        # the user resumes loops, at which point the next tick picks it up.
        # pause_type='queued_resume' is a non-loop scan waiting for the current
        # scan to finish; it is NOT affected by _loops_paused.
        if _loops_paused and p["pause_type"] == "auto":
            continue

        preempter = await db.fetchone(
            "SELECT status FROM targets WHERE id=?", (p["resume_after"],)
        )
        # Resume once the preempting target is no longer running or paused
        if preempter and preempter["status"] not in ("running", "paused"):
            await _resume_auto_paused(db, p["id"], p["target_id"])
            return

    # ── Pick the next target to scan ──────────────────────────────────────────
    target_id = await _pick_next(db)
    if target_id is None:
        return

    session_id = await _create_session(db, target_id)
    _active_session = session_id
    try:
        from engine.metrics import active_scans
        active_scans.set(1)
    except Exception:
        pass

    row = await db.fetchone(
        "SELECT domain FROM targets WHERE id=?", (target_id,)
    )
    if not row:
        _active_session = None
        return

    domain = row["domain"]
    log.info("Scheduler launching scan: target=%s domain=%s session=%s",
             target_id, domain, session_id[:8])

    from engine.pipeline.runner import run_pipeline
    asyncio.create_task(
        run_pipeline(db, session_id, target_id, domain),
        name=f"pipeline-{session_id[:8]}",
    )


async def _resume_auto_paused(db, session_id: str, target_id: str) -> None:
    """Resume a loop scan that was auto-paused by a higher-priority target."""
    global _active_session

    await db.execute(
        """
        UPDATE scan_sessions
        SET status='running', pause_type=NULL, paused_at=NULL, resume_after=NULL
        WHERE id=?
        """,
        (session_id,),
    )
    await db.execute(
        "UPDATE targets SET status='running' WHERE id=?",
        (target_id,),
    )
    await db.commit()
    _active_session = session_id

    try:
        from engine.metrics import active_scans
        active_scans.set(1)
    except Exception:
        pass

    row = await db.fetchone("SELECT domain FROM targets WHERE id=?", (target_id,))
    domain = row["domain"] if row else "unknown"

    log.info("Auto-resuming loop session %s for target %s (%s)",
             session_id[:8], target_id, domain)

    from engine.pipeline.runner import run_pipeline
    asyncio.create_task(
        run_pipeline(db, session_id, target_id, domain, is_resume=True),
        name=f"pipeline-{session_id[:8]}-resume",
    )


async def _pick_next(db) -> str | None:
    """
    Return the next target_id to scan, or None if nothing is ready.

    Priority:
    1. Manual queue — highest scan_priority first; ties broken by queue insertion order.
       Ineligible entries (deleted / already running) are purged on each tick.
    2. Due scheduled targets (loop=0, schedule elapsed):
       highest scan_priority, then oldest last_scan_at
    3. Loop targets (loop=1): only when no manual queue and no due scheduled targets;
       highest scan_priority, then oldest last_scan_at (round-robin between loops)
    """
    # 1. Process manual queue ordered by scan_priority DESC.
    # Skipped entirely when _queue_paused (user clicked "Pause queue").
    if not _queue_paused and _manual_queue:
        placeholders = ",".join("?" * len(_manual_queue))
        rows = await db.fetchall(
            f"SELECT id, scan_priority FROM targets "
            f"WHERE id IN ({placeholders}) AND status NOT IN ('running')",
            tuple(_manual_queue),
        )
        # Purge any entries that are no longer eligible (deleted or running)
        eligible_ids = {r["id"] for r in rows}
        for tid in list(_manual_queue):
            if tid not in eligible_ids:
                _manual_queue.remove(tid)

        if rows:
            # Pick highest scan_priority; preserve insertion order as tiebreaker
            best_priority = max(r["scan_priority"] for r in rows)
            # Among those tied on priority, take the one earliest in the queue
            for tid in _manual_queue:
                if any(r["id"] == tid and r["scan_priority"] == best_priority for r in rows):
                    _manual_queue.remove(tid)
                    return tid

    # 2. Due scheduled targets (non-loop only) — filter in Python to support
    #    all schedule modes (hourly, daily, weekly).
    candidates = await db.fetchall(
        """
        SELECT t.id, t.last_scan_at, t.rescan_interval, t.scan_priority,
               t.schedule_mode, t.schedule_days, t.schedule_weekday,
               t.schedule_hour, t.schedule_minute
        FROM targets t
        LEFT JOIN scan_sessions ss ON ss.target_id = t.id AND ss.status = 'running'
        WHERE t.manual_only = 0
          AND t.loop = 0
          AND t.status NOT IN ('running', 'paused')
          AND ss.id IS NULL
        ORDER BY t.scan_priority DESC, COALESCE(t.last_scan_at, '1970-01-01') ASC
        """,
        (),
    )
    now_utc = datetime.now(timezone.utc)
    for candidate in candidates:
        if is_scheduled_target_due(candidate, now_utc):
            return candidate["id"]

    # 3. Loop targets — run only when nothing else is pending.
    # Skipped entirely when _loops_paused is True (user clicked "Stop all loops").
    # 'loop_stopped' is excluded: the loop is paused until the user manually
    # triggers a scan, after which the loop resumes on the next cycle.
    #
    # ORDER BY: oldest last_scan_at FIRST (round-robin fairness so every loop
    # target gets equal airtime), then scan_priority DESC as a tiebreaker for
    # targets that last ran at exactly the same time.
    # NOTE: do NOT put scan_priority first — that causes the highest-priority
    # target to win every tick and starve lower-priority loop targets.
    if _loops_paused:
        return None

    row = await db.fetchone(
        """
        SELECT t.id
        FROM targets t
        LEFT JOIN scan_sessions ss ON ss.target_id = t.id AND ss.status = 'running'
        WHERE t.manual_only = 0
          AND t.loop = 1
          AND t.status NOT IN ('running', 'paused', 'loop_stopped')
          AND ss.id IS NULL
        ORDER BY COALESCE(t.last_scan_at, '1970-01-01') ASC, t.scan_priority DESC
        LIMIT 1
        """,
        (),
    )
    return row["id"] if row else None


async def _create_session(db, target_id: str) -> str:
    """Insert a new running scan_sessions row and return its ID."""
    session_id = str(uuid.uuid4())
    await db.execute(
        """
        INSERT INTO scan_sessions (id, target_id, status, started_at)
        VALUES (?, ?, 'running', ?)
        """,
        (session_id, target_id, _now()),
    )
    await db.execute(
        "UPDATE targets SET status='running' WHERE id=?",
        (target_id,),
    )
    await db.commit()
    return session_id
