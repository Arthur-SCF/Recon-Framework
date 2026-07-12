"""
Scan control endpoints.

POST   /targets/{target_id}/start     — trigger immediate scan
POST   /targets/{target_id}/pause     — pause active scan
POST   /targets/{target_id}/resume    — resume paused scan
POST   /targets/{target_id}/cancel    — cancel active/paused scan
GET    /targets/{target_id}/sessions  — list scan sessions
GET    /targets/{target_id}/sessions/{session_id}/steps — step run log
POST   /targets/{target_id}/sessions/{session_id}/steps/{step_id}/rerun — rerun one step
"""
from __future__ import annotations

import json
import logging

import os

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from engine.db import Database, get_db
from engine.api.schemas import ScanSessionOut, StepRunOut, LiveHostOut, DiffEventOut
from engine import scheduler
from engine.websocket import ws_manager


def _paginate(rows: list, total: int, page: int, per_page: int) -> dict:
    return {"data": rows, "total": total, "page": page, "per_page": per_page}

log = logging.getLogger("engine.api.scans")
router = APIRouter(tags=["scans"])


def _to_session(row) -> ScanSessionOut:
    stats = None
    if row["stats"]:
        try:
            stats = json.loads(row["stats"])
        except Exception:
            pass
    return ScanSessionOut(
        id=row["id"],
        target_id=row["target_id"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        status=row["status"],
        current_step=row["current_step"],
        paused_at=row["paused_at"],
        pause_type=row["pause_type"],
        stats=stats,
    )


async def _require_target(target_id: str, db: Database) -> None:
    row = await db.fetchone("SELECT id FROM targets WHERE id=?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")


# ── Scan control ───────────────────────────────────────────────────────────────

@router.post("/targets/{target_id}/start", status_code=202)
async def start_scan(target_id: str, db: Database = Depends(get_db)):
    await _require_target(target_id, db)

    # Atomic check: reject if already running or already queued
    row = await db.fetchone("SELECT status FROM targets WHERE id=?", (target_id,))
    if row["status"] == "running":
        raise HTTPException(status_code=409, detail="Scan already running for this target")
    if target_id in scheduler.get_queue():
        raise HTTPException(status_code=409, detail="Scan already queued for this target")

    scheduler.enqueue_manual(target_id)
    # Clear loop_stopped (or any stale status) so the UI shows idle immediately
    await db.execute(
        "UPDATE targets SET status='idle' WHERE id=? AND status NOT IN ('running', 'paused')",
        (target_id,),
    )
    await db.commit()
    await ws_manager.broadcast("scan_queued", {"target_id": target_id}, target_id=target_id)
    return {"queued": True, "target_id": target_id}


@router.post("/targets/{target_id}/pause", status_code=202)
async def pause_scan(target_id: str, db: Database = Depends(get_db)):
    await _require_target(target_id, db)

    row = await db.fetchone(
        "SELECT id FROM scan_sessions WHERE target_id=? AND status='running'",
        (target_id,),
    )
    if not row:
        raise HTTPException(status_code=409, detail="No running scan to pause")

    from datetime import datetime, timezone
    now = datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    await db.execute(
        "UPDATE scan_sessions SET status='paused', pause_type='manual', paused_at=? WHERE id=?",
        (now, row["id"]),
    )
    await db.execute("UPDATE targets SET status='paused' WHERE id=?", (target_id,))
    await db.commit()
    return {"paused": True, "session_id": row["id"]}


@router.post("/targets/{target_id}/resume", status_code=202)
async def resume_scan(target_id: str, db: Database = Depends(get_db)):
    await _require_target(target_id, db)

    row = await db.fetchone(
        "SELECT id FROM scan_sessions WHERE target_id=? AND status='paused'",
        (target_id,),
    )
    if not row:
        raise HTTPException(status_code=409, detail="No paused scan to resume")

    session_id = row["id"]

    # If another scan is currently running, queue the resume rather than
    # launching a second pipeline concurrently.  The scheduler's auto-resume
    # flow (pause_type='queued_resume') will pick it up within 10 s once the
    # active scan finishes.
    running_row = await db.fetchone(
        "SELECT target_id FROM scan_sessions WHERE status='running' LIMIT 1", ()
    )
    if running_row:
        await db.execute(
            """
            UPDATE scan_sessions
            SET pause_type='queued_resume', resume_after=?
            WHERE id=?
            """,
            (running_row["target_id"], session_id),
        )
        await db.commit()
        return {"resumed": False, "queued": True, "session_id": session_id}

    await db.execute(
        """
        UPDATE scan_sessions
        SET status='running', paused_at=NULL, pause_type=NULL, resume_after=NULL
        WHERE id=?
        """,
        (session_id,),
    )
    await db.execute("UPDATE targets SET status='running' WHERE id=?", (target_id,))
    await db.commit()

    # Get domain and re-launch pipeline (runner will skip completed steps)
    target_row = await db.fetchone("SELECT domain FROM targets WHERE id=?", (target_id,))
    domain = target_row["domain"]

    import asyncio
    from engine.pipeline.runner import run_pipeline
    asyncio.create_task(
        run_pipeline(db, session_id, target_id, domain, is_resume=True),
        name=f"pipeline-{session_id[:8]}",
    )

    return {"resumed": True, "session_id": session_id}


@router.post("/targets/{target_id}/cancel", status_code=202)
async def cancel_scan(target_id: str, db: Database = Depends(get_db)):
    await _require_target(target_id, db)

    row = await db.fetchone(
        "SELECT id FROM scan_sessions WHERE target_id=? AND status IN ('running','paused')",
        (target_id,),
    )
    if not row:
        raise HTTPException(status_code=409, detail="No active scan to cancel")

    from datetime import datetime, timezone
    now = datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    await db.execute(
        "UPDATE scan_sessions SET status='cancelled', finished_at=? WHERE id=?",
        (now, row["id"]),
    )
    await db.execute(
        "UPDATE step_runs SET status='error', finished_at=? WHERE session_id=? AND status='running'",
        (now, row["id"]),
    )
    # Loop targets move to 'loop_stopped' on cancel so the scheduler
    # doesn't immediately restart them. A manual "Scan Now" re-enables the loop.
    target_row = await db.fetchone("SELECT loop FROM targets WHERE id=?", (target_id,))
    cancelled_status = "loop_stopped" if (target_row and target_row["loop"]) else "idle"
    await db.execute("UPDATE targets SET status=? WHERE id=?", (cancelled_status, target_id))
    await db.commit()

    # Remove from manual queue if present
    scheduler.remove_from_queue(target_id)

    # Notify connected frontends so TargetDetail updates without a reload
    try:
        await ws_manager.broadcast(
            "scan_cancelled",
            {"session_id": row["id"], "target_id": target_id},
            target_id=target_id,
            session_id=row["id"],
        )
    except Exception as exc:
        log.warning("WS broadcast failed in cancel_scan: %r", exc)

    return {"cancelled": True, "session_id": row["id"]}


# ── Session listing ────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/sessions", response_model=list[ScanSessionOut])
async def list_sessions(target_id: str, db: Database = Depends(get_db)):
    await _require_target(target_id, db)
    rows = await db.fetchall(
        """
        SELECT id, target_id, started_at, finished_at, status,
               current_step, paused_at, pause_type, stats
        FROM scan_sessions
        WHERE target_id = ?
        ORDER BY started_at DESC
        LIMIT 50
        """,
        (target_id,),
    )
    return [_to_session(r) for r in rows]


# ── Step run log ───────────────────────────────────────────────────────────────

@router.get(
    "/targets/{target_id}/sessions/{session_id}/steps",
    response_model=list[StepRunOut],
)
async def list_step_runs(
    target_id: str,
    session_id: str,
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)
    rows = await db.fetchall(
        """
        SELECT id, session_id, target_id, step_id, tool_id, status,
               command, stderr_snippet, result_count,
               started_at, finished_at, execution_time
        FROM step_runs
        WHERE session_id = ? AND target_id = ?
        ORDER BY started_at ASC NULLS LAST
        """,
        (session_id, target_id),
    )

    def _to_step(r) -> StepRunOut:
        cmd = None
        if r["command"]:
            try:
                cmd = json.loads(r["command"])
            except Exception:
                cmd = [r["command"]]
        return StepRunOut(
            id=r["id"],
            session_id=r["session_id"],
            target_id=r["target_id"],
            step_id=r["step_id"],
            tool_id=r["tool_id"],
            status=r["status"],
            command=cmd,
            stderr_snippet=r["stderr_snippet"],
            result_count=r["result_count"],
            started_at=r["started_at"],
            finished_at=r["finished_at"],
            execution_time=r["execution_time"],
        )

    return [_to_step(r) for r in rows]


# ── Step results ───────────────────────────────────────────────────────────────

# Maps step_id → (table, column) for direct tool result tables
_TOOL_RESULT_TABLES: dict[str, tuple[str, str]] = {
    "subfinder":           ("subfinder_results",    "subdomain"),
    "amass":               ("amass_results",        "subdomain"),
    "tlsx":                ("tlsx_results",         "subdomain"),
    "assetfinder":         ("assetfinder_results",  "subdomain"),
    "crt_sh":              ("ctl_results",          "subdomain"),
    "puredns_default":     ("puredns_results",      "subdomain"),
    "puredns_permutation": ("puredns_results",      "subdomain"),
    "alterx":              ("alterx_results",       "subdomain"),
    "katana":              ("katana_results",       "subdomain"),
    "subdomainizer":       ("subdomainizer_results","subdomain"),
}

_CONSOLIDATION_ROUND: dict[str, str] = {
    "consolidate_r1": "r1",
    "consolidate_r2": "r2",
    "consolidate_r3": "r3",
}

_HTTPX_STEPS = {"httpx_r1", "httpx_r2", "httpx_r3"}


@router.get(
    "/targets/{target_id}/sessions/{session_id}/steps/{step_id}/results",
)
async def get_step_results(
    target_id: str,
    session_id: str,
    step_id: str,
    db: Database = Depends(get_db),
):
    """
    Return structured results for a single step run.
    - Subdomain tools → list of subdomains from the tool's table, filtered by step_run_id.
    - Consolidation steps → new subdomains first seen in this session+round.
    - Httpx steps → redirect hint (live_hosts are queryable on Live Hosts tab).
    """
    await _require_target(target_id, db)

    step_run = await db.fetchone(
        """
        SELECT id, result_count, status FROM step_runs
        WHERE session_id = ? AND step_id = ?
        ORDER BY started_at DESC
        LIMIT 1
        """,
        (session_id, step_id),
    )
    if not step_run:
        raise HTTPException(status_code=404, detail="Step run not found")

    step_run_id   = step_run["id"]
    result_count  = step_run["result_count"] or 0

    # Consolidation steps — show all subdomains consolidated in this round for this target
    if step_id in _CONSOLIDATION_ROUND:
        round_key = _CONSOLIDATION_ROUND[step_id]
        rows = await db.fetchall(
            """
            SELECT subdomain FROM subdomains
            WHERE target_id = ? AND in_scope = 1 AND consolidated_in LIKE ?
            ORDER BY subdomain
            LIMIT 2000
            """,
            (target_id, f'%"{round_key}"%'),
        )
        return {
            "type":  "subdomains",
            "count": result_count,
            "items": [r["subdomain"] for r in rows],
        }

    # Gau — stores URLs; extract distinct non-null subdomains
    if step_id == "gau":
        rows = await db.fetchall(
            """
            SELECT DISTINCT subdomain FROM gau_results
            WHERE step_run_id = ? AND subdomain IS NOT NULL
            ORDER BY subdomain
            LIMIT 2000
            """,
            (step_run_id,),
        )
        return {
            "type":  "subdomains",
            "count": result_count,
            "items": [r["subdomain"] for r in rows],
        }

    # Standard subdomain tools
    if step_id in _TOOL_RESULT_TABLES:
        table, col = _TOOL_RESULT_TABLES[step_id]
        rows = await db.fetchall(
            f"SELECT {col} FROM {table} WHERE step_run_id = ? ORDER BY {col} LIMIT 2000",
            (step_run_id,),
        )
        return {
            "type":  "subdomains",
            "count": result_count,
            "items": [r[col] for r in rows],
        }

    # Httpx steps — live hosts aren't keyed by step_run_id; send user to Live Hosts tab
    if step_id in _HTTPX_STEPS:
        return {
            "type":  "live_hosts",
            "count": result_count,
            "items": [],
        }

    # Naabu — port scan results formatted as host:port
    if step_id == "naabu":
        rows = await db.fetchall(
            """
            SELECT host, port FROM naabu_results
            WHERE step_run_id = ?
            ORDER BY host, port
            LIMIT 2000
            """,
            (step_run_id,),
        )
        return {
            "type":  "list",
            "count": result_count,
            "items": [f"{r['host']}:{r['port']}" for r in rows],
        }

    # GoWitness — screenshots are tied to live_hosts; redirect to that tab
    if step_id == "gowitness":
        return {
            "type":  "screenshots",
            "count": result_count,
            "items": [],
        }

    # Nuclei takeover — format findings as readable strings; redirect to Takeover tab
    if step_id == "nuclei_takeover":
        rows = await db.fetchall(
            """
            SELECT subdomain, template_id, severity
            FROM nuclei_takeover_results
            WHERE step_run_id = ?
            ORDER BY severity, subdomain
            LIMIT 500
            """,
            (step_run_id,),
        )
        return {
            "type":  "takeovers",
            "count": result_count,
            "items": [
                f"[{r['severity'] or 'info'}] {r['subdomain']} — {r['template_id'] or '?'}"
                for r in rows
            ],
        }

    # Cloud Enum — cloud asset findings
    if step_id == "cloud_enum":
        rows = await db.fetchall(
            """
            SELECT url, asset_type FROM cloud_enum_results
            WHERE step_run_id = ?
            ORDER BY asset_type, url
            LIMIT 500
            """,
            (step_run_id,),
        )
        return {
            "type":  "cloud_assets",
            "count": result_count,
            "items": [f"[{r['asset_type']}] {r['url']}" for r in rows],
        }

    # CeWL — custom wordlist words
    if step_id == "cewl":
        rows = await db.fetchall(
            "SELECT word FROM cewl_results WHERE step_run_id = ? ORDER BY word LIMIT 5000",
            (step_run_id,),
        )
        return {
            "type":  "list",
            "count": result_count,
            "items": [r["word"] for r in rows],
        }

    return {"type": "none", "count": result_count, "items": []}


@router.get(
    "/targets/{target_id}/sessions/{session_id}/steps/{step_id}/stdout",
)
async def get_step_stdout(
    target_id: str,
    session_id: str,
    step_id: str,
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)
    target_row = await db.fetchone("SELECT domain FROM targets WHERE id=?", (target_id,))
    if not target_row:
        raise HTTPException(status_code=404, detail="Target not found")

    from engine.storage import read_stdout, read_stderr
    stdout  = read_stdout(target_row["domain"], session_id, step_id)
    stderr  = read_stderr(target_row["domain"], session_id, step_id)
    parts: list[str] = []
    if stdout:
        parts.append(stdout)
    if stderr:
        parts.append(("--- stderr ---\n" if parts else "") + stderr)
    if not parts:
        raise HTTPException(status_code=404, detail="No output available")
    return {"step_id": step_id, "content": "\n".join(parts)}


# ── Subdomains ─────────────────────────────────────────────────────────────────

_SUBDOMAIN_SORT = {"subdomain", "first_seen", "last_seen", "is_live"}


@router.get("/targets/{target_id}/subdomains")
async def list_subdomains(
    target_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)

    sort_col = sort_by if sort_by in _SUBDOMAIN_SORT else "first_seen"
    where = "WHERE target_id = ? AND in_scope = 1"
    params: list = [target_id]
    if q:
        where += " AND subdomain LIKE ?"
        params.append(f"%{q}%")

    total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM subdomains {where}", tuple(params)
    )
    total = total_row["n"] if total_row else 0

    rows = await db.fetchall(
        f"""
        SELECT id, subdomain, sources, first_seen, last_seen,
               is_live, consolidated_in
        FROM subdomains
        {where}
        ORDER BY {sort_col} {sort_dir.upper()}, id
        LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )
    import json as _json

    def _row(r) -> dict:
        sources = None
        if r["sources"]:
            try:
                sources = _json.loads(r["sources"])
            except Exception:
                sources = [r["sources"]]
        rounds = None
        if r["consolidated_in"]:
            try:
                rounds = _json.loads(r["consolidated_in"])
            except Exception:
                rounds = [r["consolidated_in"]]
        return {
            "id":              r["id"],
            "subdomain":       r["subdomain"],
            "sources":         sources,
            "first_seen":      r["first_seen"],
            "last_seen":       r["last_seen"],
            "is_live":         bool(r["is_live"]),
            "consolidated_in": rounds,
        }

    return _paginate([_row(r) for r in rows], total, page, per_page)


@router.get("/targets/{target_id}/subdomains/stats")
async def get_subdomain_stats(target_id: str, db: Database = Depends(get_db)):
    """Counts of subdomains by live status, source tool, and consolidation round."""
    await _require_target(target_id, db)
    total = (await db.fetchone(
        "SELECT COUNT(*) n FROM subdomains WHERE target_id = ? AND in_scope = 1", (target_id,)
    ))["n"]
    live = (await db.fetchone(
        "SELECT COUNT(*) n FROM subdomains WHERE target_id = ? AND in_scope = 1 AND is_live = 1", (target_id,)
    ))["n"]
    src_rows = await db.fetchall(
        """
        SELECT json_each.value AS src, COUNT(*) AS cnt
        FROM subdomains, json_each(sources)
        WHERE target_id = ? AND in_scope = 1
        GROUP BY src ORDER BY cnt DESC
        """,
        (target_id,),
    )
    rnd_rows = await db.fetchall(
        """
        SELECT json_each.value AS rnd, COUNT(*) AS cnt
        FROM subdomains, json_each(consolidated_in)
        WHERE target_id = ? AND in_scope = 1
        GROUP BY rnd
        """,
        (target_id,),
    )
    return {
        "total":     total,
        "live":      live,
        "by_source": {r["src"]: r["cnt"] for r in src_rows},
        "by_round":  {r["rnd"]: r["cnt"] for r in rnd_rows},
    }


# ── Live Hosts ─────────────────────────────────────────────────────────────────

_LIVE_HOST_SELECT = """
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
    FROM live_hosts
"""


def _parse_json_list(raw) -> list[str] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _live_host_row(r) -> dict:
    return {
        "id":             r["id"],
        "target_id":      r["target_id"],
        "subdomain_id":   r["subdomain_id"],
        "url":            r["url"],
        "status_code":    r["status_code"],
        "title":          r["title"],
        "content_length": r["content_length"],
        "content_type":   r["content_type"],
        "webserver":      r["webserver"],
        "tech":           _parse_json_list(r["tech"]),
        "host":           r["host"],
        "port":           r["port"],
        "scheme":         r["scheme"],
        "final_url":      r["final_url"],
        "tls_version":    r["tls_version"],
        "tls_cipher":     r["tls_cipher"],
        "tls_subject_cn": r["tls_subject_cn"],
        "tls_issuer":     r["tls_issuer"],
        "tls_not_before": r["tls_not_before"],
        "tls_not_after":  r["tls_not_after"],
        "tls_self_signed": bool(r["tls_self_signed"]) if r["tls_self_signed"] is not None else None,
        "tls_expired":    bool(r["tls_expired"]) if r["tls_expired"] is not None else None,
        "tls_mismatched": bool(r["tls_mismatched"]) if r["tls_mismatched"] is not None else None,
        "cname":          r["cname"],
        "cdn":            bool(r["cdn"]) if r["cdn"] is not None else None,
        "cdn_name":       r["cdn_name"],
        "a_records":      _parse_json_list(r["a_records"]),
        "aaaa_records":   _parse_json_list(r["aaaa_records"]),
        "response_hash":  r["response_hash"],
        "response_time":  r["response_time"],
        "has_csp":        bool(r["has_csp"]) if r["has_csp"] is not None else None,
        "has_xfo":        bool(r["has_xfo"]) if r["has_xfo"] is not None else None,
        "has_xcto":       bool(r["has_xcto"]) if r["has_xcto"] is not None else None,
        "has_hsts":       bool(r["has_hsts"]) if r["has_hsts"] is not None else None,
        "waf":            r["waf"],
        "first_seen":      r["first_seen"],
        "last_seen":       r["last_seen"],
        "last_status":     r["last_status"],
        "last_title":      r["last_title"],
        "screenshot_path": r["screenshot_path"],
    }


_LIVE_HOST_SORT = {"url", "status_code", "title", "webserver", "first_seen", "last_seen", "response_time"}

_STATUS_CODE_BUCKET = {
    range(200, 300): "2xx",
    range(300, 400): "3xx",
    range(400, 500): "4xx",
    range(500, 600): "5xx",
}


def _status_bucket(code: int | None) -> str:
    if code is None:
        return "other"
    for r, label in _STATUS_CODE_BUCKET.items():
        if code in r:
            return label
    return "other"


@router.get("/targets/{target_id}/live-hosts/stats")
async def live_hosts_stats(
    target_id: str,
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)
    rows = await db.fetchall(
        "SELECT status_code, COUNT(*) AS n FROM live_hosts WHERE target_id = ? AND in_scope = 1 GROUP BY status_code",
        (target_id,),
    )
    by_status: dict[str, int] = {}
    for r in rows:
        bucket = _status_bucket(r["status_code"])
        by_status[bucket] = by_status.get(bucket, 0) + r["n"]
    return {"by_status_code": by_status}


@router.get("/targets/{target_id}/live-hosts")
async def list_live_hosts(
    target_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    status_code: Optional[int] = Query(None),
    status_code_gte: Optional[int] = Query(None),
    status_code_lte: Optional[int] = Query(None),
    scheme: Optional[str] = Query(None),
    has_screenshot: Optional[bool] = Query(None),
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)

    sort_col = sort_by if sort_by in _LIVE_HOST_SORT else "first_seen"
    where = "WHERE target_id = ? AND in_scope = 1"
    params: list = [target_id]

    if status_code is not None:
        where += " AND status_code = ?"
        params.append(status_code)
    elif status_code_gte is not None or status_code_lte is not None:
        if status_code_gte is not None:
            where += " AND status_code >= ?"
            params.append(status_code_gte)
        if status_code_lte is not None:
            where += " AND status_code <= ?"
            params.append(status_code_lte)
    if scheme is not None:
        where += " AND scheme = ?"
        params.append(scheme)
    if has_screenshot is True:
        where += " AND screenshot_path IS NOT NULL"
    if q:
        where += " AND (url LIKE ? OR title LIKE ? OR webserver LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

    total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM live_hosts {where}", tuple(params)
    )
    total = total_row["n"] if total_row else 0

    rows = await db.fetchall(
        _LIVE_HOST_SELECT + f"""
        {where}
        ORDER BY {sort_col} {sort_dir.upper()}, id
        LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )
    return _paginate([_live_host_row(r) for r in rows], total, page, per_page)


