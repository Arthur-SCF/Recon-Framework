"""
Target CRUD API.

POST   /api/v1/targets              — create target + copy pipeline from template
GET    /api/v1/targets              — list all targets (supports ?tag= filter)
GET    /api/v1/targets/tags         — list all distinct tags with counts
GET    /api/v1/targets/{id}         — get target
PUT    /api/v1/targets/{id}         — update target settings (incl. tags)
DELETE /api/v1/targets/{id}         — delete target (CASCADE removes all related data)
POST   /api/v1/targets/{id}/tags    — add a tag to target
DELETE /api/v1/targets/{id}/tags/{tag} — remove a tag from target
POST   /api/v1/targets/bulk/delete  — delete multiple targets
POST   /api/v1/targets/bulk/start   — start scans for multiple targets
POST   /api/v1/targets/bulk/import  — bulk import domains as targets
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from engine.db import Database, get_db
from engine.api.schemas import (
    BulkImportBody, BulkTargetIds, TagCreate,
    TargetCreate, TargetOut, TargetUpdate,
)
from engine import scheduler
from engine.websocket import ws_manager

log = logging.getLogger("engine.api.targets")
router = APIRouter(prefix="/targets", tags=["targets"])

_DOMAIN_RE = re.compile(
    r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_target(row, tags: list[str] | None = None) -> TargetOut:
    return TargetOut(
        id=row["id"],
        domain=row["domain"],
        status=row["status"],
        created_at=row["created_at"],
        last_scan_at=row["last_scan_at"],
        scan_count=row["scan_count"],
        retention_runs=row["retention_runs"],
        scan_priority=row["scan_priority"],
        rescan_interval=row["rescan_interval"],
        manual_only=bool(row["manual_only"]),
        loop=bool(row["loop"]),
        wildcard_policy=row["wildcard_policy"],
        pipeline_template=row["pipeline_template"] or "standard",
        tags=tags or [],
        schedule_mode=row["schedule_mode"] or "hourly",
        schedule_days=row["schedule_days"] if row["schedule_days"] is not None else 1,
        schedule_weekday=row["schedule_weekday"] if row["schedule_weekday"] is not None else 0,
        schedule_hour=row["schedule_hour"] if row["schedule_hour"] is not None else 0,
        schedule_minute=row["schedule_minute"] if row["schedule_minute"] is not None else 0,
        pause_on_failure=bool(row["pause_on_failure"]) if row["pause_on_failure"] is not None else False,
    )


async def _fetch_tags(db: Database, target_id: str) -> list[str]:
    rows = await db.fetchall(
        "SELECT tag FROM target_tags WHERE target_id = ? ORDER BY tag",
        (target_id,),
    )
    return [r["tag"] for r in rows]


async def _fetch_tags_bulk(db: Database, target_ids: list[str]) -> dict[str, list[str]]:
    """Fetch tags for multiple targets in a single query."""
    if not target_ids:
        return {}
    placeholders = ",".join("?" * len(target_ids))
    rows = await db.fetchall(
        f"SELECT target_id, tag FROM target_tags WHERE target_id IN ({placeholders}) ORDER BY tag",
        tuple(target_ids),
    )
    result: dict[str, list[str]] = {tid: [] for tid in target_ids}
    for r in rows:
        result[r["target_id"]].append(r["tag"])
    return result


async def _set_tags(db: Database, target_id: str, tags: list[str]) -> None:
    """Replace all tags for a target (delete then re-insert)."""
    await db.execute("DELETE FROM target_tags WHERE target_id = ?", (target_id,))
    for tag in tags:
        await db.execute(
            "INSERT OR IGNORE INTO target_tags (id, target_id, tag) VALUES (?, ?, ?)",
            (str(uuid.uuid4()), target_id, tag),
        )


def _normalize_tag(tag: str) -> str:
    return tag.strip().lower()


# ── List / Create ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[TargetOut])
async def list_targets(
    tag: str | None = Query(None),
    db: Database = Depends(get_db),
) -> list[TargetOut]:
    if tag:
        tag = _normalize_tag(tag)
        rows = await db.fetchall(
            """SELECT t.* FROM targets t
               WHERE EXISTS (
                   SELECT 1 FROM target_tags tt
                   WHERE tt.target_id = t.id AND tt.tag = ?
               )
               ORDER BY t.created_at DESC""",
            (tag,),
        )
    else:
        rows = await db.fetchall("SELECT * FROM targets ORDER BY created_at DESC")

    ids = [r["id"] for r in rows]
    tags_map = await _fetch_tags_bulk(db, ids)
    return [_row_to_target(r, tags_map.get(r["id"], [])) for r in rows]


@router.post("", response_model=TargetOut, status_code=status.HTTP_201_CREATED)
async def create_target(
    body: TargetCreate, db: Database = Depends(get_db)
) -> TargetOut:
    existing = await db.fetchone(
        "SELECT id FROM targets WHERE domain = ?", (body.domain,)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Target '{body.domain}' already exists",
        )

    target_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    async with db.transaction():
        await db.execute(
            """
            INSERT INTO targets
              (id, domain, status, created_at, scan_count, retention_runs,
               retention_all, scan_priority, rescan_interval, manual_only, loop, wildcard_policy,
               pipeline_template, schedule_mode, schedule_days, schedule_weekday,
               schedule_hour, schedule_minute)
            VALUES (?, ?, 'idle', ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                target_id, body.domain, now, body.retention_runs,
                body.scan_priority, body.rescan_interval,
                1 if body.manual_only else 0,
                1 if body.loop else 0,
                body.wildcard_policy,
                body.pipeline_template,
                body.schedule_mode,
                body.schedule_days,
                body.schedule_weekday,
                body.schedule_hour,
                body.schedule_minute,
            ),
        )
        await _copy_pipeline_template(db, target_id, body.pipeline_template)

    log.info(
        "Target created: %s (%s, template=%s)",
        body.domain, target_id, body.pipeline_template,
    )
    row = await db.fetchone("SELECT * FROM targets WHERE id = ?", (target_id,))
    return _row_to_target(row, [])


