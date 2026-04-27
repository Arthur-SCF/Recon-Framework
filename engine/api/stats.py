"""
Aggregated stats endpoint.

GET  /api/v1/stats/overview   — cross-target summary for the dashboard
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends

from engine.db import Database, get_db

log = logging.getLogger("engine.api.stats")
router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview")
async def get_stats_overview(db: Database = Depends(get_db)) -> dict:
    try:
        # ── Totals ────────────────────────────────────────────────────────────────
        total_targets = (await db.fetchone("SELECT COUNT(*) AS c FROM targets"))["c"]
        running_scans = (await db.fetchone(
            "SELECT COUNT(*) AS c FROM targets WHERE status = 'running'"
        ))["c"]
        total_subdomains = (await db.fetchone("SELECT COUNT(*) AS c FROM subdomains"))["c"]
        total_hosts = (await db.fetchone("SELECT COUNT(*) AS c FROM live_hosts"))["c"]

        # ── Last 7 days ───────────────────────────────────────────────────────────
        new_subdomains_7d = (await db.fetchone(
            "SELECT COUNT(*) AS c FROM subdomains WHERE first_seen >= datetime('now','-7 days')"
        ))["c"]
        new_hosts_7d = (await db.fetchone(
            "SELECT COUNT(*) AS c FROM live_hosts WHERE first_seen >= datetime('now','-7 days')"
        ))["c"]
        hosts_gone_7d = (await db.fetchone(
            """SELECT COUNT(*) AS c FROM live_hosts_history
               WHERE event_type = 'gone'
               AND recorded_at >= datetime('now','-7 days')"""
        ))["c"]
        new_takeovers_7d = (await db.fetchone(
            """SELECT COUNT(*) AS c FROM nuclei_takeover_results
               WHERE matched_at >= datetime('now','-7 days')"""
        ))["c"]
        total_takeovers = (await db.fetchone(
            "SELECT COUNT(*) AS c FROM nuclei_takeover_results"
        ))["c"]

        # ── Attack surface growth (last 20 completed sessions) ────────────────────
        sessions = await db.fetchall(
            """SELECT id, target_id, started_at, stats
               FROM scan_sessions
               WHERE status = 'completed'
               ORDER BY started_at DESC LIMIT 20"""
        )
        growth_series = []
        for row in sessions:
            if not row["stats"]:
                continue
            try:
                stats_json = json.loads(row["stats"])
            except (ValueError, TypeError):
                continue
            count = stats_json.get("subdomains_found") or stats_json.get("subdomains")
            if count is None:
                continue
            growth_series.append({
                "session_id": row["id"],
                "target_id": row["target_id"],
                "started_at": row["started_at"],
                "subdomain_count": int(count),
            })
        # Return chronological order for charting
        growth_series.reverse()

        # ── Technology distribution (top 15) ──────────────────────────────────────
        tech_rows = await db.fetchall(
            """SELECT value AS tech, COUNT(*) AS count
               FROM live_hosts, json_each(live_hosts.tech)
               WHERE live_hosts.tech IS NOT NULL
                 AND live_hosts.tech != '[]'
               GROUP BY value
               ORDER BY count DESC LIMIT 15"""
        )
        top_tech = [{"tech": r["tech"], "count": r["count"]} for r in tech_rows]

        # ── Status code distribution (top 20) ─────────────────────────────────────
        status_rows = await db.fetchall(
            """SELECT status_code, COUNT(*) AS count
               FROM live_hosts
               WHERE status_code IS NOT NULL
               GROUP BY status_code
               ORDER BY count DESC LIMIT 20"""
        )
        status_dist = [{"status_code": r["status_code"], "count": r["count"]} for r in status_rows]

        return {
            "totals": {
                "targets": total_targets,
                "running_scans": running_scans,
                "subdomains": total_subdomains,
                "hosts": total_hosts,
                "takeovers": total_takeovers,
            },
            "recent_7d": {
                "new_subdomains": new_subdomains_7d,
                "new_hosts": new_hosts_7d,
                "hosts_gone": hosts_gone_7d,
                "new_takeovers": new_takeovers_7d,
            },
            "growth_series": growth_series,
            "top_tech": top_tech,
            "status_dist": status_dist,
        }
    except Exception as exc:
        log.error("Stats overview query failed: %s", exc, exc_info=True)
        return {
            "totals": {
                "targets": 0,
                "running_scans": 0,
                "subdomains": 0,
                "hosts": 0,
                "takeovers": 0,
            },
            "recent_7d": {
                "new_subdomains": 0,
                "new_hosts": 0,
                "hosts_gone": 0,
                "new_takeovers": 0,
            },
            "growth_series": [],
            "top_tech": [],
            "status_dist": [],
            "error": "Stats temporarily unavailable",
        }
