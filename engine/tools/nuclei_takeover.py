"""
Real NucleiTakeoverTool — subdomain takeover detection via Nuclei.

Scans all subdomains + live host URLs with nuclei's takeover template pack.
Persists findings to nuclei_takeover_results, fires notifications and WS events
for each new finding.

step_id: nuclei_takeover
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.nuclei_takeover")

# Map template-id keyword fragments → service display name
_TEMPLATE_SERVICE_MAP: dict[str, str] = {
    "aws":              "AWS S3",
    "s3":               "AWS S3",
    "azure":            "Azure",
    "github":           "GitHub Pages",
    "heroku":           "Heroku",
    "fastly":           "Fastly",
    "shopify":          "Shopify",
    "pantheon":         "Pantheon",
    "wordpress":        "WordPress.com",
    "zendesk":          "Zendesk",
    "tumblr":           "Tumblr",
    "bitbucket":        "Bitbucket",
    "ghost":            "Ghost.io",
    "unbounce":         "Unbounce",
    "helpjuice":        "Helpjuice",
    "helpscout":        "Help Scout",
    "desk":             "Desk.com",
    "cargo":            "Cargo Collective",
    "jazzhr":           "JazzHR",
    "pingdom":          "Pingdom",
    "teamwork":         "Teamwork",
    "hatenablog":       "Hatena Blog",
    "surveygizmo":      "SurveyGizmo",
    "thinkific":        "Thinkific",
    "wishpond":         "Wishpond",
    "sendgrid":         "SendGrid",
    "strikingly":       "Strikingly",
    "tave":             "Tave",
    "wix":              "Wix",
    "squarespace":      "Squarespace",
    "smugmug":          "SmugMug",
}


def _infer_service(template_id: str) -> str:
    """Map a nuclei template-id to a human-readable service name."""
    tid = (template_id or "").lower()
    for key, name in _TEMPLATE_SERVICE_MAP.items():
        if key in tid:
            return name
    return template_id or "Unknown"


class NucleiTakeoverTool(BaseTool):
    label           = "Nuclei Takeover"
    binary_name     = "nuclei"
    parallelisable  = False
    default_timeout = 600

    def get_version_command(self) -> list[str]:
        return ["nuclei", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?([\d.]+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        findings: list[dict] = []
        seen: set[tuple] = set()

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            template_id = obj.get("template-id") or obj.get("templateID", "")
            severity    = (obj.get("info", {}) or {}).get("severity", "info").lower()
            matched_at  = obj.get("matched-at") or obj.get("matched", "")
            host        = obj.get("host", "")
            subdomain   = host or matched_at

            key = (template_id, subdomain)
            if key in seen:
                continue
            seen.add(key)

            findings.append({
                "template_id": template_id,
                "severity":    severity,
                "subdomain":   subdomain,
                "url":         matched_at,
                "service":     _infer_service(template_id),
            })

        return {"findings": findings, "count": len(findings)}

    async def run(self, ctx: StepContext) -> StepResult:
        # Collect all subdomains + live host URLs as scan targets
        sub_rows = await ctx.db.fetchall(
            "SELECT subdomain FROM subdomains WHERE target_id = ? AND in_scope = 1",
            (ctx.target_id,),
        )
        host_rows = await ctx.db.fetchall(
            "SELECT url FROM live_hosts WHERE target_id = ? AND in_scope = 1",
            (ctx.target_id,),
        )

        targets: list[str] = []
        seen: set[str] = set()
        for r in sub_rows:
            s = r["subdomain"]
            if s and s not in seen:
                seen.add(s)
                targets.append(s)
        for r in host_rows:
            u = r["url"]
            if u and u not in seen:
                seen.add(u)
                targets.append(u)

        if not targets:
            log.info("%s nuclei_takeover: no targets — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        tmp_fd, tmp_list = tempfile.mkstemp(
            prefix="nuclei_takeover_", suffix=".txt", dir="/tmp"
        )
        try:
            with os.fdopen(tmp_fd, "w") as f:
                f.write("\n".join(targets))

            rate_limit  = ctx.config.get("nuclei_rate_limit", 100)
            bulk_size   = ctx.config.get("nuclei_bulk_size", 50)
            concurrency = ctx.config.get("nuclei_concurrency", 25)
            run_timeout = ctx.config.get("timeout", self.default_timeout)

            cmd = [
                "nuclei",
                "-list", tmp_list,
                "-t", "/data/nuclei-templates/http/takeovers/",
                "-duc",                            # disable update check (templates pre-installed)
                "-silent",
                "-jsonl",
                "-rate-limit", str(rate_limit),
                "-bulk-size", str(bulk_size),
                "-concurrency", str(concurrency),
                "-timeout", "10",
            ]

            start = time.monotonic()
            stdout, stderr, retcode = await run_subprocess(cmd, timeout=run_timeout)
            elapsed = time.monotonic() - start

            if retcode == -9:
                status = OutputStatus.TIMEOUT
            elif retcode not in (0, 1):
                status = OutputStatus.ERROR
            else:
                status = OutputStatus.SUCCESS

            data: dict = {"findings": [], "count": 0}
            if stdout and status != OutputStatus.TIMEOUT:
                data = self.parse_output(stdout, ctx)

            await save_raw_output(
                ctx, cmd=cmd, stdout=stdout, stderr=stderr,
                status=status, elapsed=elapsed, data=data,
            )

            result = StepResult(
                status=status,
                result_count=data.get("count", 0),
                data=data,
                stdout=stdout,
                stderr=stderr,
                command=cmd,
                execution_time=elapsed,
            )

            if data.get("findings"):
                try:
                    await self._persist(ctx, result)
                except Exception as exc:
                    log.error(
                        "%s nuclei_takeover _persist failed: %r",
                        ctx.session_id[:8], exc,
                    )
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result

        finally:
            try:
                os.unlink(tmp_list)
            except OSError:
                pass

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        findings = result.data.get("findings", [])
        if not findings:
            return

        from datetime import datetime, timezone
        from engine.websocket import ws_manager

        now = datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

        takeover_rows: list[tuple] = []
        notif_rows: list[tuple] = []

        for f in findings:
            row_id = str(uuid.uuid4())
            takeover_rows.append((
                row_id,
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                f["subdomain"],
                f["url"],
                f["template_id"],
                f["service"],
                f["severity"],
                f["url"],   # matched_at = url
            ))

        await ctx.db.executemany(
            """
            INSERT INTO nuclei_takeover_results
                (id, step_run_id, session_id, target_id,
                 subdomain, url, template_id, service, severity, matched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain, template_id) DO NOTHING
            """,
            takeover_rows,
        )
        await ctx.db.commit()

        # Dispatch notifications (DB + WS + Telegram) for each finding via notify()
        from engine.notifier import notify as _notify
        for f in findings:
            try:
                await _notify(
                    notification_type="takeover_candidate",
                    title=f"Takeover candidate: {f['subdomain']}",
                    message=f"{f['service']} — {f['severity'].upper()} — {f['url']}",
                    data={
                        "subdomain":   f["subdomain"],
                        "service":     f["service"],
                        "template_id": f["template_id"],
                        "severity":    f["severity"],
                        "url":         f["url"],
                    },
                    target_id=ctx.target_id,
                    session_id=ctx.session_id,
                )
            except Exception as exc:
                log.warning(
                    "%s nuclei_takeover notify failed: %r",
                    ctx.session_id[:8], exc,
                )
            # WS event for live UI update (separate from the generic notification WS event)
            try:
                await ws_manager.broadcast(
                    "takeover_found",
                    {
                        "target_id":   ctx.target_id,
                        "session_id":  ctx.session_id,
                        "subdomain":   f["subdomain"],
                        "service":     f["service"],
                        "template_id": f["template_id"],
                        "severity":    f["severity"],
                    },
                    target_id=ctx.target_id,
                )
            except Exception as exc:
                log.warning(
                    "%s nuclei_takeover WS broadcast failed: %r",
                    ctx.session_id[:8], exc,
                )

        log.info(
            "%s nuclei_takeover: persisted %d findings for %s",
            ctx.session_id[:8], len(findings), ctx.domain,
        )