# ── Tags collection endpoint (must come before /{target_id}) ──────────────────

@router.get("/tags")
async def list_all_tags(db: Database = Depends(get_db)) -> list[dict]:
    """Return all distinct tags with counts, sorted by count descending."""
    rows = await db.fetchall(
        """SELECT tag, COUNT(*) AS count
           FROM target_tags
           GROUP BY tag
           ORDER BY count DESC, tag ASC"""
    )
    return [{"tag": r["tag"], "count": r["count"]} for r in rows]


# ── Bulk operations (must come before /{target_id}) ───────────────────────────

@router.post("/bulk/delete", status_code=status.HTTP_200_OK)
async def bulk_delete_targets(
    body: BulkTargetIds, db: Database = Depends(get_db)
) -> dict:
    """Delete multiple targets by ID. Returns partial results on failure."""
    succeeded: list[str] = []
    failed: list[dict] = []
    not_found = 0
    for tid in body.ids:
        row = await db.fetchone("SELECT id FROM targets WHERE id = ?", (tid,))
        if not row:
            not_found += 1
            continue
        try:
            async with db.transaction():
                await db.execute("DELETE FROM targets WHERE id = ?", (tid,))
            succeeded.append(tid)
        except Exception as exc:
            log.error("bulk_delete: failed for %s: %s", tid, exc)
            failed.append({"id": tid, "error": str(exc)})
    log.info(
        "Bulk delete: %d deleted, %d not found, %d failed",
        len(succeeded), not_found, len(failed),
    )
    return {
        "succeeded": len(succeeded),
        "not_found": not_found,
        "failed": len(failed),
        "errors": failed,
    }


@router.post("/bulk/start", status_code=status.HTTP_200_OK)
async def bulk_start_scans(
    body: BulkTargetIds, db: Database = Depends(get_db)
) -> dict:
    """Enqueue scans for multiple targets."""
    from engine import scheduler as sched

    started = 0
    skipped = 0
    errors: list[str] = []

    for tid in body.ids:
        row = await db.fetchone(
            "SELECT id, status FROM targets WHERE id = ?", (tid,)
        )
        if not row:
            errors.append(f"{tid}: not found")
            continue
        try:
            if tid in sched.get_queue():
                skipped += 1
            else:
                sched.enqueue_manual(tid)
                started += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{tid}: {exc}")

    log.info(
        "Bulk start: %d started, %d skipped, %d errors",
        started, skipped, len(errors),
    )
    return {"started": started, "skipped": skipped, "errors": errors}


