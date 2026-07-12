"""
Program (folder) API — group wildcard assets, run program-wide scans, and
serve aggregated cross-asset views.

A program owns DEFAULT scan config that inheriting assets copy (see
engine.programs_config). Deleting a program orphans its assets (their data is
untouched). Aggregated endpoints resolve to the program's asset target_ids and
reuse the same query shapes as the per-target endpoints in scans.py.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from engine.db import Database, get_db
from engine.api.schemas import (
    ProgramAssignAssets, ProgramCreate, ProgramOut, ProgramScanSessionOut,
    ProgramUpdate,
)
from engine.api.scans import (
    _paginate, _live_host_row, _status_bucket,
    _LIVE_HOST_SORT, _SUBDOMAIN_SORT, _PORTS_SORT, _TAKEOVER_SORT, _SEVERITY_CASE,
)
from engine.programs_config import apply_program_config, propagate_program_config
from engine import scheduler
from engine.websocket import ws_manager

log = logging.getLogger("engine.api.programs")
router = APIRouter(prefix="/programs", tags=["programs"])


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_program(row, asset_count: int = 0) -> ProgramOut:
    return ProgramOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        notify_scope=row["notify_scope"],
        pipeline_template=row["pipeline_template"],
        scan_priority=row["scan_priority"],
        rescan_interval=row["rescan_interval"],
        manual_only=bool(row["manual_only"]),
        loop=bool(row["loop"]),
        wildcard_policy=row["wildcard_policy"],
        retention_runs=row["retention_runs"],
        schedule_mode=row["schedule_mode"],
        schedule_days=row["schedule_days"],
        schedule_weekday=row["schedule_weekday"],
        schedule_hour=row["schedule_hour"],
        schedule_minute=row["schedule_minute"],
        asset_count=asset_count,
    )


async def _require_program(program_id: str, db: Database):
    row = await db.fetchone("SELECT * FROM programs WHERE id = ?", (program_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Program not found")
    return row


async def _asset_ids(db: Database, program_id: str) -> list[str]:
    rows = await db.fetchall(
        "SELECT id FROM targets WHERE program_id = ?", (program_id,)
    )
    return [r["id"] for r in rows]


async def _asset_domains(db: Database, program_id: str) -> dict[str, str]:
    rows = await db.fetchall(
        "SELECT id, domain FROM targets WHERE program_id = ?", (program_id,)
    )
    return {r["id"]: r["domain"] for r in rows}


# ── List / Create ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ProgramOut])
async def list_programs(db: Database = Depends(get_db)) -> list[ProgramOut]:
    rows = await db.fetchall("SELECT * FROM programs ORDER BY created_at DESC")
    counts = await db.fetchall(
        "SELECT program_id, COUNT(*) AS c FROM targets WHERE program_id IS NOT NULL GROUP BY program_id"
    )
    count_map = {r["program_id"]: r["c"] for r in counts}
    return [_row_to_program(r, count_map.get(r["id"], 0)) for r in rows]


@router.post("", response_model=ProgramOut, status_code=status.HTTP_201_CREATED)
async def create_program(
    body: ProgramCreate, db: Database = Depends(get_db)
) -> ProgramOut:
    existing = await db.fetchone(
        "SELECT id FROM programs WHERE name = ?", (body.name,)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Program '{body.name}' already exists",
        )

    program_id = str(uuid.uuid4())
    await db.execute(
        """
        INSERT INTO programs
          (id, name, description, created_at, notify_scope, pipeline_template,
           scan_priority, rescan_interval, manual_only, loop, wildcard_policy,
           retention_runs, schedule_mode, schedule_days, schedule_weekday,
           schedule_hour, schedule_minute)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            program_id, body.name, body.description, _now(), body.notify_scope,
            body.pipeline_template, body.scan_priority, body.rescan_interval,
            1 if body.manual_only else 0, 1 if body.loop else 0,
            body.wildcard_policy, body.retention_runs, body.schedule_mode,
            body.schedule_days, body.schedule_weekday, body.schedule_hour,
            body.schedule_minute,
        ),
    )
    await db.commit()
    log.info("Program created: %s (%s)", body.name, program_id)
    row = await db.fetchone("SELECT * FROM programs WHERE id = ?", (program_id,))
    return _row_to_program(row, 0)


# ── Single program CRUD ───────────────────────────────────────────────────────

