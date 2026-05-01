"""
Scheduler state endpoints.

GET  /scheduler/state         — active session + queue + next targets + loops_paused + queue_paused
GET  /scheduler/queue         — just the manual queue list
POST /scheduler/loops/pause   — stop loop tier from starting new scans
POST /scheduler/loops/resume  — re-enable loop tier
POST /scheduler/queue/pause   — freeze manual queue (queued targets stay, but won't start)
POST /scheduler/queue/resume  — unfreeze manual queue
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from engine.db import Database, get_db
from engine import scheduler

log = logging.getLogger("engine.api.scheduler")
router = APIRouter(tags=["scheduler"])


@router.get("/scheduler/state")
async def get_scheduler_state(db: Database = Depends(get_db)):
    try:
        active = scheduler.get_active_session()
        queue  = scheduler.get_queue()

        # Only show a session as active if it is *still* running.
        # _active_session can lag up to 10 s after a scan finishes (tick interval).
        active_info = None
        if active:
            row = await db.fetchone(
                "SELECT id, target_id, status, started_at FROM scan_sessions WHERE id=? AND status='running'",
                (active,),
            )
            if row:
                target = await db.fetchone(
                    "SELECT domain, loop FROM targets WHERE id=?", (row["target_id"],)
                )
                step_stats = await db.fetchone(
                    """
                    SELECT
                        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS steps_done,
                        COUNT(*) AS steps_total,
                        MAX(CASE WHEN status='running' THEN step_id ELSE NULL END) AS current_step
                    FROM step_runs
                    WHERE session_id=?
                    """,
                    (row["id"],),
                )
                active_info = {
                    "session_id":   row["id"],
                    "target_id":    row["target_id"],
                    "domain":       target["domain"] if target else None,
                    "loop":         bool(target["loop"]) if target else False,
                    "status":       row["status"],
                    "started_at":   row["started_at"],
                    "steps_done":   step_stats["steps_done"] or 0 if step_stats else 0,
                    "steps_total":  step_stats["steps_total"] or 0 if step_stats else 0,
                    "current_step": step_stats["current_step"] if step_stats else None,
                }

        # Build manual queue info ordered by scan_priority DESC (matches _pick_next logic).
        # Ties in priority preserve insertion order (earlier-queued item runs first).
        queue_info = []
        for target_id in queue:
            row = await db.fetchone(
                "SELECT id, domain, scan_priority, loop FROM targets WHERE id=?", (target_id,)
            )
            if row:
                queue_info.append({
                    "target_id":     row["id"],
                    "domain":        row["domain"],
                    "scan_priority": row["scan_priority"],
                    "loop":          bool(row["loop"]),
                })
        # Sort by priority descending; stable sort preserves insertion order for ties
        queue_info.sort(key=lambda q: q["scan_priority"], reverse=True)

        # All non-loop scheduled targets — sorted by next_run_at ascending so the
        # frontend can show the full upcoming schedule (not just currently-due ones).
        sched_candidates = await db.fetchall(
            """
            SELECT t.id, t.domain, t.last_scan_at, t.rescan_interval, t.scan_priority,
                   t.schedule_mode, t.schedule_days, t.schedule_weekday,
                   t.schedule_hour, t.schedule_minute
            FROM targets t
            LEFT JOIN scan_sessions ss ON ss.target_id = t.id AND ss.status = 'running'
            WHERE t.manual_only = 0
              AND t.loop = 0
              AND t.status NOT IN ('running', 'paused')
              AND ss.id IS NULL
            """,
            (),
        )
        now_utc = datetime.now(timezone.utc)
        scheduled = []
        for candidate in sched_candidates:
            next_run = scheduler.calculate_next_run_at(candidate, now_utc)
            if next_run is None:
                continue
            scheduled.append({
                "target_id":       candidate["id"],
                "domain":          candidate["domain"],
                "schedule_mode":   candidate["schedule_mode"] or "hourly",
                "rescan_interval": candidate["rescan_interval"],
                "schedule_days":   candidate["schedule_days"],
                "schedule_weekday": candidate["schedule_weekday"],
                "schedule_hour":   candidate["schedule_hour"],
                "schedule_minute": candidate["schedule_minute"],
                "next_run_at":     next_run.isoformat(),
                "is_due":          scheduler.is_scheduled_target_due(candidate, now_utc),
            })
        scheduled.sort(key=lambda x: x["next_run_at"])
        # Keep backward-compat field pointing at the soonest due target
        next_scheduled = next((s for s in scheduled if s["is_due"]), None)

        # Next loop target — always shown unless loops are globally paused.
        # Excludes targets already in the manual queue (shown there instead)
        # and targets that are running, paused, or explicitly loop_stopped.
        next_loop = None
        if not scheduler.get_loops_paused():
            queued_ids = [q["target_id"] for q in queue_info]
            # Build NOT IN clause; safe because IDs are UUIDs from our own queue list
            if queued_ids:
                placeholders = ",".join("?" * len(queued_ids))
                loop_sql = f"""
                SELECT t.id, t.domain
                FROM targets t
                LEFT JOIN scan_sessions ss ON ss.target_id = t.id AND ss.status = 'running'
                WHERE t.manual_only = 0
                  AND t.loop = 1
                  AND t.status NOT IN ('running', 'paused', 'loop_stopped')
                  AND t.id NOT IN ({placeholders})
                  AND ss.id IS NULL
                ORDER BY COALESCE(t.last_scan_at, '1970-01-01') ASC, t.scan_priority DESC
                LIMIT 1
                """
                loop_row = await db.fetchone(loop_sql, tuple(queued_ids))
            else:
                loop_row = await db.fetchone(
                    """
                    SELECT t.id, t.domain
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
            if loop_row:
                next_loop = {"target_id": loop_row["id"], "domain": loop_row["domain"]}

        return {
            "active":         active_info,
            "queue":          queue_info,
            "scheduled":      scheduled,
            "next_scheduled": next_scheduled,
            "next_loop":      next_loop,
            "loops_paused":   scheduler.get_loops_paused(),
            "queue_paused":   scheduler.get_queue_paused(),
        }
    except Exception as exc:
        log.error("Scheduler state query failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Scheduler state unavailable")


@router.post("/scheduler/queue/pause", status_code=200)
async def pause_queue():
    """Pause everything: manual queue AND loops. Nothing new starts."""
    scheduler.set_queue_paused(True)
    scheduler.set_loops_paused(True)
    return {"queue_paused": True, "loops_paused": True}


@router.post("/scheduler/queue/resume", status_code=200)
async def resume_queue():
    """Resume everything: manual queue AND loops."""
    scheduler.set_queue_paused(False)
    scheduler.set_loops_paused(False)
    return {"queue_paused": False, "loops_paused": False}


@router.post("/scheduler/loops/pause", status_code=200)
async def pause_loops():
    """Stop the loop tier. Running scans finish normally; no new loop scan starts."""
    scheduler.set_loops_paused(True)
    return {"loops_paused": True}


@router.post("/scheduler/loops/resume", status_code=200)
async def resume_loops():
    """Re-enable the loop tier."""
    scheduler.set_loops_paused(False)
    return {"loops_paused": False}


@router.get("/scheduler/queue")
async def get_queue():
    return {"queue": scheduler.get_queue()}


@router.delete("/scheduler/queue/{target_id}", status_code=200)
async def dequeue_target(target_id: str, db: Database = Depends(get_db)):
    """Remove a specific target from the manual queue before it starts running."""
    row = await db.fetchone("SELECT id FROM targets WHERE id=?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")
    removed = scheduler.remove_from_queue(target_id)
    return {"removed": removed, "target_id": target_id}
