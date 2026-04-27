"""
Real TlsxTool — TLS certificate enumeration.

Queries TLS certs for a domain and extracts Subject Alternative Names (SANs)
and Subject CN as additional subdomains.

Output format: JSON lines (-json flag).
Persists subdomains to tlsx_results table.
"""
from __future__ import annotations

import json
import logging
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus

log = logging.getLogger("engine.tools.tlsx")
from engine.pipeline.dedup import normalize_subdomain


class TlsxTool(BaseTool):
    label           = "Tlsx"
    binary_name     = "tlsx"
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["tlsx", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        if not output:
            return None
        m = re.search(r'v?(\d+\.\d+\.\d+)', output)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return [
            "tlsx",
            "-u", ctx.domain,
            "-san",           # extract Subject Alternative Names
            "-cn",            # extract Subject Common Name
            "-silent",
            "-json",
            "-timeout", str(ctx.config.get("timeout_per_host", 10)),
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        subdomains: list[str] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Collect CN + all SANs as candidate subdomains
            candidates: list[str] = []
            if obj.get("subject_cn"):
                candidates.append(obj["subject_cn"])
            for san in obj.get("subject_an", []):
                candidates.append(san)

            for raw in candidates:
                normalized = normalize_subdomain(raw, ctx.domain)
                if normalized and normalized not in seen:
                    seen.add(normalized)
                    subdomains.append(normalized)

        return {"subdomains": subdomains, "count": len(subdomains)}

    async def run(self, ctx: StepContext) -> StepResult:
        result = await super().run(ctx)
        if result.status == OutputStatus.SUCCESS and result.data.get("subdomains"):
            await self._persist(ctx, result)
        return result

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        rows = [
            (
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                sub,
            )
            for sub in result.data.get("subdomains", [])
        ]
        if not rows:
            return

        await ctx.db.executemany(
            """
            INSERT INTO tlsx_results
                (id, step_run_id, session_id, target_id, subdomain)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("persisted %d subdomains for %s", len(rows), ctx.domain)
