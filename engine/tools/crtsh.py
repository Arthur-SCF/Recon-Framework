"""
CrtShAction — Certificate Transparency Log query via crt.sh API.

This is a BaseAction (no subprocess) — it makes an HTTP request
to crt.sh's JSON API and extracts subdomains from certificate records.

Persists to ctl_results table.
"""
from __future__ import annotations

import asyncio
import json
import logging
import ssl
import urllib.request
import uuid

from engine.pipeline.base import BaseAction, StepContext

log = logging.getLogger("engine.tools.crtsh")
from engine.pipeline.dedup import normalize_subdomain


class CrtShAction(BaseAction):
    label = "crt.sh (CTL)"

    async def execute(self, ctx: StepContext) -> dict:
        url = f"https://crt.sh/?q=%.{ctx.domain}&output=json"
        timeout = ctx.config.get("timeout", 30)

        # Run blocking HTTP request in thread pool to not block event loop
        loop = asyncio.get_event_loop()
        try:
            raw_data = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_crtsh, url, timeout),
                timeout=timeout + 5,
            )
        except asyncio.TimeoutError:
            log.warning("timeout after %ds for %s", timeout, ctx.domain)
            return {"subdomains": [], "count": 0}
        except Exception as exc:
            log.warning("fetch error for %s: %s", ctx.domain, exc)
            return {"subdomains": [], "count": 0}

        if raw_data is None:
            return {"subdomains": [], "count": 0}

        # Parse and deduplicate
        subdomains: list[str] = []
        seen: set[str] = set()

        for entry in raw_data:
            # name_value can have multiple names separated by \n
            name_value = entry.get("name_value", "")
            for raw in name_value.splitlines():
                normalized = normalize_subdomain(raw.strip(), ctx.domain)
                if normalized and normalized not in seen:
                    seen.add(normalized)
                    subdomains.append(normalized)

        if subdomains:
            await self._persist(ctx, subdomains)

        log.info("%d subdomains for %s", len(subdomains), ctx.domain)
        return {"subdomains": subdomains, "count": len(subdomains)}

    async def _persist(self, ctx: StepContext, subdomains: list[str]) -> None:
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
            INSERT INTO ctl_results
                (id, step_run_id, session_id, target_id, subdomain)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()


def _fetch_crtsh(url: str, timeout: int) -> list | None:
    """Synchronous crt.sh fetch. Runs in a thread pool."""
    ctx = ssl.create_default_context()
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "recon-app/1.0 crt.sh subdomain query"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body)
    except Exception:
        return None