@router.get("/{program_id}", response_model=ProgramOut)
async def get_program(program_id: str, db: Database = Depends(get_db)) -> ProgramOut:
    row = await _require_program(program_id, db)
    count = (await db.fetchone(
        "SELECT COUNT(*) AS c FROM targets WHERE program_id = ?", (program_id,)
    ))["c"]
    return _row_to_program(row, count)


@router.put("/{program_id}", response_model=ProgramOut)
async def update_program(
    program_id: str, body: ProgramUpdate, db: Database = Depends(get_db)
) -> ProgramOut:
    row = await _require_program(program_id, db)

    fields = {
        "name": body.name, "description": body.description,
        "notify_scope": body.notify_scope, "pipeline_template": body.pipeline_template,
        "scan_priority": body.scan_priority, "rescan_interval": body.rescan_interval,
        "wildcard_policy": body.wildcard_policy, "retention_runs": body.retention_runs,
        "schedule_mode": body.schedule_mode, "schedule_days": body.schedule_days,
        "schedule_weekday": body.schedule_weekday, "schedule_hour": body.schedule_hour,
        "schedule_minute": body.schedule_minute,
    }
    updates: list[str] = []
    params: list = []
    for col, val in fields.items():
        if val is not None:
            updates.append(f"{col} = ?")
            params.append(val)
    if body.manual_only is not None:
        updates.append("manual_only = ?")
        params.append(1 if body.manual_only else 0)
    if body.loop is not None:
        updates.append("loop = ?")
        params.append(1 if body.loop else 0)

    if body.name is not None and body.name != row["name"]:
        clash = await db.fetchone(
            "SELECT id FROM programs WHERE name = ? AND id != ?", (body.name, program_id)
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Program '{body.name}' already exists")

    pipeline_changed = (
        body.pipeline_template is not None
        and body.pipeline_template != row["pipeline_template"]
    )

    if updates:
        params.append(program_id)
        async with db.transaction():
            await db.execute(
                f"UPDATE programs SET {', '.join(updates)} WHERE id = ?", tuple(params)
            )
            await propagate_program_config(db, program_id, pipeline_changed=pipeline_changed)

    row = await db.fetchone("SELECT * FROM programs WHERE id = ?", (program_id,))
    count = (await db.fetchone(
        "SELECT COUNT(*) AS c FROM targets WHERE program_id = ?", (program_id,)
    ))["c"]
    return _row_to_program(row, count)


@router.delete("/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_program(program_id: str, db: Database = Depends(get_db)) -> None:
    await _require_program(program_id, db)
    async with db.transaction():
        # Orphan assets as standalone targets keeping their last-synced config.
        await db.execute(
            "UPDATE targets SET config_source = 'override' WHERE program_id = ?",
            (program_id,),
        )
        await db.execute("DELETE FROM programs WHERE id = ?", (program_id,))
    log.info("Program deleted (assets orphaned): %s", program_id)


# ── Asset membership ──────────────────────────────────────────────────────────

@router.get("/{program_id}/assets")
async def list_program_assets(program_id: str, db: Database = Depends(get_db)) -> list[dict]:
    await _require_program(program_id, db)
    rows = await db.fetchall(
        """
        SELECT id, domain, status, config_source, last_scan_at, scan_count
        FROM targets WHERE program_id = ? ORDER BY domain
        """,
        (program_id,),
    )
    return [dict(r) for r in rows]


@router.post("/{program_id}/assets", status_code=status.HTTP_200_OK)
async def assign_assets(
    program_id: str, body: ProgramAssignAssets, db: Database = Depends(get_db)
) -> dict:
    program = await _require_program(program_id, db)
    assigned = 0
    not_found: list[str] = []
    async with db.transaction():
        for tid in body.target_ids:
            trow = await db.fetchone("SELECT id FROM targets WHERE id = ?", (tid,))
            if not trow:
                not_found.append(tid)
                continue
            await db.execute(
                "UPDATE targets SET program_id = ?, config_source = ? WHERE id = ?",
                (program_id, body.config_source, tid),
            )
            if body.config_source == "inherit":
                await apply_program_config(db, tid, program, copy_pipeline=True)
            assigned += 1
    log.info("Program %s: assigned %d asset(s), %d not found",
             program_id, assigned, len(not_found))
    return {"assigned": assigned, "not_found": not_found}


@router.delete("/{program_id}/assets/{target_id}", status_code=status.HTTP_200_OK)
async def unassign_asset(
    program_id: str, target_id: str, db: Database = Depends(get_db)
) -> dict:
    await _require_program(program_id, db)
    row = await db.fetchone(
        "SELECT id FROM targets WHERE id = ? AND program_id = ?", (target_id, program_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Asset not in this program")
    await db.execute(
        "UPDATE targets SET program_id = NULL, config_source = 'override' WHERE id = ?",
        (target_id,),
    )
    await db.commit()
    return {"unassigned": target_id}


# ── Program scan (fan-out) ────────────────────────────────────────────────────

@router.post("/{program_id}/scan", status_code=202)
async def scan_program(program_id: str, db: Database = Depends(get_db)) -> dict:
    await _require_program(program_id, db)
    ids = await _asset_ids(db, program_id)
    if not ids:
        raise HTTPException(status_code=409, detail="Program has no assets to scan")

    ps_id = str(uuid.uuid4())
    queued = 0
    async with db.transaction():
        await db.execute(
            """
            INSERT INTO program_scan_sessions
              (id, program_id, started_at, status, asset_total, asset_done)
            VALUES (?, ?, ?, 'running', ?, 0)
            """,
            (ps_id, program_id, _now(), len(ids)),
        )
        for tid in ids:
            trow = await db.fetchone("SELECT status FROM targets WHERE id = ?", (tid,))
            tstatus = trow["status"] if trow else "idle"
            tracked_session = None
            if tstatus in ("running", "paused"):
                srow = await db.fetchone(
                    """
                    SELECT id FROM scan_sessions
                    WHERE target_id = ? AND status IN ('running', 'paused')
                    ORDER BY started_at DESC LIMIT 1
                    """,
                    (tid,),
                )
                tracked_session = srow["id"] if srow else None
            await db.execute(
                """
                INSERT INTO program_scan_assets
                    (id, program_session_id, target_id, session_id, status)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()), ps_id, tid, tracked_session,
                    "running" if tracked_session else "queued",
                ),
            )
            if tstatus != "running" and tid not in scheduler.get_queue():
                scheduler.enqueue_manual(tid)
                await db.execute(
                    "UPDATE targets SET status='idle' WHERE id=? AND status NOT IN ('running','paused')",
                    (tid,),
                )
                queued += 1

    await ws_manager.broadcast(
        "program_scan_queued",
        {"program_id": program_id, "program_session_id": ps_id, "queued": queued},
    )
    log.info("Program scan %s: queued %d/%d asset(s)", ps_id, queued, len(ids))
    return {"program_session_id": ps_id, "queued": queued, "asset_total": len(ids)}


@router.get("/{program_id}/scan-sessions", response_model=list[ProgramScanSessionOut])
async def list_program_scans(
    program_id: str, db: Database = Depends(get_db)
) -> list[ProgramScanSessionOut]:
    await _require_program(program_id, db)
    rows = await db.fetchall(
        """
        SELECT id, program_id, started_at, finished_at, status,
               asset_total, asset_done, stats
        FROM program_scan_sessions
        WHERE program_id = ? ORDER BY started_at DESC LIMIT 50
        """,
        (program_id,),
    )
    out: list[ProgramScanSessionOut] = []
    for r in rows:
        stats = None
        if r["stats"]:
            try:
                stats = json.loads(r["stats"])
            except (ValueError, TypeError):
                pass
        out.append(ProgramScanSessionOut(
            id=r["id"], program_id=r["program_id"], started_at=r["started_at"],
            finished_at=r["finished_at"], status=r["status"],
            asset_total=r["asset_total"], asset_done=r["asset_done"], stats=stats,
        ))
    return out


# ── Aggregated cross-asset views ──────────────────────────────────────────────

@router.get("/{program_id}/subdomains")
async def program_subdomains(
    program_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Database = Depends(get_db),
) -> dict:
    await _require_program(program_id, db)
    domains = await _asset_domains(db, program_id)
    ids = list(domains.keys())
    if not ids:
        return _paginate([], 0, page, per_page)

    sort_col = sort_by if sort_by in _SUBDOMAIN_SORT else "first_seen"
    ph = ",".join("?" * len(ids))
    where = f"WHERE target_id IN ({ph}) AND in_scope = 1"
    params: list = list(ids)
    if q:
        where += " AND subdomain LIKE ?"
        params.append(f"%{q}%")

    total = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM subdomains {where}", tuple(params)
    ))["n"]
    rows = await db.fetchall(
        f"""
        SELECT id, target_id, subdomain, sources, first_seen, last_seen, is_live
        FROM subdomains {where}
        ORDER BY {sort_col} {sort_dir.upper()}, id LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )

    def _row(r) -> dict:
        sources = None
        if r["sources"]:
            try:
                sources = json.loads(r["sources"])
            except (ValueError, TypeError):
                sources = [r["sources"]]
        return {
            "id": r["id"],
            "target_id": r["target_id"],
            "asset_domain": domains.get(r["target_id"]),
            "subdomain": r["subdomain"],
            "sources": sources,
            "first_seen": r["first_seen"],
            "last_seen": r["last_seen"],
            "is_live": bool(r["is_live"]),
        }

    return _paginate([_row(r) for r in rows], total, page, per_page)


@router.get("/{program_id}/live-hosts")
async def program_live_hosts(
    program_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    status_code: int | None = Query(None),
    db: Database = Depends(get_db),
) -> dict:
    await _require_program(program_id, db)
    domains = await _asset_domains(db, program_id)
    ids = list(domains.keys())
    if not ids:
        return _paginate([], 0, page, per_page)

    sort_col = sort_by if sort_by in _LIVE_HOST_SORT else "first_seen"
    ph = ",".join("?" * len(ids))
    where = f"WHERE target_id IN ({ph}) AND in_scope = 1"
    params: list = list(ids)
    if status_code is not None:
        where += " AND status_code = ?"
        params.append(status_code)
    if q:
        where += " AND (url LIKE ? OR title LIKE ? OR webserver LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

    total = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM live_hosts {where}", tuple(params)
    ))["n"]
    rows = await db.fetchall(
        f"""
        SELECT id, target_id, subdomain_id, url, status_code, title,
               content_length, content_type, webserver, tech,
               host, port, scheme, final_url,
               tls_version, tls_cipher, tls_subject_cn, tls_issuer,
               tls_not_before, tls_not_after,
               tls_self_signed, tls_expired, tls_mismatched,
               cname, cdn, cdn_name, a_records, aaaa_records,
               response_hash, response_time,
               has_csp, has_xfo, has_xcto, has_hsts,
               waf, first_seen, last_seen, last_status, last_title,
               screenshot_path
        FROM live_hosts {where}
        ORDER BY {sort_col} {sort_dir.upper()}, id LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )

    def _row(r) -> dict:
        base = _live_host_row(r)
        base["asset_domain"] = domains.get(r["target_id"])
        return base

    return _paginate([_row(r) for r in rows], total, page, per_page)


@router.get("/{program_id}/ports")
async def program_ports(
    program_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Database = Depends(get_db),
) -> dict:
    await _require_program(program_id, db)
    domains = await _asset_domains(db, program_id)
    ids = list(domains.keys())
    if not ids:
        return _paginate([], 0, page, per_page)

    sort_col = f"nr.{sort_by}" if sort_by in _PORTS_SORT else "nr.host, nr.port"
    ph = ",".join("?" * len(ids))
    extra = ""
    params: list = list(ids)
    if q:
        extra = " AND (nr.host LIKE ? OR nr.service LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])

    base_q = f"""
        SELECT nr.host, nr.ip, nr.port, nr.protocol, nr.service, nr.service_version,
               nr.target_id,
               GROUP_CONCAT(DISTINCT lh.host) AS subdomains
        FROM naabu_results nr
        LEFT JOIN live_hosts lh
            ON lh.target_id = nr.target_id
            AND (lh.host = nr.host OR EXISTS (
                SELECT 1 FROM json_each(lh.a_records) WHERE json_each.value = nr.host
            ))
        WHERE nr.target_id IN ({ph}){extra}
        GROUP BY nr.host, nr.port, nr.protocol
    """
    total = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM ({base_q}) AS sub", tuple(params)
    ))["n"]
    rows = await db.fetchall(
        base_q + f" ORDER BY {sort_col} {sort_dir.upper()}, nr.host, nr.port, nr.protocol LIMIT ? OFFSET ?",
        tuple(params) + (per_page, (page - 1) * per_page),
    )
    return _paginate(
        [
            {
                "host": r["host"],
                "ip": r["ip"],
                "port": r["port"],
                "protocol": r["protocol"],
                "service": r["service"],
                "service_version": r["service_version"],
                "target_id": r["target_id"],
                "asset_domain": domains.get(r["target_id"]),
                "subdomains": r["subdomains"].split(",") if r["subdomains"] else [],
            }
            for r in rows
        ],
        total, page, per_page,
    )


@router.get("/{program_id}/takeovers")
async def program_takeovers(
    program_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: str | None = Query(None),
    sort_by: str | None = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    db: Database = Depends(get_db),
) -> dict:
    await _require_program(program_id, db)
    domains = await _asset_domains(db, program_id)
    ids = list(domains.keys())
    if not ids:
        return _paginate([], 0, page, per_page)

    ph = ",".join("?" * len(ids))
    where = f"WHERE target_id IN ({ph})"
    params: list = list(ids)
    if q:
        where += " AND subdomain LIKE ?"
        params.append(f"%{q}%")

    if sort_by in _TAKEOVER_SORT:
        order_clause = f"{sort_by} {sort_dir.upper()}, id"
    else:
        order_clause = f"{_SEVERITY_CASE}, subdomain ASC, id"

    total = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM nuclei_takeover_results {where}", tuple(params)
    ))["n"]
    rows = await db.fetchall(
        f"""
        SELECT id, target_id, session_id, subdomain, url, template_id,
               service, severity, matched_at, verified
        FROM nuclei_takeover_results {where}
        ORDER BY {order_clause} LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )
    return _paginate(
        [
            {
                "id": r["id"],
                "target_id": r["target_id"],
                "asset_domain": domains.get(r["target_id"]),
                "session_id": r["session_id"],
                "subdomain": r["subdomain"],
                "url": r["url"],
                "template_id": r["template_id"],
                "service": r["service"],
                "severity": r["severity"],
                "matched_at": r["matched_at"],
                "verified": r["verified"],
            }
            for r in rows
        ],
        total, page, per_page,
    )


@router.get("/{program_id}/stats")
async def program_stats(program_id: str, db: Database = Depends(get_db)) -> dict:
    await _require_program(program_id, db)
    domains = await _asset_domains(db, program_id)
    ids = list(domains.keys())
    if not ids:
        return {
            "totals": {"assets": 0, "subdomains": 0, "hosts": 0, "takeovers": 0},
            "by_asset": [], "status_dist": [],
        }

    ph = ",".join("?" * len(ids))
    t = tuple(ids)
    total_subs = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM subdomains WHERE target_id IN ({ph}) AND in_scope = 1", t
    ))["n"]
    total_hosts = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM live_hosts WHERE target_id IN ({ph}) AND in_scope = 1", t
    ))["n"]
    total_takeovers = (await db.fetchone(
        f"SELECT COUNT(*) AS n FROM nuclei_takeover_results WHERE target_id IN ({ph})", t
    ))["n"]

    sub_rows = await db.fetchall(
        f"SELECT target_id, COUNT(*) AS n FROM subdomains WHERE target_id IN ({ph}) AND in_scope = 1 GROUP BY target_id",
        t,
    )
    sub_by_target = {r["target_id"]: r["n"] for r in sub_rows}
    host_rows = await db.fetchall(
        f"SELECT target_id, COUNT(*) AS n FROM live_hosts WHERE target_id IN ({ph}) AND in_scope = 1 GROUP BY target_id",
        t,
    )
    host_by_target = {r["target_id"]: r["n"] for r in host_rows}

    by_asset = [
        {
            "target_id": tid,
            "domain": dom,
            "subdomains": sub_by_target.get(tid, 0),
            "hosts": host_by_target.get(tid, 0),
        }
        for tid, dom in domains.items()
    ]

    status_rows = await db.fetchall(
        f"""
        SELECT status_code, COUNT(*) AS n FROM live_hosts
        WHERE target_id IN ({ph}) AND in_scope = 1 AND status_code IS NOT NULL
        GROUP BY status_code ORDER BY n DESC LIMIT 20
        """,
        t,
    )
    status_dist: dict[str, int] = {}
    for r in status_rows:
        bucket = _status_bucket(r["status_code"])
        status_dist[bucket] = status_dist.get(bucket, 0) + r["n"]

    return {
        "totals": {
            "assets": len(ids),
            "subdomains": total_subs,
            "hosts": total_hosts,
            "takeovers": total_takeovers,
        },
        "by_asset": by_asset,
        "status_dist": [{"bucket": k, "count": v} for k, v in status_dist.items()],
    }
