"""
ZGrab2ServiceTool — service fingerprinting on naabu-discovered open ports.

For each unique port found by naabu this session, runs:
    zgrab2 multiple --port PORT --senders N < hosts_with_that_port.txt

Identifies the running service from zgrab2 NDJSON data keys and UPDATEs
naabu_results with service, service_version, service_source, banner.

Ports where zgrab2 gets no response are left with service=NULL (false positive
from naabu's SYN scan — the port didn't complete a real handshake).

Input:  naabu_results rows for this session_id
Output: UPDATE naabu_results SET service, service_version, service_source, banner
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.zgrab2")

# Map port number → zgrab2 subcommand (scanner module).
# Ports not in this map fall back to 'banner' (raw TCP grab).
_PORT_SCANNER: dict[int, str] = {
    21:  "ftp",
    22:  "ssh",
    23:  "telnet",
    25:  "smtp",
    80:  "http",
    110: "pop3",
    143: "imap",
    443: "tls",
    445: "smb",
    587: "smtp",
    465: "smtp",
    993: "imap",
    995: "pop3",
    3306: "mysql",
    5432: "postgres",
    6379: "redis",
}


def _scanner_for_port(port: int) -> str:
    return _PORT_SCANNER.get(port, "banner")


# Map zgrab2 data keys → canonical service label stored in naabu_results.service
_SERVICE_MAP: dict[str, str] = {
    "http":     "http",
    "tls":      "https",
    "ssh":      "ssh",
    "smtp":     "smtp",
    "pop3":     "pop3",
    "imap":     "imap",
    "ftp":      "ftp",
    "telnet":   "telnet",
    "smb":      "smb",
    "mssql":    "mssql",
    "mysql":    "mysql",
    "postgres": "postgres",
    "redis":    "redis",
    "bacnet":   "bacnet",
    "dnp3":     "dnp3",
    "fox":      "fox",
    "modbus":   "modbus",
    "siemens":  "siemens-s7",
    "banner":   "banner",   # generic — raw banner grab, unidentified protocol
}


def _scalar(val) -> str:
    """Coerce a zgrab2 field to a plain string — newer versions return lists."""
    if isinstance(val, list):
        return val[0] if val else ""
    return val or ""


def _extract_service_info(key: str, result: dict) -> tuple[str | None, str | None]:
    """
    Extract (service_version, banner) from a zgrab2 scanner result dict.
    Returns (None, None) on failure — callers can still use the service label.
    """
    try:
        if key == "ssh":
            sid = result.get("server_id", {})
            raw = _scalar(sid.get("raw") or sid.get("version", ""))
            return raw or None, raw or None

        if key in ("smtp", "ftp", "pop3", "imap", "telnet", "banner"):
            banner = _scalar(result.get("banner", ""))
            return banner[:120] or None, banner[:512] or None

        if key == "http":
            resp = result.get("response", {})
            headers = resp.get("headers", {})
            server_vals = headers.get("server", [])
            server = _scalar(server_vals[0] if isinstance(server_vals, list) else server_vals)
            return server or None, None

        if key == "tls":
            hs = result.get("handshake_log", {})
            certs = hs.get("server_certificates", {})
            cert = certs.get("certificate", {})
            parsed = cert.get("parsed", {})
            cn = _scalar(parsed.get("subject", {}).get("common_name", ""))
            return cn or None, None

        if key == "redis":
            return _scalar(result.get("version", "")) or None, None

        if key == "mysql":
            return _scalar(result.get("server_version", "")) or None, None

        if key == "smb":
            native_os = _scalar(result.get("native_os", ""))
            native_lm = _scalar(result.get("native_lm", ""))
            ver = " ".join(filter(None, [native_os, native_lm]))
            return ver or None, None

    except Exception:
        pass

    return None, None


def _identify_service(data: dict) -> tuple[str | None, str | None, str | None]:
    """
    Identify service from zgrab2 'data' dict.

    Returns: (service_label, service_version, banner)
    Only considers scanners with status='success'.
    Prefers more specific protocols over the generic 'banner' catch-all.
    """
    # Gather all successful scanner results; prefer specifics over 'banner'
    candidates: list[tuple[str, str, dict]] = []
    for key, label in _SERVICE_MAP.items():
        entry = data.get(key)
        if not entry:
            continue
        if entry.get("status") != "success":
            continue
        result = entry.get("result", {})
        candidates.append((key, label, result))

    if not candidates:
        return None, None, None

    # Prefer any specific protocol over the generic 'banner' scanner
    specific = [(k, l, r) for k, l, r in candidates if k != "banner"]
    chosen = specific[0] if specific else candidates[0]

    key, label, result = chosen
    version, banner = _extract_service_info(key, result)
    return label, version, banner


class ZGrab2ServiceTool(BaseTool):
    label           = "ZGrab2 Service Detection"
    binary_name     = "zgrab2"
    parallelisable  = False
    default_timeout = 1200   # 20 min — larger scopes need time

    def get_version_command(self) -> list[str]:
        return ["zgrab2", "--version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?(\d+\.\d+\.\d+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        # Built dynamically per-port in run()
        return []

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        # Not used — we parse inline during run() per port-batch
        return {}

    async def run(self, ctx: StepContext) -> StepResult:
        # 1. Load all (host, port) pairs naabu found this session
        rows = await ctx.db.fetchall(
            "SELECT id, host, port FROM naabu_results WHERE session_id = ?",
            (ctx.session_id,),
        )
        if not rows:
            log.info("%s zgrab2: no naabu results — skipping", ctx.session_id[:8])
            return StepResult(
                status=OutputStatus.SKIPPED,
                result_count=0,
                data={"identified": 0, "skipped": 0},
            )

        # 2. Group by port so each zgrab2 invocation covers one port across all hosts
        port_to_rows: dict[int, list[dict]] = {}
        for row in rows:
            port_to_rows.setdefault(row["port"], []).append(row)

        senders = ctx.config.get("zgrab2_senders", 100)
        timeout = ctx.config.get("timeout", self.default_timeout)

        all_stdout: list[str] = []
        total_identified = 0
        total_errors = 0
        overall_status = OutputStatus.SUCCESS
        start = time.monotonic()

        for port, port_rows in sorted(port_to_rows.items()):
            hosts = [r["host"] for r in port_rows]
            # Map host → row_id for DB update
            host_to_id: dict[str, str] = {r["host"]: r["id"] for r in port_rows}

            tmp_fd, tmp_path = tempfile.mkstemp(prefix="zgrab2_hosts_", suffix=".txt", dir="/tmp")
            try:
                with os.fdopen(tmp_fd, "w") as fh:
                    fh.write("\n".join(hosts))

                scanner = _scanner_for_port(port)
                cmd = [
                    "zgrab2",
                    "--blocklist-file", "/dev/null",  # required in newer zgrab2; /dev/null = no blocklist
                    scanner,
                    "--port", str(port),
                    "--senders", str(senders),
                    "--input-file", tmp_path,
                ]

                stdout, stderr, retcode = await run_subprocess(cmd, timeout=timeout)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

            if retcode == -9:
                overall_status = OutputStatus.TIMEOUT
                break
            if retcode not in (0, 1):
                log.warning("%s zgrab2 port %d: exit %d", ctx.session_id[:8], port, retcode)
                total_errors += 1
                overall_status = OutputStatus.ERROR
                continue

            all_stdout.append(stdout or "")

            # 3. Parse NDJSON output and update naabu_results
            for line in (stdout or "").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # zgrab2 output: {"ip": "...", "domain": "...", "data": {...}}
                # domain = original hostname (what we passed as input)
                # ip = resolved IP
                host_key = obj.get("domain") or obj.get("ip", "")
                if not host_key:
                    continue

                row_id = host_to_id.get(host_key)
                if not row_id:
                    # Fallback: try IP match
                    ip_val = obj.get("ip", "")
                    row_id = host_to_id.get(ip_val)
                if not row_id:
                    continue

                data = obj.get("data", {})
                service, version, banner = _identify_service(data)

                # Also store the raw IP reported by zgrab2
                ip_addr = obj.get("ip")

                await ctx.db.execute(
                    """
                    UPDATE naabu_results
                    SET service = ?,
                        service_version = ?,
                        service_source  = 'zgrab2',
                        banner          = ?,
                        ip              = COALESCE(ip, ?)
                    WHERE id = ?
                    """,
                    (service, version, banner, ip_addr, row_id),
                )
                if service:
                    total_identified += 1

        await ctx.db.commit()
        elapsed = time.monotonic() - start

        combined_stdout = "\n".join(all_stdout)
        data_summary = {
            "identified": total_identified,
            "total_ports": len(rows),
            "errors": total_errors,
        }

        await save_raw_output(
            ctx,
            cmd=["zgrab2", "multiple", "(per-port batches)"],
            stdout=combined_stdout,
            stderr="",
            status=overall_status,
            elapsed=elapsed,
            data=data_summary,
        )

        log.info(
            "%s zgrab2: %d/%d ports identified across %d unique ports",
            ctx.session_id[:8], total_identified, len(rows), len(port_to_rows),
        )
        return StepResult(
            status=overall_status,
            result_count=total_identified,
            data=data_summary,
            stdout=combined_stdout,
            execution_time=elapsed,
        )
