"""
Real SubfinderTool implementation.

Replaces MockSubfinder in Phase 3.
Subfinder is invoked with -silent (one subdomain per line) and optional
provider config if API keys are configured.
"""
from __future__ import annotations

import logging
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus

log = logging.getLogger("engine.tools.subfinder")
from engine.pipeline.dedup import normalize_subdomain


class SubfinderTool(BaseTool):
    label          = "Subfinder"
    binary_name    = "subfinder"
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["subfinder", "--version"]

    def parse_version(self, output: str) -> str | None:
        # subfinder prints: "subfinder v2.x.x ..." or just "v2.x.x"
        import re
        if not output:
            return None
        m = re.search(r'v?(\d+\.\d+\.\d+)', output)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        cmd = [
            "subfinder",
            "-d", ctx.domain,
            "-silent",
            "-timeout", str(ctx.config.get("timeout_per_source", 30)),
            "-t", str(ctx.config.get("threads", 10)),
        ]

        # Use provider config if it exists (written by settings API at scan time)
        import os
        provider_cfg = f"/data/tool-configs/subfinder/provider-config.yaml"
        if os.path.exists(provider_cfg):
            cmd += ["-pc", provider_cfg]

        return cmd

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse subfinder's line-based output (one subdomain per line)."""
        subdomains: list[str] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            normalized = normalize_subdomain(line, ctx.domain)
            if normalized and normalized not in seen:
                seen.add(normalized)
                subdomains.append(normalized)

        return {"subdomains": subdomains, "count": len(subdomains)}

    async def run(self, ctx: StepContext) -> StepResult:
        """
        Override run() to also persist results to subfinder_results table.
        """
        result = await super().run(ctx)

        if result.status == OutputStatus.SUCCESS and result.data.get("subdomains"):
            await self._persist(ctx, result)

        return result

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        """Insert parsed subdomains into subfinder_results."""
        subdomains = result.data.get("subdomains", [])
        if not subdomains:
            return

        rows = [
            (
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                sub,
            )
            for sub in subdomains
        ]

        await ctx.db.executemany(
            """
            INSERT INTO subfinder_results
                (id, step_run_id, session_id, target_id, subdomain)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("persisted %d subdomains for %s", len(rows), ctx.domain)
