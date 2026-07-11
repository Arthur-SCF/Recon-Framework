"""
Real NaabuTool — fast port scanner.

Scans all live hosts for this target using naabu's top-1000 ports.
Persists results to naabu_results table.

Input:  live_hosts.host values for this target
Output: naabu_results rows (host, port, protocol, ip)

host = original hostname (preferred for subdomain tracking and downstream tools)
ip   = resolved IP address (populated from naabu's 'ip' field when available)

CDN deduplication:
  Many targets have dozens of subdomains all resolving to the same CDN IPs.
  Scanning each hostname separately produces massive false-positive counts (SYN
  scan sees CDN IP respond, but the service port isn't actually open for that
  hostname).  We group live_hosts by their first A record and only scan one
  representative hostname per unique IP.  Hosts with no A records are always
  included (DNS may have failed at httpx time).

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

log = logging.getLogger("engine.tools.naabu")


class NaabuTool(BaseTool):
    label           = "Naabu"
    binary_name     = "naabu"
    parallelisable  = False
    default_timeout = 1800   # large scans can take a while

    def get_version_command(self) -> list[str]:
        return ["naabu", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?(\d+\.\d+\.\d+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        # Placeholder — actual command built in run()
        return []

    def _build_naabu_command(self, input_file: str, ctx: StepContext) -> list[str]:
        rate    = ctx.config.get("rate", 1000)
        retries = ctx.config.get("naabu_retries", 2)
        timeout = ctx.config.get("naabu_timeout", 5)

        # top_ports is set by NaabuParams (1000 / 5000 / full)
        top_ports = str(ctx.config.get("top_ports", "1000"))
        ports_flag = ["-top-ports", top_ports]

        return [
            "naabu",
            "-list", input_file,
            *ports_flag,
            "-silent",
            "-json",
            "-rate", str(rate),
            "-retries", str(retries),
            "-timeout", str(timeout),
            "-verify",
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse naabu NDJSON output: {host, ip, port, protocol}

        Prefer the original hostname for `host` (for subdomain tracking and
        downstream service tools). Store the resolved IP separately as `ip`.
        """
        ports: list[dict] = []
        seen: set = set()

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Prefer hostname for tracking; fall back to IP if no hostname
            host     = obj.get("host") or obj.get("ip", "")
            ip       = obj.get("ip") or None
            port     = obj.get("port")
            protocol = obj.get("protocol", "tcp")

            if not host or port is None:
                continue

            key = (host, int(port))
            if key in seen:
                continue
            seen.add(key)

            ports.append({
                "host":     host,
                "ip":       ip,
                "port":     int(port),
                "protocol": protocol,
            })

        return {"ports": ports, "count": len(ports)}

    async def run(self, ctx: StepContext) -> StepResult:
        # Fetch live hosts with their A records for CDN deduplication
        rows = await ctx.db.fetchall(
            "SELECT DISTINCT host, a_records FROM live_hosts WHERE target_id = ? AND in_scope = 1",
            (ctx.target_id,),
        )
        if not rows:
            log.info("%s naabu: no live hosts — skipping", ctx.session_id[:8])
            return StepResult(
                status=OutputStatus.SKIPPED,
                result_count=0,
                data={"ports": [], "count": 0},
            )

        # Deduplicate by first A record to avoid scanning the same CDN IP
        # repeatedly under different hostnames (a major source of false positives).
        scanned_ips: set[str] = set()
        hostnames: list[str] = []
        skipped_cdn = 0
        for row in rows:
            host = row["host"]
            if not host:
                continue
            try:
                a_recs: list[str] = json.loads(row["a_records"] or "[]") if row["a_records"] else []
            except (ValueError, TypeError):
                a_recs = []

            if a_recs:
                first_ip = a_recs[0]
                if first_ip in scanned_ips:
                    skipped_cdn += 1
                    continue
                scanned_ips.add(first_ip)

            hostnames.append(host)

        if skipped_cdn:
            log.info(
                "%s naabu: deduped %d CDN-shared hosts (same A record) — scanning %d unique targets",
                ctx.session_id[:8], skipped_cdn, len(hostnames),
            )

        if not hostnames:
            log.info("%s naabu: no hosts after dedup — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, result_count=0, data={"ports": [], "count": 0})

        tmp_fd, tmp_path = tempfile.mkstemp(prefix="naabu_input_", suffix=".txt", dir="/tmp")
        try:
            with os.fdopen(tmp_fd, "w") as fh:
                fh.write("\n".join(hostnames))

            cmd     = self._build_naabu_command(tmp_path, ctx)
            timeout = ctx.config.get("timeout", self.default_timeout)

            start                   = time.monotonic()
            stdout, stderr, retcode = await run_subprocess(cmd, timeout=timeout)
            elapsed                 = time.monotonic() - start

            if retcode == -9:
                status = OutputStatus.TIMEOUT
            elif retcode not in (0, 1):
                status = OutputStatus.ERROR
            else:
                status = OutputStatus.SUCCESS

            data: dict = {}
            if stdout and status != OutputStatus.TIMEOUT:
                data = self.parse_output(stdout, ctx)

            await save_raw_output(ctx, cmd=cmd, stdout=stdout, stderr=stderr,
                                  status=status, elapsed=elapsed, data=data)

            result = StepResult(
                status=status,
                result_count=data.get("count", 0),
                data=data,
                stdout=stdout,
                stderr=stderr,
                command=cmd,
                execution_time=elapsed,
            )

            if result.data.get("ports"):
                try:
                    await self._persist(ctx, result)
                except Exception as exc:
                    log.error("%s naabu _persist failed: %r", ctx.session_id[:8], exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        ports = result.data.get("ports", [])
        if not ports:
            return

        rows = [
            (
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                p["host"],
                p.get("ip"),
                p["port"],
                p.get("protocol", "tcp"),
            )
            for p in ports
        ]

        await ctx.db.executemany(
            """
            INSERT INTO naabu_results
                (id, step_run_id, session_id, target_id, host, ip, port, protocol)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, host, port) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("%s naabu: persisted %d open ports for %s", ctx.session_id[:8], len(rows), ctx.domain)
