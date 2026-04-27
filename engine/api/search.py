"""
Global search endpoint.

GET /api/v1/search?q=<query>&type=all|subdomain|host|target|port|takeover
GET /api/v1/search?q=<query>&per_category=10

Returns grouped results with has_more flags:
  { targets: [...], targets_has_more: bool, subdomains: [...], ... }

Each category capped at per_category (default 10, max 50) results.
LIKE %query% scan — no FTS5 needed for v1.
Security: q is passed only as a bind parameter, never interpolated into SQL.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from engine.db import Database, get_db

log = logging.getLogger("engine.api.search")
router = APIRouter(tags=["search"])


@router.get("/search")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    type: Optional[str] = Query("all", pattern="^(all|target|subdomain|host|port|takeover)$"),
    per_category: int = Query(10, ge=1, le=50),
    db: Database = Depends(get_db),
):
    """
    Search across targets, subdomains, live hosts, ports, and takeover candidates.
    Returns up to per_category results per category with has_more flags.
    """
    q = q.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    like = f"%{q}%"
    results: dict = {}

    want_targets    = type in ("all", "target")
    want_subdomains = type in ("all", "subdomain")
    want_hosts      = type in ("all", "host")
    want_ports      = type in ("all", "port")
    want_takeovers  = type in ("all", "takeover")

    try:
        if want_targets:
            rows = await db.fetchall(
                """
                SELECT id, domain, status, wildcard_policy
                FROM targets
                WHERE domain LIKE ?
                ORDER BY domain
                LIMIT ?
                """,
                (like, per_category + 1),
            )
            results["targets"] = [
                {
                    "id":              r["id"],
                    "domain":          r["domain"],
                    "status":          r["status"],
                    "wildcard_policy": r["wildcard_policy"],
                }
                for r in rows[:per_category]
            ]
            results["targets_has_more"] = len(rows) > per_category

        if want_subdomains:
            rows = await db.fetchall(
                """
                SELECT s.id, s.subdomain, s.is_live, s.target_id, t.domain AS target_domain
                FROM subdomains s
                JOIN targets t ON t.id = s.target_id
                WHERE s.subdomain LIKE ?
                ORDER BY s.is_live DESC, s.subdomain
                LIMIT ?
                """,
                (like, per_category + 1),
            )
            results["subdomains"] = [
                {
                    "id":            r["id"],
                    "subdomain":     r["subdomain"],
                    "is_live":       bool(r["is_live"]),
                    "target_id":     r["target_id"],
                    "target_domain": r["target_domain"],
                }
                for r in rows[:per_category]
            ]
            results["subdomains_has_more"] = len(rows) > per_category

        if want_hosts:
            rows = await db.fetchall(
                """
                SELECT h.id, h.url, h.status_code, h.title, h.scheme,
                       h.target_id, t.domain AS target_domain
                FROM live_hosts h
                JOIN targets t ON t.id = h.target_id
                WHERE h.url LIKE ? OR h.title LIKE ?
                ORDER BY h.url
                LIMIT ?
                """,
                (like, like, per_category + 1),
            )
            results["hosts"] = [
                {
                    "id":            r["id"],
                    "url":           r["url"],
                    "status_code":   r["status_code"],
                    "title":         r["title"],
                    "scheme":        r["scheme"],
                    "target_id":     r["target_id"],
                    "target_domain": r["target_domain"],
                }
                for r in rows[:per_category]
            ]
            results["hosts_has_more"] = len(rows) > per_category

        if want_ports:
            rows = await db.fetchall(
                """
                SELECT p.id, p.host, p.port, p.service, p.target_id, t.domain AS target_domain
                FROM naabu_results p
                JOIN targets t ON p.target_id = t.id
                WHERE p.host LIKE ? OR p.service LIKE ?
                LIMIT ?
                """,
                (like, like, per_category + 1),
            )
            results["ports"] = [
                {
                    "id":            r["id"],
                    "host":          r["host"],
                    "port":          r["port"],
                    "service":       r["service"],
                    "target_id":     r["target_id"],
                    "target_domain": r["target_domain"],
                }
                for r in rows[:per_category]
            ]
            results["ports_has_more"] = len(rows) > per_category

        if want_takeovers:
            rows = await db.fetchall(
                """
                SELECT tc.id, tc.subdomain, tc.service, tc.severity, tc.target_id, t.domain AS target_domain
                FROM nuclei_takeover_results tc
                JOIN targets t ON tc.target_id = t.id
                WHERE tc.subdomain LIKE ? OR tc.service LIKE ?
                LIMIT ?
                """,
                (like, like, per_category + 1),
            )
            results["takeovers"] = [
                {
                    "id":            r["id"],
                    "subdomain":     r["subdomain"],
                    "service":       r["service"],
                    "severity":      r["severity"],
                    "target_id":     r["target_id"],
                    "target_domain": r["target_domain"],
                }
                for r in rows[:per_category]
            ]
            results["takeovers_has_more"] = len(rows) > per_category

    except Exception as exc:
        log.error("Search query failed: %s", exc, exc_info=True)
        return {
            "targets": [],
            "targets_has_more": False,
            "subdomains": [],
            "subdomains_has_more": False,
            "hosts": [],
            "hosts_has_more": False,
            "ports": [],
            "ports_has_more": False,
            "takeovers": [],
            "takeovers_has_more": False,
            "error": "Search temporarily unavailable",
        }

    return results
