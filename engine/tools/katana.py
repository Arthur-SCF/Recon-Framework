"""
Real KatanaTool — JS-aware web crawler for subdomain and endpoint discovery.

Reads live host URLs for this target (up to 500), crawls with headless JS support,
extracts subdomains from discovered URLs, persists to katana_results.

step_id: katana
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid
from urllib.parse import urlparse

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.pipeline.dedup import normalize_subdomain
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.katana")

_MAX_INPUT_URLS = 500


class KatanaTool(BaseTool):
    label           = "Katana"
    binary_name     = "katana"
    parallelisable  = True
    default_timeout = 600   # 10 min — JS crawl is slow

    def get_version_command(self) -> list[str]:
        return ["katana", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?([\d.]+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """
        Parse katana JSONL output. Each line is a JSON object.
        Extract URL from 'request.endpoint' or 'url' key.
        Derive subdomain from each URL's hostname.
        """
        subdomains: list[str] = []
        urls: list[str] = []
        seen_subs: set[str] = set()
        seen_urls: set[str] = set()

        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # katana v1 JSONL: {"request": {"endpoint": "..."}, ...}
            # katana v2+ JSONL: {"url": "...", ...}
            url = (
                obj.get("url")
                or obj.get("endpoint")
                or (obj.get("request") or {}).get("endpoint", "")
            )
            if not url:
                continue

            source_url = (
                obj.get("source_url")
                or obj.get("source")
                or (obj.get("request") or {}).get("source", "")
                or ""
            )

            if url not in seen_urls:
                seen_urls.add(url)
                urls.append(url)

            # Extract subdomain from URL
            try:
                hostname = urlparse(url).hostname or ""
            except Exception:
                continue

            norm = normalize_subdomain(hostname, ctx.domain)
            if norm and norm not in seen_subs:
                seen_subs.add(norm)
                subdomains.append(norm)

        return {
            "subdomains": subdomains,
            "urls":       urls,
            "count":      len(subdomains),
        }

    async def run(self, ctx: StepContext) -> StepResult:
        from engine.storage import run_subprocess, save_raw_output

        # Fetch live host URLs for input
        rows = await ctx.db.fetchall(
            "SELECT url FROM live_hosts WHERE target_id = ? ORDER BY first_seen",
            (ctx.target_id,),
        )
        if not rows:
            log.info("%s katana: no live hosts — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        input_urls = [r["url"] for r in rows][:_MAX_INPUT_URLS]
        if len(rows) > _MAX_INPUT_URLS:
            log.warning(
                "%s katana: capping input to %d URLs (%d total)",
                ctx.session_id[:8], _MAX_INPUT_URLS, len(rows),
            )

        tmp_fd, tmp_path = tempfile.mkstemp(prefix="katana_input_", suffix=".txt", dir="/tmp")
        try:
            with os.fdopen(tmp_fd, "w") as f:
                f.write("\n".join(input_urls))

            concurrency   = ctx.config.get("katana_concurrency", 10)
            parallelism   = ctx.config.get("katana_parallelism", 5)
            rate_limit    = ctx.config.get("katana_rate_limit", 100)
            depth         = ctx.config.get("katana_depth", 3)
            timeout       = ctx.config.get("timeout", self.default_timeout)
            # crawl_duration: graceful crawl time cap (katana exits cleanly, no lost output).
            # Default: 90% of the process timeout so output is flushed before SIGTERM.
            crawl_seconds = ctx.config.get("katana_crawl_duration", int(timeout * 0.9))

            cmd = [
                "katana",
                "-list", tmp_path,
                "-depth", str(depth),
                "-js-crawl",
                "-known-files", "all",
                "-crawl-scope", f".*\\.{ctx.domain}",
                "-silent",
                "-jsonl",
                "-concurrency", str(concurrency),
                "-parallelism", str(parallelism),
                "-rate-limit", str(rate_limit),
                "-timeout", "10",
                "-crawl-duration", f"{crawl_seconds}s",
            ]

            start = time.monotonic()
            stdout, stderr, retcode = await run_subprocess(cmd, timeout=timeout)
            elapsed = time.monotonic() - start

            if retcode == -9:
                status = OutputStatus.TIMEOUT
            elif retcode not in (0, 1):
                status = OutputStatus.ERROR
            else:
                status = OutputStatus.SUCCESS

            data: dict = {"count": 0}
            if stdout and status != OutputStatus.TIMEOUT:
                data = self.parse_output(stdout, ctx)

            await save_raw_output(
                ctx, cmd=cmd, stdout=stdout, stderr=stderr,
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

            if data.get("subdomains") or data.get("urls"):
                try:
                    await self._persist(ctx, result)
                except Exception as exc:
                    log.error("%s katana _persist failed: %r", ctx.session_id[:8], exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result

        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        subdomains = result.data.get("subdomains", [])
        urls       = result.data.get("urls", [])

        if not subdomains and not urls:
            return

        # Build rows: pair each URL with the subdomain derived from it
        # For subdomains without a matching URL, use empty string
        rows = []
        seen_urls: set[str] = set()

        for url in urls:
            if url in seen_urls:
                continue
            seen_urls.add(url)
            try:
                hostname = urlparse(url).hostname or ""
            except Exception:
                hostname = ""
            norm = normalize_subdomain(hostname, ctx.domain) or ""
            rows.append((
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                norm,
                url,
                "",   # source_url — katana JSONL may provide this; simplify for now
            ))

        await ctx.db.executemany(
            """
            INSERT INTO katana_results
                (id, step_run_id, session_id, target_id, subdomain, url, source_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, url) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info(
            "%s katana: persisted %d URLs / %d subdomains for %s",
            ctx.session_id[:8], len(rows), len(subdomains), ctx.domain,
        )
