"""
Notifications API.

GET    /api/v1/notifications                — list (page, per_page, unread_only, type, target_id)
GET    /api/v1/notifications/count          — unread count
POST   /api/v1/notifications/mark-all-read  — mark all as read
PUT    /api/v1/notifications/{id}/read      — mark one as read
DELETE /api/v1/notifications           — clear all
DELETE /api/v1/notifications/{id}           — delete one
"""
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from engine.db import Database, get_db
from engine.api.schemas import NotificationOut

log = logging.getLogger("engine.api.notifications")
router = APIRouter(prefix="/notifications", tags=["notifications"])


def _row_to_notif(row) -> NotificationOut:
    return NotificationOut(
        id=row["id"],
        target_id=row["target_id"],
        session_id=row["session_id"],
        type=row["type"],
        title=row["title"],
        message=row["message"],
        data=json.loads(row["data"]) if row["data"] else None,
        is_read=bool(row["is_read"]),
        created_at=row["created_at"],
    )


@router.get("")
async def list_notifications(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
    notif_type: str | None = Query(None, alias="type"),
    target_id: str | None = Query(None),
    db: Database = Depends(get_db),
):
    conditions = []
    params: list[Any] = []

    if unread_only:
        conditions.append("is_read = ?")
        params.append(0)
    if notif_type:
        conditions.append("type = ?")
        params.append(notif_type)
    if target_id:
        conditions.append("target_id = ?")
        params.append(target_id)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * per_page

    total_row = await db.fetchone(f"SELECT COUNT(*) FROM notifications{where}", params)
    total = total_row[0] if total_row else 0

    rows = await db.fetchall(
        f"SELECT * FROM notifications{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [per_page, offset],
    )

    data = [_row_to_notif(r) for r in rows]

    return {"data": data, "total": total, "page": page, "per_page": per_page}


@router.get("/count")
async def unread_count(db: Database = Depends(get_db)) -> dict:
    row = await db.fetchone(
        "SELECT COUNT(*) as cnt FROM notifications WHERE is_read = 0"
    )
    return {"unread": row["cnt"] if row else 0}


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(db: Database = Depends(get_db)) -> None:
    try:
        await db.execute("UPDATE notifications SET is_read = 1 WHERE is_read = 0", ())
        await db.commit()
    except Exception as exc:
        log.error("mark_all_read failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to mark notifications as read")


@router.put("/{notif_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_one_read(notif_id: str, db: Database = Depends(get_db)) -> None:
    row = await db.fetchone(
        "SELECT id FROM notifications WHERE id = ?", (notif_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ?", (notif_id,)
    )
    await db.commit()


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_all_notifications(db: Database = Depends(get_db)) -> None:
    try:
        await db.execute("DELETE FROM notifications", ())
        await db.commit()
    except Exception as exc:
        log.error("clear_all_notifications failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to clear notifications")


@router.delete("/{notif_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(notif_id: str, db: Database = Depends(get_db)) -> None:
    row = await db.fetchone(
        "SELECT id FROM notifications WHERE id = ?", (notif_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.execute("DELETE FROM notifications WHERE id = ?", (notif_id,))
    await db.commit()
