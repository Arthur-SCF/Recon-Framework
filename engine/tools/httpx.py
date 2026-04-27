"""
Real HttpxTool — HTTP probing for live host discovery.

Runs in four modes:
  R1    — all subdomains from unified subdomains table
  R2    — subdomains discovered in consolidate_r2 (from alterx + puredns permutation)
  R3    — subdomains discovered in consolidate_r3 (from katana + subdomainizer)
  ports — non-standard HTTP/HTTPS ports identified by zgrab2_service or nmap_service

Each round/mode:
  1. Queries the relevant source table to get the input list
  2. Writes targets to a temp file (URL format for ports mode, plain hostnames otherwise)
  3. Runs httpx against the temp file
  4. Upserts results into live_hosts table

httpx JSON output per line:
  url, status-code, title, content-length, content-type, webserver, tech,
  host, port, scheme, final-url, tls (object), cname, cdn, cdn-name,
  a, aaaa, response-hash, header-hash, response-time, headers (map)
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus

log = logging.getLogger("engine.tools.httpx")
from engine.pipeline.dedup import normalize_url


# Which round each step_id maps to
_ROUND_MAP = {
    "httpx_r1":    "r1",
    "httpx_r2":    "r2",
    "httpx_r3":    "r3",
    "httpx_ports": "ports",
}

# Which consolidation round's subdomains feed each httpx round
_ROUND_SOURCE = {
    "r1": None,        # all subdomains (from any round seen so far)
    "r2": "r2",       # only r2-consolidated subdomains
    "r3": "r3",       # only r3-consolidated subdomains
    # "ports" mode uses a separate query path (_get_input_port_targets)
}

# Service labels that indicate an HTTP/HTTPS service on a non-standard port
_HTTP_SERVICES = {"http", "https", "http-alt"}


class HttpxTool(BaseTool):
    label           = "Httpx"
    binary_name     = "httpx"
    default_timeout = 600

    def get_version_command(self) -> list[str]:
        return ["httpx", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        if not output:
            return None
        m = re.search(r'v?(\d+\.\d+\.\d+)', output)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        # This is set by run() after writing the temp file
        # Returning a placeholder — the actual command is built in run()
        return []

    def _build_httpx_command(self, input_file: str, ctx: StepContext) -> list[str]:
        return [
            "httpx",
            "-l", input_file,
            "-json",
            "-silent",
            "-title",
            "-status-code",
            "-content-length",
            "-content-type",
            "-web-server",
            "-tech-detect",
            "-timeout", str(ctx.config.get("timeout_per_host", 10)),
            "-threads", str(ctx.config.get("threads", 50)),
            "-retries", "1",
            # follow-redirects is intentionally omitted: following redirects masks the real
            # status code chain (301→403 appears as pure 403). Raw redirect status is more
            # accurate for recon — the redirect destination can be probed separately if needed.
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse httpx JSON-lines output into structured host records."""
        hosts: list[dict] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            url = obj.get("url") or obj.get("input", "")
            if not url:
                continue

            normalized = normalize_url(url)
            if normalized in seen:
                continue
            seen.add(normalized)

            # Extract TLS info
            tls = obj.get("tls", {}) or {}
            tls_chain = tls.get("certificate", {}) if isinstance(tls, dict) else {}

            # Security headers
            headers = obj.get("headers", {}) or {}
            headers_lower = {k.lower(): v for k, v in headers.items()}

            # Response time — httpx returns it as a string like "123.45ms" or float
            rt_raw = obj.get("response-time", obj.get("time", 0))
            response_time = _parse_response_time(rt_raw)

            # Tech stack
            tech_raw = obj.get("tech", obj.get("technologies", []))
            tech = tech_raw if isinstance(tech_raw, list) else []

            # a/aaaa records
            a_recs = obj.get("a", []) or []
            aaaa_recs = obj.get("aaaa", []) or []

            host_record = {
                "url":            normalized,
                "status_code":    obj.get("status-code", obj.get("status_code")),
                "title":          obj.get("title", ""),
                "content_length": obj.get("content-length", obj.get("content_length")),
                "content_type":   obj.get("content-type", obj.get("content_type", "")),
                "webserver":      obj.get("webserver", obj.get("web-server", "")),
                "tech":           tech,
                "host":           obj.get("host", ""),
                "port":           obj.get("port"),
                "scheme":         obj.get("scheme", ""),
                "final_url":      obj.get("final-url", obj.get("final_url", "")),
                # TLS
                "tls_version":    tls.get("tls-version", tls.get("version", "")),
                "tls_cipher":     tls.get("cipher", ""),
                "tls_subject_cn": tls_chain.get("subject-cn", tls_chain.get("subject", {}).get("cn", "")),
                "tls_issuer":     tls_chain.get("issuer-cn", tls_chain.get("issuer", {}).get("cn", "")),
                "tls_not_before": tls_chain.get("not-before", ""),
                "tls_not_after":  tls_chain.get("not-after", ""),
                "tls_self_signed": 1 if tls.get("self-signed") else 0,
                "tls_expired":    1 if tls.get("expired") else 0,
                "tls_mismatched": 1 if tls.get("mismatched") else 0,
                # DNS — cname may be a list in newer httpx versions
                "cname":          (lambda c: ", ".join(c) if isinstance(c, list) else (c or ""))(obj.get("cname", "")),
                "cdn":            1 if obj.get("cdn") else 0,
                "cdn_name":       obj.get("cdn-name", obj.get("cdn_name", "")),
                "a_records":      a_recs,
                "aaaa_records":   aaaa_recs,
                # Response
                "response_hash":  obj.get("response-hash", obj.get("body-hash", "")),
                "header_hash":    obj.get("header-hash", ""),
                "response_time":  response_time,
                # Security headers
                "has_csp":  1 if "content-security-policy" in headers_lower else 0,
                "has_xfo":  1 if "x-frame-options" in headers_lower else 0,
                "has_xcto": 1 if "x-content-type-options" in headers_lower else 0,
                "has_hsts": 1 if "strict-transport-security" in headers_lower else 0,
            }
            hosts.append(host_record)

        return {"hosts": hosts, "count": len(hosts)}

    async def run(self, ctx: StepContext) -> StepResult:
        """
        Override run() to:
        1. Determine which targets to probe (based on round / mode)
        2. Write them to a temp file
        3. Run httpx against that temp file
        4. Upsert results into live_hosts table
        """
        from engine.storage import save_raw_output, run_subprocess
        import time

        round_key = _ROUND_MAP.get(ctx.step_id, "r1")

        if round_key == "ports":
            subdomains = await self._get_input_port_targets(ctx)
        else:
            subdomains = await self._get_input_subdomains(ctx, round_key)

        if not subdomains:
            log.debug("%s: no targets to probe", ctx.step_id)
            return StepResult(
                status=OutputStatus.SUCCESS,
                result_count=0,
                data={"hosts": [], "count": 0, "round": round_key},
            )

        # Write subdomains to temp file
        tmp_fd, tmp_path = tempfile.mkstemp(prefix="httpx_input_", suffix=".txt", dir="/tmp")
        try:
            with os.fdopen(tmp_fd, "w") as f:
                f.write("\n".join(subdomains))

            cmd = self._build_httpx_command(tmp_path, ctx)
            timeout = ctx.config.get("timeout", self.default_timeout)

            start = time.monotonic()
            stdout, stderr, returncode = await run_subprocess(cmd, timeout=timeout)
            elapsed = time.monotonic() - start

            if returncode == -9:
                status = OutputStatus.TIMEOUT
            elif returncode not in (0, 1):
                status = OutputStatus.ERROR
            else:
                status = OutputStatus.SUCCESS

            data = {}
            if stdout and status != OutputStatus.TIMEOUT:
                data = self.parse_output(stdout, ctx)
                data["round"] = round_key

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

            if result.data.get("hosts"):
                try:
                    await self._persist(ctx, result)
                except Exception as exc:
                    log.error("%s: _persist failed: %r", ctx.step_id, exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    async def _get_input_subdomains(self, ctx: StepContext, round_key: str) -> list[str]:
        """
        Fetch the subdomains to probe for this round.
        R1: all subdomains for this target (not already live in this session)
        R2: subdomains first seen in r2 consolidation this session
        R3: subdomains first seen in r3 consolidation this session
        """
        if round_key == "r1":
            rows = await ctx.db.fetchall(
                "SELECT subdomain FROM subdomains WHERE target_id = ?",
                (ctx.target_id,),
            )
        else:
            # R2/R3: only subdomains consolidated in this round during this session
            rows = await ctx.db.fetchall(
                """
                SELECT subdomain FROM subdomains
                WHERE target_id = ?
                  AND first_session = ?
                  AND consolidated_in LIKE ?
                """,
                (ctx.target_id, ctx.session_id, f'%"{round_key}"%'),
            )

        return [row["subdomain"] for row in rows]

    async def _get_input_port_targets(self, ctx: StepContext) -> list[str]:
        """
        Fetch ports identified as HTTP/HTTPS by zgrab2_service or nmap_service.

        Returns URL strings like http://sub.example.com:8080 or
        https://sub.example.com:8443 ready to pass directly to httpx -l.

        Skips ports 80 and 443 — already covered by httpx_r1.
        """
        rows = await ctx.db.fetchall(
            """
            SELECT host, port, service
            FROM   naabu_results
            WHERE  session_id = ?
              AND  service    IN ('http', 'https', 'http-alt')
              AND  port       NOT IN (80, 443)
            """,
            (ctx.session_id,),
        )

        targets: list[str] = []
        seen: set[str] = set()
        for row in rows:
            scheme = "https" if row["service"] == "https" else "http"
            target = f"{scheme}://{row['host']}:{row['port']}"
            if target not in seen:
                seen.add(target)
                targets.append(target)
        return targets

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        """Upsert each live host into live_hosts table. Mark subdomain as live."""
        hosts = result.data.get("hosts", [])
        if not hosts:
            return

        for host in hosts:
            url      = host["url"]
            host_str = host.get("host", "")

            # Find matching subdomain record for FK
            sub_row = await ctx.db.fetchone(
                "SELECT id FROM subdomains WHERE target_id = ? AND subdomain = ?",
                (ctx.target_id, host_str),
            )
            subdomain_id = sub_row["id"] if sub_row else None

            existing = await ctx.db.fetchone(
                "SELECT id, status_code, title, webserver, tech, content_length, response_time, response_hash "
                "FROM live_hosts WHERE target_id = ? AND url = ?",
                (ctx.target_id, url),
            )

            if existing:
                await ctx.db.execute(
                    """
                    UPDATE live_hosts SET
                        status_code = ?, title = ?, content_length = ?,
                        content_type = ?, webserver = ?, tech = ?,
                        host = ?, port = ?, scheme = ?, final_url = ?,
                        tls_version = ?, tls_cipher = ?, tls_subject_cn = ?,
                        tls_issuer = ?, tls_not_before = ?, tls_not_after = ?,
                        tls_self_signed = ?, tls_expired = ?, tls_mismatched = ?,
                        cname = ?, cdn = ?, cdn_name = ?,
                        a_records = ?, aaaa_records = ?,
                        response_hash = ?, header_hash = ?, response_time = ?,
                        has_csp = ?, has_xfo = ?, has_xcto = ?, has_hsts = ?,
                        last_seen = datetime('now'),
                        last_status = ?, last_title = ?
                    WHERE id = ?
                    """,
                    (
                        host["status_code"], host["title"], host["content_length"],
                        host["content_type"], host["webserver"],
                        json.dumps(host["tech"]),
                        host_str, host["port"], host["scheme"], host["final_url"],
                        host["tls_version"], host["tls_cipher"], host["tls_subject_cn"],
                        host["tls_issuer"], host["tls_not_before"], host["tls_not_after"],
                        host["tls_self_signed"], host["tls_expired"], host["tls_mismatched"],
                        host["cname"], host["cdn"], host["cdn_name"],
                        json.dumps(host["a_records"]), json.dumps(host["aaaa_records"]),
                        host["response_hash"], host["header_hash"], host["response_time"],
                        host["has_csp"], host["has_xfo"], host["has_xcto"], host["has_hsts"],
                        host["status_code"], host["title"],
                        existing["id"],
                    ),
                )
            else:
                await ctx.db.execute(
                    """
                    INSERT INTO live_hosts (
                        id, target_id, subdomain_id, url,
                        status_code, title, content_length, content_type,
                        webserver, tech, host, port, scheme, final_url,
                        tls_version, tls_cipher, tls_subject_cn, tls_issuer,
                        tls_not_before, tls_not_after,
                        tls_self_signed, tls_expired, tls_mismatched,
                        cname, cdn, cdn_name, a_records, aaaa_records,
                        response_hash, header_hash, response_time,
                        has_csp, has_xfo, has_xcto, has_hsts,
                        last_status, last_title
                    ) VALUES (
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?
                    )
                    """,
                    (
                        str(uuid.uuid4()), ctx.target_id, subdomain_id, url,
                        host["status_code"], host["title"], host["content_length"],
                        host["content_type"], host["webserver"], json.dumps(host["tech"]),
                        host_str, host["port"], host["scheme"], host["final_url"],
                        host["tls_version"], host["tls_cipher"], host["tls_subject_cn"],
                        host["tls_issuer"], host["tls_not_before"], host["tls_not_after"],
                        host["tls_self_signed"], host["tls_expired"], host["tls_mismatched"],
                        host["cname"], host["cdn"], host["cdn_name"],
                        json.dumps(host["a_records"]), json.dumps(host["aaaa_records"]),
                        host["response_hash"], host["header_hash"], host["response_time"],
                        host["has_csp"], host["has_xfo"], host["has_xcto"], host["has_hsts"],
                        host["status_code"], host["title"],
                    ),
                )

            # Mark subdomain as live
            if subdomain_id:
                await ctx.db.execute(
                    "UPDATE subdomains SET is_live = 1, last_seen = datetime('now') WHERE id = ?",
                    (subdomain_id,),
                )

        await ctx.db.commit()
        log.info("%s: persisted %d live hosts for %s", ctx.step_id, len(hosts), ctx.domain)


def _parse_response_time(raw) -> float:
    """Parse response time from various formats httpx returns."""
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        import re
        m = re.search(r'([\d.]+)', raw)
        if m:
            val = float(m.group(1))
            # Convert ms to seconds if unit is ms
            if "ms" in raw.lower():
                return val / 1000.0
            return val
    return 0.0
