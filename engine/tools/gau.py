"""
Real GauTool — GetAllUrls passive URL/subdomain enumeration.

gau fetches known URLs from AlienVault OTX, the Wayback Machine,
and Common Crawl. With --subs it also fetches subdomains.

Output: one URL per line.
We extract unique normalized subdomains from URLs and persist them.
Persists raw URLs to gau_results; normalized subdomains feed consolidation.
"""
from __future__ import annotations

import logging
import uuid
from urllib.parse import urlparse

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus

log = logging.getLogger("engine.tools.gau")
from engine.pipeline.dedup import normalize_subdomain


class GauTool(BaseTool):
    label           = "Gau"
    binary_name     = "gau"
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["gau", "--version"]

    def parse_version(self, output: str) -> str | None:
        import re
        if not output:
            return None
        m = re.search(r'v?(\d+\.\d+\.\d+)', output)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        # Common Crawl has been unreliable (API changes, frequent timeouts).
        # Default to wayback + otx + urlscan only; commoncrawl can be re-enabled
        # via config if needed.
        providers = ctx.config.get("gau_providers", "wayback,otx,urlscan")
        timeout   = ctx.config.get("gau_timeout", 30)
        return [
            "gau",
            "--subs",
            "--threads",   str(ctx.config.get("threads", 2)),
            "--timeout",   str(timeout),
            "--providers", providers,
            ctx.domain,
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        urls: list[str] = []
        seen_urls: set[str] = set()
        subdomains: list[str] = []
        seen_subs: set[str] = set()

        for line in stdout.splitlines():
            url = line.strip()
            if not url:
                continue

            if url not in seen_urls:
                seen_urls.add(url)
                urls.append(url)

            # Extract subdomain from URL
            try:
                parsed = urlparse(url)
                host = parsed.hostname or ""
            except Exception:
                host = ""

            if host:
                normalized = normalize_subdomain(host, ctx.domain)
                if normalized and normalized not in seen_subs:
                    seen_subs.add(normalized)
                    subdomains.append(normalized)

        return {
            "urls":       urls,
            "subdomains": subdomains,
            "count":      len(subdomains),
        }

    async def run(self, ctx: StepContext) -> StepResult:
        result = await super().run(ctx)
        if result.status == OutputStatus.SUCCESS and result.data.get("urls"):
            await self._persist(ctx, result)
        return result

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        urls       = result.data.get("urls", [])
        subdomains = result.data.get("subdomains", [])

        if urls:
            url_rows = []
            for url in urls:
                # Extract subdomain for the subdomain column
                try:
                    parsed = urlparse(url)
                    host = parsed.hostname or ""
                except Exception:
                    host = ""
                sub = normalize_subdomain(host, ctx.domain) if host else None
                url_rows.append((
                    str(uuid.uuid4()),
                    ctx.step_run_id,
                    ctx.session_id,
                    ctx.target_id,
                    url,
                    sub,
                ))

            await ctx.db.executemany(
                """
                INSERT INTO gau_results
                    (id, step_run_id, session_id, target_id, url, subdomain)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(step_run_id, url) DO NOTHING
                """,
                url_rows,
            )

        await ctx.db.commit()
        log.info("persisted %d URLs, %d unique subdomains for %s", len(urls), len(subdomains), ctx.domain)
