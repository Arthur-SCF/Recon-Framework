"""
NmapServiceTool — service version detection on naabu-discovered open ports.

Alternative to ZGrab2ServiceTool. Can be swapped in via pipeline config.

Strategy:
  - Collect all unique ports from naabu_results for this session
  - Write all hosts to a temp file
  - Run:  nmap -sV --open -p PORT1,PORT2,... -iL hosts.txt -oX -
  - Parse XML: match (host addr, port) back to naabu_results rows

nmap -sV makes a genuine connection and grabs the service banner, eliminating
SYN-scan false positives and providing service + version strings for SSH, HTTP,
SMTP, SMB, MySQL, PostgreSQL, Redis, and 1000+ other protocols.

NOTE: nmap -sV is significantly slower than ZGrab2. Default timeout is 40 min.
For large scopes, consider using ZGrab2 instead or reducing the port range.

Input:  naabu_results rows for this session_id
Output: UPDATE naabu_results SET service, service_version, service_source, banner
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
import xml.etree.ElementTree as ET

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.nmap_service")


class NmapServiceTool(BaseTool):
    label           = "Nmap Service Detection"
    binary_name     = "nmap"
    parallelisable  = False
    default_timeout = 2400   # 40 min — nmap -sV is thorough but slow

    def get_version_command(self) -> list[str]:
        return ["nmap", "--version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'Nmap\s+version\s+([\d.]+)', output or "", re.IGNORECASE)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        # Built dynamically in run()
        return []

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        # Not used — XML is parsed inline in run()
        return {}

    def _parse_nmap_xml(self, xml_text: str) -> list[dict]:
        """
        Parse nmap XML output. Returns list of:
          {addr, hostname, port, service, version, product, banner}

        `addr` = IP from <address addrtype="ipv4|ipv6">
        `hostname` = from <hostname> if present (the original input name)
        """
        if not xml_text or not xml_text.strip():
            return []

        results: list[dict] = []
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as exc:
            log.warning("nmap XML parse error: %s", exc)
            return []

        for host_elem in root.findall("host"):
            # Resolve IP
            addr = ""
            for addr_elem in host_elem.findall("address"):
                if addr_elem.get("addrtype") in ("ipv4", "ipv6"):
                    addr = addr_elem.get("addr", "")
                    break

            # Try to recover the original hostname nmap was given
            hostname = ""
            hostnames_elem = host_elem.find("hostnames")
            if hostnames_elem is not None:
                for hn in hostnames_elem.findall("hostname"):
                    if hn.get("type") == "user":
                        hostname = hn.get("name", "")
                        break
                if not hostname:
                    first = hostnames_elem.find("hostname")
                    if first is not None:
                        hostname = first.get("name", "")

            ports_elem = host_elem.find("ports")
            if ports_elem is None:
                continue

            for port_elem in ports_elem.findall("port"):
                # Only consider open ports
                state_elem = port_elem.find("state")
                if state_elem is None or state_elem.get("state") != "open":
                    continue

                portid = int(port_elem.get("portid", 0))
                service_elem = port_elem.find("service")
                if service_elem is None:
                    svc_name = ""
                    product  = ""
                    version  = ""
                    extra    = ""
                else:
                    svc_name = service_elem.get("name", "")
                    product  = service_elem.get("product", "")
                    version  = service_elem.get("version", "")
                    extra    = service_elem.get("extrainfo", "")

                # Build a human-readable version string
                version_str = " ".join(filter(None, [product, version, extra])).strip()

                results.append({
                    "addr":     addr,
                    "hostname": hostname,
                    "port":     portid,
                    "service":  svc_name,
                    "version":  version_str or None,
                    "banner":   None,  # nmap -sV doesn't expose raw banners in XML
                })

        return results

    async def run(self, ctx: StepContext) -> StepResult:
        # 1. Load all (id, host, port) from naabu_results for this session
        rows = await ctx.db.fetchall(
            "SELECT id, host, port FROM naabu_results WHERE session_id = ?",
            (ctx.session_id,),
        )
        if not rows:
            log.info("%s nmap_service: no naabu results — skipping", ctx.session_id[:8])
            return StepResult(
                status=OutputStatus.SKIPPED,
                result_count=0,
                data={"identified": 0},
            )

        # 2. Build unique port list + host list + lookup map
        unique_ports: set[int] = set()
        unique_hosts: set[str] = set()
        # Map: host → {port → row_id}
        host_port_map: dict[str, dict[int, str]] = {}
        for row in rows:
            unique_ports.add(row["port"])
            unique_hosts.add(row["host"])
            host_port_map.setdefault(row["host"], {})[row["port"]] = row["id"]

        ports_str = ",".join(str(p) for p in sorted(unique_ports))

        tmp_fd, tmp_path = tempfile.mkstemp(prefix="nmap_hosts_", suffix=".txt", dir="/tmp")
        try:
            with os.fdopen(tmp_fd, "w") as fh:
                fh.write("\n".join(sorted(unique_hosts)))

            rate = ctx.config.get("nmap_rate", 0)      # 0 = nmap default
            timing = ctx.config.get("nmap_timing", 4)  # T4 = aggressive

            cmd = [
                "nmap",
                "-sV",
                "--open",
                f"-T{timing}",
                "-p", ports_str,
                "-iL", tmp_path,
                "-oX", "-",     # XML to stdout
            ]
            if rate:
                cmd += ["--min-rate", str(rate)]

            timeout = ctx.config.get("timeout", self.default_timeout)
            start   = time.monotonic()
            stdout, stderr, retcode = await run_subprocess(cmd, timeout=timeout)
            elapsed = time.monotonic() - start

        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        if retcode == -9:
            status = OutputStatus.TIMEOUT
        elif retcode not in (0, 1):
            status = OutputStatus.ERROR
        else:
            status = OutputStatus.SUCCESS

        total_identified = 0

        if stdout and status != OutputStatus.TIMEOUT:
            nmap_results = self._parse_nmap_xml(stdout)

            for entry in nmap_results:
                addr     = entry["addr"]
                hostname = entry["hostname"]
                port     = entry["port"]
                service  = entry["service"] or None
                version  = entry["version"]

                # Locate the naabu_results row — try hostname first, then IP
                row_id = None
                for candidate in (hostname, addr):
                    if candidate and candidate in host_port_map:
                        row_id = host_port_map[candidate].get(port)
                        if row_id:
                            break

                if not row_id:
                    continue

                await ctx.db.execute(
                    """
                    UPDATE naabu_results
                    SET service         = ?,
                        service_version = ?,
                        service_source  = 'nmap',
                        ip              = COALESCE(ip, ?)
                    WHERE id = ?
                    """,
                    (service, version, addr or None, row_id),
                )
                if service:
                    total_identified += 1

            await ctx.db.commit()

        data_summary = {
            "identified": total_identified,
            "total_ports": len(rows),
        }

        await save_raw_output(
            ctx,
            cmd=cmd,
            stdout=stdout,
            stderr=stderr,
            status=status,
            elapsed=elapsed,
            data=data_summary,
        )

        log.info(
            "%s nmap_service: %d/%d ports identified for %s",
            ctx.session_id[:8], total_identified, len(rows), ctx.domain,
        )
        return StepResult(
            status=status,
            result_count=total_identified,
            data=data_summary,
            stdout=stdout,
            stderr=stderr,
            command=cmd,
            execution_time=elapsed,
        )