@router.post("/bulk/import", status_code=status.HTTP_200_OK)
async def bulk_import_targets(
    body: BulkImportBody, db: Database = Depends(get_db)
) -> dict:
    """
    Import multiple domains as targets in a single transaction.
    Returns counts: created, skipped_duplicate, skipped_invalid.
    """
    created = 0
    skipped_duplicate = 0
    skipped_invalid = 0
    created_targets: list[dict] = []

    # Normalise and deduplicate the incoming list
    seen: set[str] = set()
    domains: list[str] = []
    for raw in body.domains:
        d = raw.strip().lower().removeprefix("https://").removeprefix("http://").rstrip("/")
        if not d or d in seen:
            continue
        seen.add(d)
        if not _DOMAIN_RE.match(d) or len(d) > 253:
            skipped_invalid += 1
            continue
        domains.append(d)

    now = datetime.now(timezone.utc).isoformat()

    # Validate tags
    valid_tags: list[str] = []
    for t in body.tags:
        t = _normalize_tag(t)
        if t and len(t) <= 32:
            valid_tags.append(t)

    for domain in domains:
        existing = await db.fetchone(
            "SELECT id FROM targets WHERE domain = ?", (domain,)
        )
        if existing:
            skipped_duplicate += 1
            continue

        target_id = str(uuid.uuid4())
        try:
            async with db.transaction():
                await db.execute(
                    """
                    INSERT INTO targets
                      (id, domain, status, created_at, scan_count, retention_runs,
                       retention_all, scan_priority, rescan_interval, manual_only, loop, wildcard_policy,
                       pipeline_template)
                    VALUES (?, ?, 'idle', ?, 0, 5, 0, ?, 24, ?, 0, 'skip', ?)
                    """,
                    (
                        target_id, domain, now,
                        body.scan_priority,
                        1 if body.manual_only else 0,
                        body.pipeline_template,
                    ),
                )
                await _copy_pipeline_template(db, target_id, body.pipeline_template)
                if valid_tags:
                    await _set_tags(db, target_id, valid_tags)
            created += 1
            created_targets.append({"id": target_id, "domain": domain})
        except Exception as exc:
            log.error("bulk_import: failed for %s: %s", domain, exc)
            skipped_invalid += 1

    log.info(
        "Bulk import: %d created, %d duplicate, %d invalid",
        created, skipped_duplicate, skipped_invalid,
    )
    return {
        "created": created,
        "skipped_duplicate": skipped_duplicate,
        "skipped_invalid": skipped_invalid,
        "targets": created_targets,
    }


# ── Single target CRUD ────────────────────────────────────────────────────────

@router.get("/{target_id}", response_model=TargetOut)
async def get_target(target_id: str, db: Database = Depends(get_db)) -> TargetOut:
    row = await db.fetchone("SELECT * FROM targets WHERE id = ?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")
    tags = await _fetch_tags(db, target_id)
    return _row_to_target(row, tags)


