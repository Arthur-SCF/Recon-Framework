"""
Pipeline runner — executes a scan session's pipeline groups sequentially,
running steps within each group either in parallel or sequentially.

Key behaviors:
  - Checks session status before each group (pause/cancel detection).
  - Skips steps that already have status='success' in step_runs (resume support).
  - Emits WebSocket events at every lifecycle point.
  - Checks disk space before each step; auto-pauses at 90% usage.
  - Updates step_runs and scan_sessions in the database.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time as _time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from engine.pipeline.base import BaseStep, StepContext, StepResult, OutputStatus
from engine.pipeline.registry import STEP_REGISTRY
from engine.pipeline import signals
from engine.storage import is_disk_full, DATA_ROOT
from engine.websocket import ws_manager

# Steps that must not run when a wildcard is detected + policy is skip/ask
BRUTE_FORCE_STEPS = frozenset({
    "alterx", "puredns_default", "puredns_permutation", "cewl", "puredns_custom",
})

# Use plain logger without request_id format (background task, no HTTP context)
log = logging.getLogger("engine.runner")


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


async def _broadcast(event: str, data: dict) -> None:
    try:
        target_id  = data.pop("target_id", None)
        session_id = data.pop("session_id", None)
        await ws_manager.broadcast(event, data, target_id=target_id, session_id=session_id)
    except Exception as exc:
        log.warning("WS broadcast failed for event '%s': %r", event, exc)
        # Non-fatal — never let WS errors crash the pipeline


# ── Database helpers ───────────────────────────────────────────────────────────

async def _get_session(db, session_id: str) -> dict | None:
    row = await db.fetchone(
        "SELECT id, status, target_id FROM scan_sessions WHERE id = ?",
        (session_id,),
    )
    return dict(row) if row else None


async def _session_status(db, session_id: str) -> str | None:
    row = await db.fetchone(
        "SELECT status FROM scan_sessions WHERE id = ?", (session_id,)
    )
    return row["status"] if row else None


async def _create_step_run(db, session_id: str, target_id: str, step_id: str) -> str:
    """Insert a step_run row and return its ID."""
    run_id = str(uuid.uuid4())
    now = _now()
    await db.execute(
        """
        INSERT INTO step_runs
            (id, session_id, target_id, step_id, tool_id, status, started_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?)
        """,
        (run_id, session_id, target_id, step_id, step_id, now),
    )
    await db.commit()
    return run_id


async def _finish_step_run(db, run_id: str, result: StepResult) -> None:
    await db.execute(
        """
        UPDATE step_runs
        SET status = ?, finished_at = ?, execution_time = ?,
            result_count = ?, stderr_snippet = ?,
            command = ?, error_category = ?, retry_count = ?
        WHERE id = ?
        """,
        (
            result.status,
            _now(),
            round(result.execution_time, 3),
            result.result_count,
            result.stderr[:2000] if result.stderr else None,
            json.dumps(result.command) if result.command else None,
            result.error_category,
            result.retry_count,
            run_id,
        ),
    )
    await db.commit()


async def _step_already_done(db, session_id: str, step_id: str) -> bool:
    """Return True if this step already completed successfully in this session."""
    row = await db.fetchone(
        """
        SELECT id FROM step_runs
        WHERE session_id = ? AND step_id = ? AND status = 'success'
        """,
        (session_id, step_id),
    )
    return row is not None


async def _check_upstream(db, target_id: str, step_id: str) -> bool:
    """
    Return True if this step's upstream dependency has data.
    Return True (don't skip) for steps with no tracked upstream dependency.
    """
    from engine.errors import UPSTREAM_DEPS
    dep = UPSTREAM_DEPS.get(step_id)
    if dep is None:
        return True  # no upstream requirement
    table, where_clause = dep
    row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM {table} WHERE {where_clause}",
        (target_id,),
    )
    return row is not None and row["n"] > 0


# ── Step executor ──────────────────────────────────────────────────────────────

async def _run_step(
    db,
    session_id: str,
    target_id: str,
    domain: str,
    step_id: str,
    config: dict,
    ctx_extras: dict,
    force: bool = False,
    max_retries: int = 1,
    pause_on_failure: bool = False,
) -> StepResult | None:
    """
    Execute a single step with retry support.
    Returns None if the session was cancelled/paused mid-flight.
    When force=True, skips the already-done check (used by rerun endpoint).
    """
    # Resume support: skip already-successful steps
    if not force and await _step_already_done(db, session_id, step_id):
        log.debug("%s / %s already done — skipping", session_id[:8], step_id)
        return StepResult(status=OutputStatus.SKIPPED)

    # Wildcard skip guard
    if step_id in BRUTE_FORCE_STEPS:
        wc_row = await db.fetchone(
            "SELECT wildcard_skip FROM scan_sessions WHERE id = ?", (session_id,)
        )
        if wc_row and wc_row["wildcard_skip"]:
            log.info("%s wildcard_skip active — skipping %s", session_id[:8], step_id)
            return StepResult(status=OutputStatus.SKIPPED)

    # Disk space guard — only pause if session is still running (don't overwrite cancelled)
    if is_disk_full():
        cur_status = await _session_status(db, session_id)
        if cur_status == "running":
            log.warning("Disk full — auto-pausing session %s", session_id[:8])
            await db.execute(
                "UPDATE scan_sessions SET status='paused', pause_type='auto', paused_at=? WHERE id=?",
                (_now(), session_id),
            )
            await db.commit()
            await _broadcast("scan_paused", {
                "session_id": session_id, "target_id": target_id, "reason": "disk_full"
            })
        return None

    # Upstream dependency check
    has_upstream = await _check_upstream(db, target_id, step_id)
    if not has_upstream:
        log.info("%s %s skipped — upstream dependency has no data", session_id[:8], step_id)
        result = StepResult(
            status=OutputStatus.SKIPPED,
            error_category="upstream",
        )
        run_id = await _create_step_run(db, session_id, target_id, step_id)
        await _finish_step_run(db, run_id, result)
        await _broadcast("step_failed", {
            "session_id":   session_id,
            "target_id":    target_id,
            "step_id":      step_id,
            "step_run_id":  run_id,
            "status":       result.status,
            "result_count": 0,
            "execution_time": 0.0,
            "error_category": "upstream",
        })
        from engine.notifier import notify as _notify
        await _notify(
            notification_type="step_error",
            title=f"{domain} — {step_id} skipped (no upstream data)",
            message=f"Category: upstream\nStep {step_id} was skipped because its dependency has no data yet.",
            data={"target_id": target_id, "session_id": session_id,
                  "step_id": step_id, "error_category": "upstream", "retry_count": 0},
            target_id=target_id,
            session_id=session_id,
        )
        return result

    cls = STEP_REGISTRY.get(step_id)
    if cls is None:
        log.warning("step_id '%s' not in STEP_REGISTRY — skipping", step_id)
        return StepResult(status=OutputStatus.SKIPPED)

    # Pre-execution skip check (before creating step_run row)
    if signals.is_pending_skip(session_id, step_id):
        log.info("%s step %s: pre-execution skip requested", session_id[:8], step_id)
        return StepResult(status=OutputStatus.SKIPPED)

    run_id = await _create_step_run(db, session_id, target_id, step_id)

    data_dir = DATA_ROOT / "scans" / domain / session_id / step_id
    ctx = StepContext(
        target_id=target_id,
        domain=domain,
        session_id=session_id,
        step_id=step_id,
        step_run_id=run_id,
        config=config,
        db=db,
        data_dir=data_dir,
        **ctx_extras,
    )

    await _broadcast("step_started", {
        "session_id": session_id, "target_id": target_id,
        "step_id": step_id, "step_run_id": run_id,
    })
    log.info("%s starting step: %s", session_id[:8], step_id)

    # ── Retry loop ────────────────────────────────────────────────────────────
    from engine.errors import classify_error, ErrorCategory

    result = StepResult(status=OutputStatus.ERROR)
    for attempt in range(max_retries + 1):
        task = asyncio.create_task(cls().run(ctx))
        signals.register_task(session_id, step_id, task)
        try:
            result = await task
        except asyncio.CancelledError:
            log.info("%s step %s: cancelled — marking SKIPPED", session_id[:8], step_id)
            result = StepResult(status=OutputStatus.SKIPPED)
            signals.unregister_task(session_id, step_id)
            break
        except Exception as exc:
            log.error("%s step %s raised: %r", session_id[:8], step_id, exc)
            result = StepResult(
                status=OutputStatus.ERROR,
                data={"error": str(exc)},
                stderr=str(exc),
                error_category=classify_error(stderr=str(exc), step_id=step_id).value,
            )
        finally:
            signals.unregister_task(session_id, step_id)

        result.retry_count = attempt

        # Success or intentional skip — no retry needed
        if result.status in (OutputStatus.SUCCESS, OutputStatus.SKIPPED):
            break

        # Classify if not already set by base class
        if result.error_category is None:
            if result.status == OutputStatus.TIMEOUT:
                result.error_category = ErrorCategory.TIMEOUT.value
            else:
                result.error_category = classify_error(
                    stderr=result.stderr, step_id=step_id
                ).value

        category = ErrorCategory(result.error_category)

        # Non-retryable: fail immediately
        if category in (ErrorCategory.CONFIG, ErrorCategory.RESOURCE, ErrorCategory.UPSTREAM):
            log.warning("%s step %s: non-retryable %s error — not retrying",
                        session_id[:8], step_id, category.value)
            break

        # Out of retries
        if attempt >= max_retries:
            break

        # Retryable: backoff and try again
        delay = min(2 ** attempt, 30)
        log.warning(
            "%s retrying %s (attempt %d/%d) after %s error — waiting %ds",
            session_id[:8], step_id, attempt + 2, max_retries + 1, category.value, delay,
        )
        await asyncio.sleep(delay)
    # ── End retry loop ────────────────────────────────────────────────────────

    await _finish_step_run(db, run_id, result)

    # Step-level error notification (after all retries exhausted)
    if result.status in (OutputStatus.ERROR, OutputStatus.TIMEOUT):
        category = ErrorCategory(result.error_category) if result.error_category else ErrorCategory.UNKNOWN
        should_notify = (
            category in (ErrorCategory.CONFIG, ErrorCategory.RESOURCE)
            or result.retry_count >= max_retries
        )
        if should_notify:
            from engine.notifier import notify as _notify
            stderr_preview = (result.stderr or "")[:200] or "No error output captured"
            await _notify(
                notification_type="step_error",
                title=f"{domain} — {step_id} failed",
                message=(
                    f"Category: {result.error_category}\n"
                    f"Attempts: {result.retry_count + 1}/{max_retries + 1}\n"
                    f"Error: {stderr_preview}"
                    + ("\nScan paused — waiting for action." if pause_on_failure else "")
                ),
                data={
                    "target_id":        target_id,
                    "session_id":       session_id,
                    "step_id":          step_id,
                    "error_category":   result.error_category,
                    "retry_count":      result.retry_count,
                    "pause_on_failure": pause_on_failure,
                },
                target_id=target_id,
                session_id=session_id,
            )

    # Auto-pause on failure if enabled for this target
    if (
        pause_on_failure
        and result.status in (OutputStatus.ERROR, OutputStatus.TIMEOUT)
    ):
        cur_row = await db.fetchone(
            "SELECT status FROM scan_sessions WHERE id=?", (session_id,)
        )
        if cur_row and cur_row["status"] == "running":
            log.info(
                "%s pause_on_failure: pausing session after %s failed",
                session_id[:8], step_id,
            )
            await db.execute(
                "UPDATE scan_sessions SET status='paused', pause_type='step_failure', paused_at=? WHERE id=?",
                (_now(), session_id),
            )
            await db.execute(
                "UPDATE targets SET status='paused' WHERE id=?",
                (target_id,),
            )
            await db.commit()
            await _broadcast("scan_paused", {
                "session_id": session_id,
                "target_id":  target_id,
                "pause_type": "step_failure",
                "step_id":    step_id,
            })

    event = "step_completed" if result.status == OutputStatus.SUCCESS else "step_failed"
    await _broadcast(event, {
        "session_id":     session_id,
        "target_id":      target_id,
        "step_id":        step_id,
        "step_run_id":    run_id,
        "status":         result.status,
        "result_count":   result.result_count,
        "execution_time": round(result.execution_time, 3),
        "error_category": result.error_category,
        "retry_count":    result.retry_count,
    })

    return result


# ── Group executor ─────────────────────────────────────────────────────────────

async def _run_group(
    db,
    session_id: str,
    target_id: str,
    domain: str,
    group: dict,
    config: dict,
    ctx_extras: dict,
    pause_on_failure: bool = False,
) -> bool:
    """
    Execute all steps in a group, either in parallel or sequentially.
    Returns False if the session should stop (paused/cancelled).
    """
    group_id   = group["id"]
    group_name = group["name"]
    parallel   = group.get("parallel", False)
    steps      = group.get("steps", [])

    await _broadcast("group_started", {
        "session_id": session_id,
        "target_id":  target_id,
        "group_id":   group_id,
        "group_name": group_name,
        "parallel":   parallel,
        "step_count": len(steps),
    })
    log.info("%s group '%s' (%d steps, parallel=%s)", session_id[:8], group_name, len(steps), parallel)

    enabled_steps = [s for s in steps if s.get("enabled", True)]

    async def _exec_step(step_def: dict) -> StepResult | None:
        step_id = step_def["step_id"]
        max_retries = step_def.get("max_retries", 1)
        overrides = {}
        if step_def.get("config_overrides"):
            try:
                overrides = json.loads(step_def["config_overrides"])
            except Exception:
                pass
        merged_config = {**config, **overrides}
        return await _run_step(
            db, session_id, target_id, domain, step_id,
            merged_config, ctx_extras, max_retries=max_retries,
            pause_on_failure=pause_on_failure,
        )

    if parallel:
        tasks = [asyncio.create_task(_exec_step(s)) for s in enabled_steps]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        should_stop = False
        has_error   = False
        for r in results:
            if isinstance(r, Exception):
                log.error("%s parallel step raised: %r", session_id[:8], r)
                has_error = True
            elif r is None:
                should_stop = True
            elif isinstance(r, StepResult) and r.status == OutputStatus.ERROR:
                has_error = True
        if should_stop:
            return False
        if has_error:
            log.warning("%s group '%s' had step errors in parallel execution",
                        session_id[:8], group_name)
    else:
        for step_def in enabled_steps:
            # Check session status before each sequential step
            status = await _session_status(db, session_id)
            if status in ("paused", "cancelled"):
                log.info("%s session %s — stopping before %s", session_id[:8], status, step_def["step_id"])
                return False

            result = await _exec_step(step_def)
            if result is None:
                return False

    await _broadcast("group_completed", {
        "session_id": session_id,
        "target_id":  target_id,
        "group_id":   group_id,
        "group_name": group_name,
    })
    return True


# ── Main entry point ───────────────────────────────────────────────────────────

async def run_pipeline(
    db,
    session_id: str,
    target_id: str,
    domain: str,
    config: dict | None = None,
    is_resume: bool = False,
) -> None:
    """
    Load the pipeline config for this target and execute all groups in order.
    Called by the scheduler in a background task.

    is_resume=True skips the last_scan_at update (used when auto-resuming a
    loop scan that was preempted mid-pipeline).
    """
    if config is None:
        config = {}

    _scan_start = _time.monotonic()
    event = "scan_resumed" if is_resume else "scan_started"
    log.info("%s pipeline %s for target %s (%s)", session_id[:8],
             "resuming" if is_resume else "starting", target_id, domain)
    await _broadcast(event, {"session_id": session_id, "target_id": target_id, "domain": domain})

    # Load pipeline groups + steps from DB
    groups = await db.fetchall(
        """
        SELECT pg.id, pg.name, pg.position, pg.parallel, pg.enabled
        FROM pipeline_groups pg
        WHERE pg.target_id = ? AND pg.enabled = 1
        ORDER BY pg.position
        """,
        (target_id,),
    )

    groups_with_steps = []
    for g in groups:
        steps = await db.fetchall(
            """
            SELECT ps.step_id, ps.position, ps.enabled, ps.config_overrides, ps.max_retries
            FROM pipeline_steps ps
            WHERE ps.group_id = ? AND ps.enabled = 1
            ORDER BY ps.position
            """,
            (g["id"],),
        )
        groups_with_steps.append({
            "id":       g["id"],
            "name":     g["name"],
            "position": g["position"],
            "parallel": bool(g["parallel"]),
            "steps":    [dict(s) for s in steps],
        })

    # Fetch per-target pause_on_failure flag
    target_pause_row = await db.fetchone(
        "SELECT pause_on_failure FROM targets WHERE id=?", (target_id,)
    )
    pause_on_failure: bool = bool(target_pause_row["pause_on_failure"]) if target_pause_row else False

    ctx_extras: dict = {}

    # Update target status to running.
    # On resume, preserve the original last_scan_at so the scheduler's
    # interval calculation is based on when this scan cycle started.
    if is_resume:
        await db.execute(
            "UPDATE targets SET status='running' WHERE id=?",
            (target_id,),
        )
    else:
        await db.execute(
            "UPDATE targets SET status='running', last_scan_at=? WHERE id=?",
            (_now(), target_id),
        )
    await db.commit()

    pipeline_ok = True
    try:
        for group in groups_with_steps:
            # Check session status at group boundary (manual pause / cancel)
            status = await _session_status(db, session_id)
            if status in ("paused", "cancelled"):
                log.info("%s session %s at group boundary", session_id[:8], status)
                pipeline_ok = False
                break

            # Preemption check: loop targets yield to manual/scheduled scans
            from engine import scheduler as _scheduler
            preempted, preempt_by = await _scheduler.should_preempt(db, target_id)
            if preempted:
                log.info("%s loop target preempted by %s — auto-pausing", session_id[:8], preempt_by)
                await db.execute(
                    """
                    UPDATE scan_sessions
                    SET status='paused', pause_type='auto', paused_at=?, resume_after=?
                    WHERE id=?
                    """,
                    (_now(), preempt_by, session_id),
                )
                await db.execute(
                    "UPDATE targets SET status='paused' WHERE id=?",
                    (target_id,),
                )
                await db.commit()
                await _broadcast("scan_paused", {
                    "session_id": session_id,
                    "target_id": target_id,
                    "pause_type": "auto",
                })
                pipeline_ok = False
                break

            ok = await _run_group(db, session_id, target_id, domain, group, config, ctx_extras,
                                   pause_on_failure=pause_on_failure)
            if not ok:
                pipeline_ok = False
                break
    except Exception as exc:
        log.error("[runner] Unhandled pipeline exception: %r", exc)
        pipeline_ok = False

    # Final session/target status update
    final_status = await _session_status(db, session_id)
    if final_status == "cancelled":
        log.info("%s pipeline cancelled", session_id[:8])
    elif final_status == "paused":
        log.info("%s pipeline paused", session_id[:8])
    elif pipeline_ok:
        subdomain_row = await db.fetchone(
            "SELECT COUNT(*) AS c FROM subdomains WHERE target_id=?", (target_id,)
        )
        subdomain_count = subdomain_row["c"] if subdomain_row else 0
        await db.execute(
            "UPDATE scan_sessions SET status='completed', finished_at=?, stats=? WHERE id=?",
            (_now(), json.dumps({"subdomains_found": subdomain_count}), session_id),
        )
        await db.execute(
            "UPDATE targets SET scan_count = scan_count + 1, status='completed' WHERE id=?",
            (target_id,),
        )
        await db.commit()
        try:
            from engine.metrics import scan_duration
            scan_duration.observe(_time.monotonic() - _scan_start)
        except Exception:
            pass
        log.info("%s pipeline completed successfully", session_id[:8])
        await _broadcast("scan_completed", {"session_id": session_id, "target_id": target_id})
    else:
        await db.execute(
            "UPDATE scan_sessions SET status='error', finished_at=? WHERE id=?",
            (_now(), session_id),
        )
        await db.commit()
        try:
            from engine.metrics import scan_duration
            scan_duration.observe(_time.monotonic() - _scan_start)
        except Exception:
            pass
        log.error("%s pipeline ended with error", session_id[:8])
        await _broadcast("scan_error", {"session_id": session_id, "target_id": target_id})

    if final_status not in ("paused", "cancelled"):
        if pipeline_ok:
            target_status = "completed"
        else:
            # Loop targets go to 'loop_stopped' on error so the scheduler
            # doesn't blindly restart a broken pipeline. The user must manually
            # trigger one scan to re-validate, after which the loop resumes.
            loop_row = await db.fetchone(
                "SELECT loop FROM targets WHERE id=?", (target_id,)
            )
            target_status = "loop_stopped" if (loop_row and loop_row["loop"]) else "error"
        await db.execute(
            "UPDATE targets SET status=? WHERE id=?",
            (target_status, target_id),
        )
        await db.commit()

    # Storage rotation
    row = await db.fetchone(
        "SELECT retention_runs FROM targets WHERE id=?", (target_id,)
    )
    if row:
        from engine.storage import cleanup_old_sessions
        deleted = await cleanup_old_sessions(domain, target_id, db, row["retention_runs"])
        if deleted:
            log.debug("%s cleaned up %d old session(s)", session_id[:8], deleted)

    signals.cleanup_session(session_id)
