"""
Real AmassТool — passive enumeration only.

Uses `amass enum -passive` to avoid active scanning.
Output format: JSON (-json flag), each line has 'name' (the subdomain).
Persists to amass_results table.
"""
from __future__ import annotations

import json
import logging
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus

log = logging.getLogger("engine.tools.amass")
from engine.pipeline.dedup import normalize_subdomain


class AmassTool(BaseTool):
    label           = "Amass"
    binary_name     = "amass"
    default_timeout = 900    # 15 min subprocess timeout (safety net; amass exits via -timeout first)

    def get_version_command(self) -> list[str]:
        return ["amass", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        if not output:
            return None
        m = re.search(r'v?(\d+\.\d+\.\d+)', output)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        # amass v4 passive enumeration.
        # -norecursive: do not recursively enumerate subdomains of found subdomains.
        #               Critical for memory usage — without it amass can consume 2-4 GB
        #               on large targets and OOM-kill the Gunicorn worker.
        # -timeout:     amass internal timeout in minutes. Default 10 min is a good
        #               balance between coverage and memory pressure for large targets.
        #               Override via config key "timeout_minutes".
        # Output format per line: "sub.example.com (FQDN) --> record_type --> target (FQDN)"
        # We parse the first column (before the first space).
        return [
            "amass", "enum",
            "-passive",
            "-norecursive",
            "-d", ctx.domain,
            "-timeout", str(ctx.config.get("timeout_minutes", 10)),
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        subdomains: list[dict] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            # Extract the first token — the subdomain — before the " (" annotation
            raw = line.split(" ")[0].split("(")[0].strip()
            normalized = normalize_subdomain(raw, ctx.domain)
            if normalized and normalized not in seen:
                seen.add(normalized)
                subdomains.append({
                    "subdomain": normalized,
                    "sources":   [],
                    "tag":       "",
                })

        return {"subdomains": subdomains, "count": len(subdomains)}

    async def run(self, ctx: StepContext) -> StepResult:
        result = await super().run(ctx)
        if result.status == OutputStatus.SUCCESS and result.data.get("subdomains"):
            await self._persist(ctx, result)
        return result

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        rows = []
        for entry in result.data.get("subdomains", []):
            rows.append((
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                entry["subdomain"],
                json.dumps(entry.get("sources", [])),
                entry.get("tag", ""),
            ))

        if not rows:
            return

        await ctx.db.executemany(
            """
            INSERT INTO amass_results
                (id, step_run_id, session_id, target_id, subdomain, sources, tag)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("persisted %d subdomains for %s", len(rows), ctx.domain)