@router.put("/{target_id}", response_model=TargetOut)
async def update_target(
    target_id: str, body: TargetUpdate, db: Database = Depends(get_db)
) -> TargetOut:
    row = await db.fetchone("SELECT * FROM targets WHERE id = ?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")

    updates: list[str] = []
    params: list = []

    if body.scan_priority is not None:
        updates.append("scan_priority = ?")
        params.append(body.scan_priority)
    if body.rescan_interval is not None:
        updates.append("rescan_interval = ?")
        params.append(body.rescan_interval)
    if body.manual_only is not None:
        updates.append("manual_only = ?")
        params.append(1 if body.manual_only else 0)
    if body.loop is not None:
        updates.append("loop = ?")
        params.append(1 if body.loop else 0)
    if body.wildcard_policy is not None:
        updates.append("wildcard_policy = ?")
        params.append(body.wildcard_policy)
    if body.retention_runs is not None:
        updates.append("retention_runs = ?")
        params.append(body.retention_runs)
    if body.schedule_mode is not None:
        updates.append("schedule_mode = ?")
        params.append(body.schedule_mode)
    if body.schedule_days is not None:
        updates.append("schedule_days = ?")
        params.append(body.schedule_days)
    if body.schedule_weekday is not None:
        updates.append("schedule_weekday = ?")
        params.append(body.schedule_weekday)
    if body.schedule_hour is not None:
        updates.append("schedule_hour = ?")
        params.append(body.schedule_hour)
    if body.schedule_minute is not None:
        updates.append("schedule_minute = ?")
        params.append(body.schedule_minute)
    if body.pause_on_failure is not None:
        updates.append("pause_on_failure = ?")
        params.append(1 if body.pause_on_failure else 0)

    if updates or body.tags is not None:
        async with db.transaction():
            if updates:
                params.append(target_id)
                await db.execute(
                    f"UPDATE targets SET {', '.join(updates)} WHERE id = ?",
                    tuple(params),
                )
            if body.tags is not None:
                normalised = [_normalize_tag(t) for t in body.tags if t.strip()]
                await _set_tags(db, target_id, normalised)

    # If scan_priority changed, broadcast immediately so the frontend's scheduler
    # state refreshes without waiting for the next 5 s poll. Fire unconditionally:
    # the target might not be in the manual queue, but its priority change can
    # affect which loop/scheduled target appears next in the widget.
    if body.scan_priority is not None:
        await ws_manager.broadcast(
            "scan_queued", {"target_id": target_id}, target_id=target_id
        )

    row = await db.fetchone("SELECT * FROM targets WHERE id = ?", (target_id,))
    tags = await _fetch_tags(db, target_id)
    return _row_to_target(row, tags)


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_target(target_id: str, db: Database = Depends(get_db)) -> None:
    row = await db.fetchone("SELECT id FROM targets WHERE id = ?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")
    await db.execute("DELETE FROM targets WHERE id = ?", (target_id,))
    await db.commit()
    log.info("Target deleted: %s", target_id)


# ── Per-target tag management ─────────────────────────────────────────────────

@router.post("/{target_id}/tags", status_code=status.HTTP_201_CREATED)
async def add_tag(
    target_id: str, body: TagCreate, db: Database = Depends(get_db)
) -> dict:
    row = await db.fetchone("SELECT id FROM targets WHERE id = ?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")
    tag_id = str(uuid.uuid4())
    try:
        await db.execute(
            "INSERT INTO target_tags (id, target_id, tag) VALUES (?, ?, ?)",
            (tag_id, target_id, body.tag),
        )
        await db.commit()
    except Exception:
        # UNIQUE constraint — tag already exists, that's fine
        pass
    tags = await _fetch_tags(db, target_id)
    return {"target_id": target_id, "tags": tags}


@router.delete("/{target_id}/tags/{tag}", status_code=status.HTTP_200_OK)
async def remove_tag(
    target_id: str, tag: str, db: Database = Depends(get_db)
) -> dict:
    row = await db.fetchone("SELECT id FROM targets WHERE id = ?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")
    tag = _normalize_tag(tag)
    await db.execute(
        "DELETE FROM target_tags WHERE target_id = ? AND tag = ?",
        (target_id, tag),
    )
    await db.commit()
    tags = await _fetch_tags(db, target_id)
    return {"target_id": target_id, "tags": tags}


# ── Pipeline template helper ──────────────────────────────────────────────────

async def _copy_pipeline_template(
    db: Database, target_id: str, template_name: str
) -> None:
    """Copy groups and steps from a pipeline template into the target's pipeline tables."""
    tpl_row = await db.fetchone(
        "SELECT config FROM pipeline_templates WHERE name = ?", (template_name,)
    )
    if not tpl_row:
        tpl_row = await db.fetchone(
            "SELECT config FROM pipeline_templates WHERE name = 'standard'"
        )
    if not tpl_row:
        log.warning(
            "No pipeline templates found — skipping pipeline copy for %s", target_id
        )
        return

    config = json.loads(tpl_row["config"])
    for group in config.get("groups", []):
        group_id = str(uuid.uuid4())
        await db.execute(
            """
            INSERT INTO pipeline_groups (id, target_id, position, name, parallel, enabled)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (
                group_id, target_id, group["position"],
                group["name"], 1 if group.get("parallel") else 0,
            ),
        )
        for step in group.get("steps", []):
            step_row_id = str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO pipeline_steps
                    (id, group_id, target_id, position, step_id, enabled)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    step_row_id, group_id, target_id,
                    step["position"], step["step_id"],
                    1 if step.get("enabled", True) else 0,
                ),
            )
