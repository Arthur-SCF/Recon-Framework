"""
Real SubdomainizerTool — JS subdomain extraction via SubDomainizer.

Selects the highest-scored live host URL for this target (same scoring logic as
CeWL), runs SubDomainizer against it, extracts subdomains, persists to
subdomainizer_results.

step_id: subdomainizer
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.pipeline.dedup import normalize_subdomain
from engine.storage import run_subprocess, save_raw_output
from engine.tools.cewl import _score_host

log = logging.getLogger("engine.tools.subdomainizer")


async def _select_url(ctx: StepContext) -> str | None:
    """Pick the highest-scored live host URL for SubDomainizer to crawl."""
    rows = await ctx.db.fetchall(
        """
        SELECT url, status_code, scheme, host, content_length, title
        FROM live_hosts
        WHERE target_id = ? AND in_scope = 1
        """,
        (ctx.target_id,),
    )
    if not rows:
        return None

    scored = [(row["url"], _score_host(dict(row), ctx.domain)) for row in rows]
    scored.sort(key=lambda x: x[1], reverse=True)

    best_url, best_score = scored[0]
    log.debug(
        "%s subdomainizer: selected %s (score=%d)",
        ctx.session_id[:8], best_url, best_score,
    )
    return best_url


class SubdomainizerTool(BaseTool):
    label           = "SubDomainizer"
    binary_name     = "SubDomainizer"
    parallelisable  = True
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["SubDomainizer", "--help"]

    def parse_version(self, output: str) -> str | None:
        return None   # SubDomainizer has no --version flag

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def parse_output(self, raw: str, ctx: StepContext) -> dict:
        """
        SubDomainizer outputs one entry per line mixed with status/JS-file info.
        We filter aggressively: keep only lines that look like valid subdomains
        of ctx.domain after normalization.
        """
        subdomains: list[str] = []
        seen: set[str] = set()

        for line in raw.splitlines():
            candidate = line.strip()
            if not candidate or candidate.startswith("#"):
                continue
            # Reject lines that are clearly file paths or status messages
            if any(c in candidate for c in (" ", "/", "\\", "[", "]", "http")):
                continue

            norm = normalize_subdomain(candidate, ctx.domain)
            if norm and norm not in seen:
                seen.add(norm)
                subdomains.append(norm)

        return {"subdomains": subdomains, "count": len(subdomains)}

    async def run(self, ctx: StepContext) -> StepResult:
        # Check binary is available
        import shutil
        if not shutil.which("SubDomainizer"):
            log.warning("%s subdomainizer: binary not found — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        url = await _select_url(ctx)
        if not url:
            log.info("%s subdomainizer: no live hosts — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        tmp_fd, tmp_out = tempfile.mkstemp(prefix="subdomainizer_out_", suffix=".txt", dir="/tmp")
        os.close(tmp_fd)

        try:
            cmd = [
                "SubDomainizer",
                "-u", url,
                "-o", tmp_out,
            ]
            timeout = ctx.config.get("timeout", self.default_timeout)

            start = time.monotonic()
            try:
                import os as _os
                stdout, stderr, retcode = await run_subprocess(
                    cmd, timeout=timeout,
                    env={**_os.environ, "TLDEXTRACT_CACHE": "/tmp/tldextract"},
                )
            except FileNotFoundError:
                log.warning(
                    "%s subdomainizer: binary not executable or missing — skipping",
                    ctx.session_id[:8],
                )
                return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})
            elapsed = time.monotonic() - start

            if retcode == -9:
                status = OutputStatus.TIMEOUT
            elif retcode not in (0, 1):
                status = OutputStatus.ERROR
            else:
                status = OutputStatus.SUCCESS

            # Read output file (SubDomainizer writes subdomains there)
            raw = ""
            if os.path.exists(tmp_out):
                try:
                    with open(tmp_out) as f:
                        raw = f.read()
                except OSError:
                    pass

            data: dict = {"count": 0}
            if raw:
                data = self.parse_output(raw, ctx)

            await save_raw_output(
                ctx, cmd=cmd,
                stdout=stdout + ("\n\n--- output file ---\n" + raw if raw else ""),
                stderr=stderr,
                status=status, elapsed=elapsed, data=data,
            )

            result = StepResult(
                status=status,
                result_count=data.get("count", 0),
                data=data,
                stdout=stdout,
                stderr=stderr,
                command=cmd,
                execution_time=elapsed,
            )

            if data.get("subdomains"):
                try:
                    await self._persist(ctx, result)
                except Exception as exc:
                    log.error("%s subdomainizer _persist failed: %r", ctx.session_id[:8], exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result

        finally:
            try:
                os.unlink(tmp_out)
            except OSError:
                pass

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
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
                None,  # url — not available from SubDomainizer output (NULL avoids UNIQUE conflict)
                None,  # source_url
            )
            for sub in subdomains
        ]

        await ctx.db.executemany(
            """
            INSERT INTO subdomainizer_results
                (id, step_run_id, session_id, target_id, subdomain, url, source_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, url) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info(
            "%s subdomainizer: persisted %d subdomains for %s",
            ctx.session_id[:8], len(rows), ctx.domain,
        )
