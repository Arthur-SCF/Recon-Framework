"""
Export endpoints.

GET  /targets/{target_id}/export/subdomains?format=csv|json
GET  /targets/{target_id}/export/hosts?format=csv|json
GET  /targets/{target_id}/export/diff?format=csv|json&session={session_id}
GET  /targets/{target_id}/export/ports?format=csv|json
GET  /targets/{target_id}/export/report?session={session_id}
GET  /targets/{target_id}/export/takeovers?format=csv|json
GET  /targets/{target_id}/export/cloud?format=csv|json
GET  /targets/{target_id}/export/screenshots?format=csv|json
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from engine.db import Database, get_db

log = logging.getLogger("engine.api.export")
router = APIRouter(tags=["export"])


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _require_target(target_id: str, db: Database) -> dict:
    row = await db.fetchone(
        "SELECT id, domain FROM targets WHERE id = ?", (target_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")
    return {"id": row["id"], "domain": row["domain"]}


def _csv_safe(v: Any) -> str:
    """Prevent CSV formula injection: prefix cells starting with = + - @ with a single quote."""
    if v is None:
        return ""
    s = str(v)
    if s and s[0] in ("=", "+", "-", "@"):
        return f"'{s}"
    return s


def _csv_response(rows: list[list], headers: list[str] | None, filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    if headers is not None:
        writer.writerow(headers)
    for row in rows:
        writer.writerow([_csv_safe(cell) for cell in row])
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _parse_list(raw) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


# ── Subdomains ─────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/subdomains")
async def export_subdomains(
    target_id: str,
    format: str = "csv",
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    rows = await db.fetchall(
        "SELECT subdomain, sources, first_seen, last_seen, is_live FROM subdomains "
        "WHERE target_id = ? ORDER BY subdomain",
        (target_id,),
    )

    if format == "json":
        data = [
            {
                "subdomain":  r["subdomain"],
                "sources":    _parse_list(r["sources"]),
                "first_seen": r["first_seen"],
                "last_seen":  r["last_seen"],
                "is_live":    bool(r["is_live"]),
            }
            for r in rows
        ]
        return JSONResponse(data)

    csv_rows = [
        [
            r["subdomain"],
            "|".join(_parse_list(r["sources"])),
            r["first_seen"],
            r["last_seen"],
            "true" if r["is_live"] else "false",
        ]
        for r in rows
    ]
    return _csv_response(
        csv_rows,
        ["subdomain", "sources", "first_seen", "last_seen", "is_live"],
        f"subdomains-{domain}.csv",
    )


# ── Live hosts ─────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/hosts")
async def export_hosts(
    target_id: str,
    format: str = "csv",
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    rows = await db.fetchall(
        """
        SELECT url, status_code, title, webserver, tech, port, scheme,
               response_time, cname, cdn_name, has_csp, has_xfo, has_hsts,
               waf, first_seen
        FROM live_hosts
        WHERE target_id = ?
        ORDER BY first_seen DESC
        """,
        (target_id,),
    )

    if format == "json":
        data = [
            {
                "url":          r["url"],
                "status_code":  r["status_code"],
                "title":        r["title"],
                "webserver":    r["webserver"],
                "tech":         _parse_list(r["tech"]),
                "port":         r["port"],
                "scheme":       r["scheme"],
                "response_time": r["response_time"],
                "cname":        r["cname"],
                "cdn_name":     r["cdn_name"],
                "has_csp":      bool(r["has_csp"]) if r["has_csp"] is not None else None,
                "has_xfo":      bool(r["has_xfo"]) if r["has_xfo"] is not None else None,
                "has_hsts":     bool(r["has_hsts"]) if r["has_hsts"] is not None else None,
                "waf":          r["waf"],
                "first_seen":   r["first_seen"],
            }
            for r in rows
        ]
        return JSONResponse(data)

    csv_rows = [
        [
            r["url"],
            r["status_code"],
            r["title"],
            r["webserver"],
            "|".join(_parse_list(r["tech"])),
            r["port"],
            r["scheme"],
            r["response_time"],
            r["cname"],
            r["cdn_name"],
            "true" if r["has_csp"] else "false",
            "true" if r["has_xfo"] else "false",
            "true" if r["has_hsts"] else "false",
            r["waf"] or "",
            r["first_seen"],
        ]
        for r in rows
    ]
    return _csv_response(
        csv_rows,
        ["url", "status_code", "title", "webserver", "tech", "port", "scheme",
         "response_time", "cname", "cdn_name", "has_csp", "has_xfo", "has_hsts",
         "waf", "first_seen"],
        f"hosts-{domain}.csv",
    )


# ── Diff / history ─────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/diff")
async def export_diff(
    target_id: str,
    format: str = "csv",
    session: str | None = None,
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    if session:
        rows = await db.fetchall(
            "SELECT url, event_type, status_code, title, webserver, changes, recorded_at "
            "FROM live_hosts_history WHERE target_id = ? AND session_id = ? "
            "ORDER BY recorded_at DESC",
            (target_id, session),
        )
    else:
        rows = await db.fetchall(
            "SELECT url, event_type, status_code, title, webserver, changes, recorded_at "
            "FROM live_hosts_history WHERE target_id = ? "
            "ORDER BY recorded_at DESC LIMIT 5000",
            (target_id,),
        )

    truncated = len(rows) >= 5000

    if format == "json":
        data = []
        for r in rows:
            changes = None
            if r["changes"]:
                try:
                    changes = json.loads(r["changes"])
                except Exception:
                    changes = r["changes"]
            data.append({
                "url":         r["url"],
                "event_type":  r["event_type"],
                "status_code": r["status_code"],
                "title":       r["title"],
                "webserver":   r["webserver"],
                "changes":     changes,
                "recorded_at": r["recorded_at"],
            })
        return JSONResponse({"data": data, "truncated": truncated})

    csv_rows = [
        [r["url"], r["event_type"], r["status_code"],
         r["title"], r["webserver"], r["recorded_at"]]
        for r in rows
    ]
    if truncated:
        csv_rows.append(["# Note: output truncated at 5000 rows"])
    return _csv_response(
        csv_rows,
        ["url", "event_type", "status_code", "title", "webserver", "recorded_at"],
        f"diff-{domain}.csv",
    )


# ── Ports ──────────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/ports")
async def export_ports(
    target_id: str,
    format: str = "csv",
    verified: bool = False,
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    if verified:
        rows = await db.fetchall(
            """
            SELECT host, ip, port, protocol, service, service_version
            FROM naabu_results
            WHERE target_id = ? AND service IS NOT NULL
            ORDER BY host, port
            """,
            (target_id,),
        )
        suffix = "ports-verified"
        if format == "json":
            return JSONResponse([
                {
                    "host": r["host"], "ip": r["ip"], "port": r["port"],
                    "protocol": r["protocol"], "service": r["service"],
                    "service_version": r["service_version"],
                }
                for r in rows
            ])
        return _csv_response(
            [[r["host"], r["ip"], r["port"], r["protocol"], r["service"], r["service_version"]] for r in rows],
            ["host", "ip", "port", "protocol", "service", "service_version"],
            f"{suffix}-{domain}.csv",
        )
    else:
        rows = await db.fetchall(
            """
            SELECT host, ip, port, protocol, service, service_version
            FROM naabu_results
            WHERE target_id = ?
            ORDER BY host, port
            """,
            (target_id,),
        )
        if format == "json":
            return JSONResponse([
                {
                    "host": r["host"], "ip": r["ip"], "port": r["port"],
                    "protocol": r["protocol"], "service": r["service"],
                    "service_version": r["service_version"],
                }
                for r in rows
            ])
        return _csv_response(
            [[r["host"], r["ip"], r["port"], r["protocol"], r["service"], r["service_version"]] for r in rows],
            ["host", "ip", "port", "protocol", "service", "service_version"],
            f"ports-{domain}.csv",
        )


# ── Markdown report ────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/report")
async def export_report(
    target_id: str,
    session: str | None = None,
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    # Gather data
    target_row = await db.fetchone(
        "SELECT domain, scan_count, status, last_scan_at FROM targets WHERE id = ?",
        (target_id,),
    )

    _r = await db.fetchone("SELECT COUNT(*) AS c FROM subdomains WHERE target_id = ?", (target_id,))
    sub_count = _r["c"] if _r else 0

    _r = await db.fetchone("SELECT COUNT(*) AS c FROM live_hosts WHERE target_id = ?", (target_id,))
    host_count = _r["c"] if _r else 0

    _r = await db.fetchone("SELECT COUNT(*) AS c FROM naabu_results WHERE target_id = ?", (target_id,))
    port_count = _r["c"] if _r else 0

    _r = await db.fetchone("SELECT COUNT(*) AS c FROM nuclei_takeover_results WHERE target_id = ?", (target_id,))
    takeover_count = _r["c"] if _r else 0

    # Discoveries and changes for the specific session (or last 500 history rows)
    if session:
        history_rows = await db.fetchall(
            "SELECT url, event_type, status_code, title, webserver, recorded_at "
            "FROM live_hosts_history WHERE target_id = ? AND session_id = ? "
            "ORDER BY recorded_at DESC",
            (target_id, session),
        )
        new_hosts = await db.fetchall(
            "SELECT url, status_code, title, tech, webserver FROM live_hosts "
            "WHERE target_id = ? AND first_seen >= "
            "(SELECT started_at FROM scan_sessions WHERE id = ?) "
            "ORDER BY first_seen DESC LIMIT 200",
            (target_id, session),
        )
        new_subs = await db.fetchall(
            "SELECT subdomain FROM subdomains WHERE target_id = ? AND first_seen >= "
            "(SELECT started_at FROM scan_sessions WHERE id = ?) "
            "ORDER BY subdomain LIMIT 200",
            (target_id, session),
        )
    else:
        history_rows = await db.fetchall(
            "SELECT url, event_type, status_code, title, webserver, recorded_at "
            "FROM live_hosts_history WHERE target_id = ? "
            "ORDER BY recorded_at DESC LIMIT 500",
            (target_id,),
        )
        new_hosts = []
        new_subs = []

    all_hosts = await db.fetchall(
        "SELECT url, status_code, title, webserver, tech, waf FROM live_hosts "
        "WHERE target_id = ? ORDER BY status_code, url LIMIT 500",
        (target_id,),
    )

    takeovers = await db.fetchall(
        "SELECT subdomain, service, severity, matched_at, verified "
        "FROM nuclei_takeover_results WHERE target_id = ? "
        "ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 "
        "WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END",
        (target_id,),
    )

    # Build markdown
    now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    session_label = session[:8] if session else "all sessions"

    lines: list[str] = [
        f"# Recon Report: {domain}",
        f"*Generated: {now} · Scope: {session_label}*",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Domain | `{domain}` |",
        f"| Total subdomains | {sub_count} |",
        f"| Live hosts | {host_count} |",
        f"| Open ports | {port_count} |",
        f"| Takeover candidates | {takeover_count} |",
        f"| Scans completed | {target_row['scan_count'] if target_row else 0} |",
        "",
    ]

    # New discoveries (session-specific)
    if new_subs or new_hosts:
        lines += ["## New Discoveries", ""]
        if new_subs:
            lines += [f"### Subdomains ({len(new_subs)})", ""]
            for r in new_subs:
                lines.append(f"- `{r['subdomain']}`")
            lines.append("")

        if new_hosts:
            lines += [
                f"### Live Hosts ({len(new_hosts)})",
                "",
                "| URL | Status | Title | Tech |",
                "|-----|--------|-------|------|",
            ]
            for r in new_hosts:
                tech = "|".join(_parse_list(r["tech"]))
                title = (r["title"] or "").replace("|", "\\|")
                lines.append(f"| `{r['url']}` | {r['status_code']} | {title} | {tech} |")
            lines.append("")

    # Change log
    if history_rows:
        lines += [
            "## Change Log",
            "",
            "| URL | Event | Status | Recorded |",
            "|-----|-------|--------|---------|",
        ]
        for r in history_rows[:200]:
            lines.append(
                f"| `{r['url']}` | {r['event_type']} | {r['status_code'] or '—'} | {r['recorded_at']} |"
            )
        if len(history_rows) > 200:
            lines.append(f"| *… {len(history_rows) - 200} more rows* | | | |")
        lines.append("")

    # Host inventory
    if all_hosts:
        lines += [
            "## Host Inventory",
            "",
            "| URL | Status | Title | Webserver | WAF | Tech |",
            "|-----|--------|-------|-----------|-----|------|",
        ]
        for r in all_hosts:
            tech = "|".join(_parse_list(r["tech"]))
            title = (r["title"] or "").replace("|", "\\|")
            waf = r["waf"] or "—"
            lines.append(
                f"| `{r['url']}` | {r['status_code']} | {title} | "
                f"{r['webserver'] or '—'} | {waf} | {tech} |"
            )
        if host_count > 500:
            lines.append(f"| *… {host_count - 500} more rows — use CSV export* | | | | | |")
        lines.append("")

    # Takeover candidates
    if takeovers:
        lines += [
            "## Takeover Candidates",
            "",
            "| Subdomain | Service | Severity | Matched At | Status |",
            "|-----------|---------|----------|------------|--------|",
        ]
        status_map = {1: "Confirmed", -1: "False Positive", 0: "Unverified"}
        for t in takeovers:
            status_str = status_map.get(t["verified"], "Unverified")
            lines.append(
                f"| `{t['subdomain']}` | {t['service'] or '—'} | "
                f"{t['severity']} | {t['matched_at'] or '—'} | {status_str} |"
            )
        lines.append("")

    md = "\n".join(lines)
    safe_domain = domain.replace("/", "_")
    return PlainTextResponse(
        md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="report-{safe_domain}.md"'},
    )


# ── Takeovers ──────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/takeovers")
async def export_takeovers(
    target_id: str,
    format: str = "csv",
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    rows = await db.fetchall(
        """SELECT severity, subdomain, service, template_id, matched_at, url,
                  CASE verified WHEN 1 THEN 'Confirmed' WHEN -1 THEN 'False Positive' ELSE 'Unverified' END as verified_status
           FROM nuclei_takeover_results
           WHERE target_id = ?
           ORDER BY CASE severity
               WHEN 'critical' THEN 0 WHEN 'high' THEN 1
               WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, subdomain""",
        (target_id,),
    )

    headers = ["severity", "subdomain", "service", "template_id", "matched_at", "url", "verified_status"]

    if format == "json":
        return JSONResponse([dict(r) for r in rows])

    csv_rows = [[_csv_safe(r[h]) for h in headers] for r in rows]
    return _csv_response(csv_rows, headers, f"takeovers-{domain}.csv")


# ── Cloud assets ───────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/cloud")
async def export_cloud(
    target_id: str,
    format: str = "csv",
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    assets = await db.fetchall(
        "SELECT provider, url, keyword, asset_type FROM cloud_enum_results WHERE target_id = ? ORDER BY provider, url",
        (target_id,),
    )
    buckets = await db.fetchall(
        "SELECT bucket_name, region, bucket_exists, public_read, public_write, url FROM s3scanner_results WHERE target_id = ? ORDER BY bucket_name",
        (target_id,),
    )

    if format == "json":
        return JSONResponse({
            "cloud_assets": [dict(r) for r in assets],
            "s3_buckets": [dict(r) for r in buckets],
        })

    # CSV: two sections separated by a blank row — headers embedded in rows
    asset_headers = ["provider", "url", "keyword", "asset_type"]
    bucket_headers = ["bucket_name", "region", "bucket_exists", "public_read", "public_write", "url"]

    csv_rows = []
    csv_rows.append(["# Cloud Assets"])
    csv_rows.append(asset_headers)
    for r in assets:
        csv_rows.append([_csv_safe(r[h]) for h in asset_headers])
    csv_rows.append([])
    csv_rows.append(["# S3 Buckets"])
    csv_rows.append(bucket_headers)
    for r in buckets:
        csv_rows.append([_csv_safe(r[h]) for h in bucket_headers])

    return _csv_response(csv_rows, None, f"cloud-{domain}.csv")


# ── Screenshots ────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/export/screenshots")
async def export_screenshots(
    target_id: str,
    format: str = "csv",
    db: Database = Depends(get_db),
):
    target = await _require_target(target_id, db)
    domain = target["domain"]

    rows = await db.fetchall(
        """SELECT url, status_code, title, webserver, tech, screenshot_path
           FROM live_hosts
           WHERE target_id = ? AND screenshot_path IS NOT NULL
           ORDER BY url""",
        (target_id,),
    )

    headers = ["url", "status_code", "title", "webserver", "tech", "screenshot_path"]

    if format == "json":
        data = []
        for r in rows:
            d = dict(r)
            d["tech"] = _parse_list(d.get("tech"))
            data.append(d)
        return JSONResponse(data)

    csv_rows = []
    for r in rows:
        row = []
        for h in headers:
            val = r[h]
            if h == "tech":
                val = "|".join(_parse_list(val))
            row.append(_csv_safe(val))
        csv_rows.append(row)
    return _csv_response(csv_rows, headers, f"screenshots-{domain}.csv")