@router.get("/targets/{target_id}/hosts/{host_id}")
async def get_live_host(
    target_id: str,
    host_id: str,
    db: Database = Depends(get_db),
):
    """Full detail for a single live host."""
    await _require_target(target_id, db)
    row = await db.fetchone(
        _LIVE_HOST_SELECT + " WHERE id = ? AND target_id = ? AND in_scope = 1",
        (host_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Host not found")
    return _live_host_row(row)


@router.get("/targets/{target_id}/hosts/{host_id}/history")
async def get_host_history(
    target_id: str,
    host_id: str,
    db: Database = Depends(get_db),
):
    """All live_hosts_history diff events for a specific host."""
    await _require_target(target_id, db)
    # Verify host belongs to this target
    exists = await db.fetchone(
        "SELECT id FROM live_hosts WHERE id = ? AND target_id = ?",
        (host_id, target_id),
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Host not found")
    rows = await db.fetchall(
        """
        SELECT id, live_host_id, session_id, url, event_type,
               status_code, title, webserver, changes, recorded_at
        FROM live_hosts_history
        WHERE live_host_id = ? AND target_id = ?
        ORDER BY recorded_at DESC LIMIT 100
        """,
        (host_id, target_id),
    )

    def _hrow(r) -> dict:
        changes = None
        if r["changes"]:
            try:
                changes = json.loads(r["changes"])
            except Exception:
                pass
        return {
            "id":           r["id"],
            "live_host_id": r["live_host_id"],
            "session_id":   r["session_id"],
            "url":          r["url"],
            "event_type":   r["event_type"],
            "status_code":  r["status_code"],
            "title":        r["title"],
            "webserver":    r["webserver"],
            "changes":      changes,
            "recorded_at":  r["recorded_at"],
        }

    return [_hrow(r) for r in rows]


@router.get("/targets/{target_id}/hosts/{host_id}/screenshot")
async def get_screenshot(
    target_id: str,
    host_id: str,
    db: Database = Depends(get_db),
):
    """Serve the gowitness screenshot for a live host, if available."""
    await _require_target(target_id, db)

    row = await db.fetchone(
        "SELECT screenshot_path FROM live_hosts WHERE id = ? AND target_id = ?",
        (host_id, target_id),
    )
    if not row or not row["screenshot_path"]:
        raise HTTPException(status_code=404, detail="No screenshot available")

    screenshot_path = row["screenshot_path"]
    # Safety check: resolved path must stay inside /data/screenshots/
    from pathlib import Path as _Path
    base = _Path("/data/screenshots")
    full_path = (base / screenshot_path).resolve()
    if not full_path.is_relative_to(base):
        raise HTTPException(status_code=400, detail="Invalid screenshot path")
    full_path = str(full_path)

    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Screenshot file not found on disk")

    return FileResponse(full_path, media_type="image/jpeg")


_TAKEOVER_SORT = {"severity", "subdomain", "matched_at"}
_SEVERITY_CASE = """
    CASE severity
        WHEN 'critical' THEN 0
        WHEN 'high'     THEN 1
        WHEN 'medium'   THEN 2
        WHEN 'low'      THEN 3
        ELSE 4
    END
"""


@router.get("/targets/{target_id}/takeovers")
async def list_takeovers(
    target_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    verified: Optional[int] = Query(None),
    db: Database = Depends(get_db),
):
    """List nuclei takeover candidates for a target."""
    await _require_target(target_id, db)

    where = "WHERE target_id = ?"
    params: list = [target_id]
    if q:
        where += " AND subdomain LIKE ?"
        params.append(f"%{q}%")
    if verified is not None:
        where += " AND verified = ?"
        params.append(verified)

    # Sort: default is severity CASE; explicit sort_by overrides
    if sort_by in _TAKEOVER_SORT:
        order_clause = f"{sort_by} {sort_dir.upper()}, id"
    else:
        order_clause = f"{_SEVERITY_CASE}, subdomain ASC, id"

    total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM nuclei_takeover_results {where}", tuple(params)
    )
    total = total_row["n"] if total_row else 0

    rows = await db.fetchall(
        f"""
        SELECT id, step_run_id, session_id, target_id,
               subdomain, url, template_id, service, severity, matched_at, verified
        FROM nuclei_takeover_results
        {where}
        ORDER BY {order_clause}
        LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )

    return _paginate(
        [
            {
                "id":          r["id"],
                "target_id":   r["target_id"],
                "session_id":  r["session_id"],
                "subdomain":   r["subdomain"],
                "url":         r["url"],
                "template_id": r["template_id"],
                "service":     r["service"],
                "severity":    r["severity"],
                "matched_at":  r["matched_at"],
                "verified":    r["verified"],
            }
            for r in rows
        ],
        total, page, per_page,
    )


from pydantic import BaseModel


class TakeoverVerifyBody(BaseModel):
    verified: int | None = None   # null→0 (reset), 1=confirmed, -1=false positive


@router.patch("/targets/{target_id}/takeovers/{takeover_id}", status_code=200)
async def update_takeover(
    target_id: str,
    takeover_id: str,
    body: TakeoverVerifyBody,
    db: Database = Depends(get_db),
):
    """Update the verified status of a takeover candidate."""
    await _require_target(target_id, db)

    row = await db.fetchone(
        "SELECT id FROM nuclei_takeover_results WHERE id = ? AND target_id = ?",
        (takeover_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Takeover candidate not found")

    new_verified = body.verified if body.verified is not None else 0
    await db.execute(
        "UPDATE nuclei_takeover_results SET verified = ? WHERE id = ? AND target_id = ?",
        (new_verified, takeover_id, target_id),
    )
    await db.commit()
    return {"id": takeover_id, "verified": new_verified}


@router.post(
    "/targets/{target_id}/sessions/{session_id}/steps/{step_id}/rerun",
    status_code=202,
)
async def rerun_step(
    target_id: str,
    session_id: str,
    step_id: str,
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)

    session = await db.fetchone(
        "SELECT id, status, target_id FROM scan_sessions WHERE id=? AND target_id=?",
        (session_id, target_id),
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    step_running = await db.fetchone(
        "SELECT id FROM step_runs WHERE session_id=? AND step_id=? AND status='running'",
        (session_id, step_id),
    )
    if step_running:
        raise HTTPException(status_code=409, detail="Step is already running")

    target = await db.fetchone(
        "SELECT domain FROM targets WHERE id=?", (target_id,)
    )
    config: dict = {}
    ctx_extras: dict = {}

    import asyncio
    from engine.pipeline.runner import _run_step

    async def _do_rerun():
        await _run_step(
            db=db,
            session_id=session_id,
            target_id=target_id,
            domain=target["domain"],
            step_id=step_id,
            config=config,
            ctx_extras=ctx_extras,
            force=True,
        )

    asyncio.create_task(_do_rerun())
    return {"session_id": session_id, "step_id": step_id, "status": "accepted"}


_PORTS_SORT = {"host", "port", "service"}
_STANDARD_PORTS = {80, 443}

_PORTS_BASE_QUERY = """
    SELECT
        nr.host,
        nr.ip,
        nr.port,
        nr.protocol,
        nr.service,
        nr.service_version,
        GROUP_CONCAT(DISTINCT lh.host) AS subdomains
    FROM naabu_results nr
    LEFT JOIN live_hosts lh
        ON lh.target_id = nr.target_id
        AND (
            lh.host = nr.host
            OR EXISTS (
                SELECT 1 FROM json_each(lh.a_records)
                WHERE json_each.value = nr.host
            )
        )
    WHERE nr.target_id = ?{extra_where}
    GROUP BY nr.host, nr.port, nr.protocol
"""


@router.get("/targets/{target_id}/ports")
async def list_ports(
    target_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    has_service: Optional[bool] = Query(None),
    db: Database = Depends(get_db),
):
    """List open ports discovered by naabu, with linked subdomains via a_records."""
    await _require_target(target_id, db)

    extra_where = ""
    params: list = [target_id]
    if q:
        extra_where += " AND (nr.host LIKE ? OR nr.service LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    if has_service is True:
        extra_where += " AND nr.service IS NOT NULL"

    sort_col = f"nr.{sort_by}" if sort_by in _PORTS_SORT else "nr.host, nr.port"
    base_q = _PORTS_BASE_QUERY.format(extra_where=extra_where)

    total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM ({base_q}) AS sub",
        tuple(params),
    )
    total = total_row["n"] if total_row else 0

    rows = await db.fetchall(
        base_q + f" ORDER BY {sort_col} {sort_dir.upper()}, nr.host, nr.port, nr.protocol LIMIT ? OFFSET ?",
        tuple(params) + (per_page, (page - 1) * per_page),
    )

    return _paginate(
        [
            {
                "host":            r["host"],
                "ip":              r["ip"],
                "port":            r["port"],
                "protocol":        r["protocol"],
                "service":         r["service"],
                "service_version": r["service_version"],
                "standard":        int(r["port"]) in _STANDARD_PORTS,
                "subdomains":      r["subdomains"].split(",") if r["subdomains"] else [],
            }
            for r in rows
        ],
        total, page, per_page,
    )


_HISTORY_SORT = {"recorded_at", "event_type", "url"}


@router.get("/targets/{target_id}/history")
async def list_diff_history(
    target_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    event_type: Optional[str] = None,
    session_id: Optional[str] = None,
    db: Database = Depends(get_db),
):
    """List live_hosts_history diff events for a target."""
    await _require_target(target_id, db)

    sort_col = sort_by if sort_by in _HISTORY_SORT else "recorded_at"
    where = "WHERE target_id = ?"
    params: list = [target_id]
    if event_type:
        where += " AND event_type = ?"
        params.append(event_type)
    if session_id:
        where += " AND session_id = ?"
        params.append(session_id)
    if q:
        where += " AND url LIKE ?"
        params.append(f"%{q}%")

    total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM live_hosts_history {where}", tuple(params)
    )
    total = total_row["n"] if total_row else 0

    rows = await db.fetchall(
        f"""
        SELECT id, live_host_id, target_id, session_id, url, event_type,
               status_code, title, webserver, changes, recorded_at
        FROM live_hosts_history
        {where}
        ORDER BY {sort_col} {sort_dir.upper()}
        LIMIT ? OFFSET ?
        """,
        tuple(params) + (per_page, (page - 1) * per_page),
    )

    def _row(r) -> dict:
        changes = None
        if r["changes"]:
            try:
                changes = json.loads(r["changes"])
            except Exception:
                pass
        return {
            "id":           r["id"],
            "live_host_id": r["live_host_id"],
            "target_id":    r["target_id"],
            "session_id":   r["session_id"],
            "url":          r["url"],
            "event_type":   r["event_type"],
            "status_code":  r["status_code"],
            "title":        r["title"],
            "webserver":    r["webserver"],
            "changes":      changes,
            "recorded_at":  r["recorded_at"],
        }

    return _paginate([_row(r) for r in rows], total, page, per_page)


@router.get("/targets/{target_id}/cloud")
async def get_cloud_results(
    target_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    q: Optional[str] = Query(None),
    db: Database = Depends(get_db),
):
    """Return cloud_enum and s3scanner results for a target, paginated."""
    await _require_target(target_id, db)

    # --- Cloud assets ---
    cloud_where = "WHERE target_id = ?"
    cloud_params: list = [target_id]
    if q:
        cloud_where += " AND (url LIKE ? OR asset_type LIKE ?)"
        cloud_params.extend([f"%{q}%", f"%{q}%"])

    cloud_total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM (SELECT id FROM cloud_enum_results {cloud_where} GROUP BY url)",
        tuple(cloud_params),
    )
    cloud_total = cloud_total_row["n"] if cloud_total_row else 0

    asset_rows = await db.fetchall(
        f"""
        SELECT id, url, asset_type, keyword, found_at
        FROM cloud_enum_results
        {cloud_where}
        GROUP BY url
        ORDER BY asset_type, url
        LIMIT ? OFFSET ?
        """,
        tuple(cloud_params) + (per_page, (page - 1) * per_page),
    )

    # --- S3 buckets ---
    s3_where = "WHERE target_id = ?"
    s3_params: list = [target_id]
    if q:
        s3_where += " AND bucket_name LIKE ?"
        s3_params.append(f"%{q}%")

    s3_total_row = await db.fetchone(
        f"SELECT COUNT(*) AS n FROM (SELECT id FROM s3scanner_results {s3_where} GROUP BY bucket_name)",
        tuple(s3_params),
    )
    s3_total = s3_total_row["n"] if s3_total_row else 0

    bucket_rows = await db.fetchall(
        f"""
        SELECT id, bucket_name, region, bucket_exists, public_read, public_write, url, found_at
        FROM s3scanner_results
        {s3_where}
        GROUP BY bucket_name
        ORDER BY public_read DESC, public_write DESC, bucket_name
        LIMIT ? OFFSET ?
        """,
        tuple(s3_params) + (per_page, (page - 1) * per_page),
    )

    return {
        "cloud_assets": _paginate(
            [
                {
                    "id":         r["id"],
                    "url":        r["url"],
                    "asset_type": r["asset_type"] or "generic",
                    "keyword":    r["keyword"],
                    "found_at":   r["found_at"],
                }
                for r in asset_rows
            ],
            cloud_total, page, per_page,
        ),
        "s3_buckets": _paginate(
            [
                {
                    "id":            r["id"],
                    "bucket_name":   r["bucket_name"],
                    "region":        r["region"],
                    "bucket_exists": bool(r["bucket_exists"]),
                    "public_read":   bool(r["public_read"]),
                    "public_write":  bool(r["public_write"]),
                    "url":           r["url"],
                    "found_at":      r["found_at"],
                }
                for r in bucket_rows
            ],
            s3_total, page, per_page,
        ),
    }


# ── Scan comparison ────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/diff/compare")
async def compare_sessions(
    target_id: str,
    session_a: str = Query(...),
    session_b: str = Query(...),
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)

    # Verify both sessions belong to this target
    for sid in (session_a, session_b):
        row = await db.fetchone(
            "SELECT id FROM scan_sessions WHERE id=? AND target_id=?",
            (sid, target_id),
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Session {sid} not found")

    async def _session_info(sid: str) -> dict:
        sess = await db.fetchone(
            "SELECT id, started_at, finished_at, stats FROM scan_sessions WHERE id=?",
            (sid,),
        )
        stats = None
        if sess["stats"]:
            try:
                stats = json.loads(sess["stats"])
            except Exception:
                pass

        # Event counts from live_hosts_history
        count_rows = await db.fetchall(
            """
            SELECT event_type, COUNT(*) AS cnt
            FROM live_hosts_history
            WHERE target_id = ? AND session_id = ?
            GROUP BY event_type
            """,
            (target_id, sid),
        )
        counts = {r["event_type"]: r["cnt"] for r in count_rows}

        # Subdomain total at time of session (from stats JSON)
        new_subdomains = 0
        subdomain_total = 0
        if stats:
            new_subdomains = stats.get("subdomains_found", stats.get("new_subdomains", 0)) or 0
            subdomain_total = stats.get("subdomains_total", stats.get("subdomains", 0)) or 0

        return {
            "id": sess["id"],
            "started_at": sess["started_at"],
            "finished_at": sess["finished_at"],
            "stats": stats,
            "counts": counts,
            "new_subdomains": new_subdomains,
            "subdomain_total": subdomain_total,
        }

    info_a, info_b = await _session_info(session_a), await _session_info(session_b)

    # Rich diff: hosts discovered/gone/changed in session B
    LIMIT = 50

    discovered_rows = await db.fetchall(
        """
        SELECT lhh.url, lhh.status_code, lhh.title
        FROM live_hosts_history lhh
        WHERE lhh.target_id = ? AND lhh.session_id = ? AND lhh.event_type = 'discovered'
        ORDER BY lhh.recorded_at ASC
        LIMIT ?
        """,
        (target_id, session_b, LIMIT),
    )

    gone_rows = await db.fetchall(
        """
        SELECT lhh.url
        FROM live_hosts_history lhh
        WHERE lhh.target_id = ? AND lhh.session_id = ? AND lhh.event_type = 'gone'
        ORDER BY lhh.recorded_at ASC
        LIMIT ?
        """,
        (target_id, session_b, LIMIT),
    )

    changed_rows = await db.fetchall(
        """
        SELECT lhh.url, lhh.changes
        FROM live_hosts_history lhh
        WHERE lhh.target_id = ? AND lhh.session_id = ? AND lhh.event_type = 'changed'
        ORDER BY lhh.recorded_at ASC
        LIMIT ?
        """,
        (target_id, session_b, LIMIT),
    )

    def _parse_changes(raw: str | None) -> dict:
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {}

    return {
        "session_a": info_a,
        "session_b": info_b,
        "diff": {
            "hosts_discovered_in_b": [
                {"url": r["url"], "status_code": r["status_code"], "title": r["title"]}
                for r in discovered_rows
            ],
            "hosts_gone_in_b": [
                {"url": r["url"]}
                for r in gone_rows
            ],
            "hosts_changed_in_b": [
                {"url": r["url"], "changes": _parse_changes(r["changes"])}
                for r in changed_rows
            ],
        },
    }
