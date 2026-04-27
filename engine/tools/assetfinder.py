"""
Real AssetfinderTool — passive subdomain enumeration.

Simple line-based output (one subdomain per line).
Persists to assetfinder_results table.
"""
from __future__ import annotations

import logging
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus

log = logging.getLogger("engine.tools.assetfinder")
from engine.pipeline.dedup import normalize_subdomain


class AssetfinderTool(BaseTool):
    label           = "Assetfinder"
    binary_name     = "assetfinder"
    default_timeout = 180

    def get_version_command(self) -> list[str]:
        # assetfinder has no --version flag; check if it exists
        return ["assetfinder", "--help"]

    def parse_version(self, output: str) -> str | None:
        # No version output — return None to indicate "installed but unknown version"
        return None

    def build_command(self, ctx: StepContext) -> list[str]:
        return [
            "assetfinder",
            "--subs-only",
            ctx.domain,
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        subdomains: list[str] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            normalized = normalize_subdomain(line, ctx.domain)
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
            INSERT INTO assetfinder_results
                (id, step_run_id, session_id, target_id, subdomain)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("persisted %d subdomains for %s", len(rows), ctx.domain)
