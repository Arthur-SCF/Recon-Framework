"""
CRUD for report_schedules table.

GET    /api/v1/report-schedules          list all
POST   /api/v1/report-schedules          create
PUT    /api/v1/report-schedules/{id}     update
DELETE /api/v1/report-schedules/{id}     delete
POST   /api/v1/report-schedules/{id}/run fire immediately (ignores schedule timing)
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from engine.db import Database, get_db
from engine.api.schemas import ReportScheduleCreate, ReportScheduleOut, ReportScheduleUpdate

log = logging.getLogger("engine.api.report_schedules")

router = APIRouter(prefix="/report-schedules", tags=["reports"])


def _row_to_out(row: dict) -> ReportScheduleOut:
    return ReportScheduleOut(
        id=row["id"],
        name=row["name"],
        target_id=row["target_id"],
        frequency=row["frequency"],
        day_of_week=row["day_of_week"],
        hour=row["hour"],
        channel_id=row["channel_id"],
        enabled=bool(row["enabled"]),
        last_sent_at=row["last_sent_at"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[ReportScheduleOut])
async def list_schedules(db: Database = Depends(get_db)):
    rows = await db.fetchall(
        "SELECT * FROM report_schedules ORDER BY created_at DESC", ()
    )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=ReportScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_schedule(body: ReportScheduleCreate, db: Database = Depends(get_db)):
    schedule_id = str(uuid.uuid4())
    try:
        await db.execute(
            """
            INSERT INTO report_schedules
                (id, name, target_id, frequency, day_of_week, hour, channel_id, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                schedule_id,
                body.name,
                body.target_id,
                body.frequency,
                body.day_of_week,
                body.hour,
                body.channel_id,
                int(body.enabled),
            ),
        )
        await db.commit()
    except Exception as exc:
        log.error("create_schedule failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create report schedule")
    row = await db.fetchone(
        "SELECT * FROM report_schedules WHERE id = ?", (schedule_id,)
    )
    return _row_to_out(row)


@router.put("/{schedule_id}", response_model=ReportScheduleOut)
async def update_schedule(
    schedule_id: str,
    body: ReportScheduleUpdate,
    db: Database = Depends(get_db),
):
    row = await db.fetchone(
        "SELECT * FROM report_schedules WHERE id = ?", (schedule_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")

    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.target_id is not None:
        updates["target_id"] = body.target_id
    if body.frequency is not None:
        updates["frequency"] = body.frequency
    if body.day_of_week is not None:
        updates["day_of_week"] = body.day_of_week
    if body.hour is not None:
        updates["hour"] = body.hour
    if body.channel_id is not None:
        updates["channel_id"] = body.channel_id
    if body.enabled is not None:
        updates["enabled"] = int(body.enabled)

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE report_schedules SET {set_clause} WHERE id = ?",
            (*updates.values(), schedule_id),
        )
        await db.commit()

    row = await db.fetchone(
        "SELECT * FROM report_schedules WHERE id = ?", (schedule_id,)
    )
    return _row_to_out(row)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(schedule_id: str, db: Database = Depends(get_db)):
    row = await db.fetchone(
        "SELECT id FROM report_schedules WHERE id = ?", (schedule_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.execute(
        "DELETE FROM report_schedules WHERE id = ?", (schedule_id,)
    )
    await db.commit()


@router.post("/{schedule_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_schedule_now(schedule_id: str, db: Database = Depends(get_db)):
    """Fire the schedule immediately, ignoring its timing. Returns 202 Accepted."""
    row = await db.fetchone(
        "SELECT * FROM report_schedules WHERE id = ?", (schedule_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")

    from engine.reports import generate_report
    from engine.api.webhooks import dispatch_webhooks
    from datetime import timedelta
    import asyncio

    now = datetime.now(timezone.utc)
    since_iso = (now - timedelta(days=7 if row["frequency"] == "weekly" else 1)).isoformat()

    target_id = row["target_id"]
    domain: str | None = None
    if target_id:
        t_row = await db.fetchone("SELECT domain FROM targets WHERE id = ?", (target_id,))
        domain = t_row["domain"] if t_row else target_id

    try:
        report_md = await generate_report(db, target_id, since_iso, domain)
    except Exception as exc:
        log.error("run_schedule_now generate_report failed for %s: %s", schedule_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate report")

    title = f"Recon Report — {domain or 'All Targets'}"

    asyncio.create_task(
        dispatch_webhooks(db, "scan_complete", title, report_md[:500], {})
    )

    try:
        await db.execute(
            "UPDATE report_schedules SET last_sent_at = ? WHERE id = ?",
            (now.isoformat(), schedule_id),
        )
        await db.commit()
    except Exception as exc:
        log.error("run_schedule_now failed to update last_sent_at for %s: %s", schedule_id, exc, exc_info=True)
        # Report was dispatched; don't fail the response over a timestamp update

    return {"dispatched": True, "title": title}
