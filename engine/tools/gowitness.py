"""
Real GoWitnessTool — screenshot capture for all live hosts.

Reads all live_hosts for this target, runs gowitness scan file, then maps
each URL to its expected filename and updates live_hosts.screenshot_path.

step_id: gowitness
File naming (gowitness v3): re.sub(r'[^a-zA-Z0-9.-]', '-', normalized_url) + ".jpeg"
where normalized_url adds explicit port if absent.

Verified: https://example.com → https---example.com-443.jpeg
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
import time
import uuid
from urllib.parse import urlparse

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.gowitness")

_SCREENSHOT_BASE = "/data/screenshots"


def _gowitness_filename(url: str) -> str:
    """
    Compute the filename gowitness v3 assigns to a screenshot of a given URL.

    Algorithm (verified against live container v3.1.1):
      1. Parse URL, add explicit port if absent (443=https, 80=http)
      2. Rebuild as scheme://host:port/path (strip trailing slash)
      3. Replace all non-[a-zA-Z0-9.-] chars with '-'
      4. Append '.jpeg'
    """
    parsed = urlparse(url)
    if not parsed.port:
        port = 443 if parsed.scheme == "https" else 80
        host_with_port = f"{parsed.netloc}:{port}"
    else:
        host_with_port = parsed.netloc

    path = parsed.path.rstrip("/")
    normalized = f"{parsed.scheme}://{host_with_port}{path}"
    return re.sub(r"[^a-zA-Z0-9.-]", "-", normalized) + ".jpeg"


class GoWitnessTool(BaseTool):
    label           = "GoWitness"
    binary_name     = "gowitness"
    parallelisable  = False
    default_timeout = 600   # 10 min — screenshots of many hosts can be slow

    def get_version_command(self) -> list[str]:
        return ["gowitness", "version"]

    def parse_version(self, output: str) -> str | None:
        m = re.search(r'v?([\d.]+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        return {"count": 0}

    async def run(self, ctx: StepContext) -> StepResult:
        rows = await ctx.db.fetchall(
            "SELECT id, url FROM live_hosts WHERE target_id = ? ORDER BY first_seen",
            (ctx.target_id,),
        )
        if not rows:
            log.info("%s gowitness: no live hosts — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        screenshot_dir = os.path.join(
            _SCREENSHOT_BASE, ctx.target_id, ctx.session_id
        )
        os.makedirs(screenshot_dir, exist_ok=True)

        tmp_fd, tmp_url_file = tempfile.mkstemp(
            prefix="gowitness_urls_", suffix=".txt", dir="/tmp"
        )
        try:
            host_rows = [{"id": r["id"], "url": r["url"]} for r in rows]
            with os.fdopen(tmp_fd, "w") as f:
                f.write("\n".join(h["url"] for h in host_rows))

            threads     = ctx.config.get("gowitness_threads", 4)
            delay       = ctx.config.get("gowitness_delay", 1)
            ss_timeout  = ctx.config.get("gowitness_timeout", 10)
            run_timeout = ctx.config.get("timeout", self.default_timeout)

            cmd = [
                "gowitness", "scan", "file",
                "-f", tmp_url_file,
                "--screenshot-path", screenshot_dir,
                "--timeout", str(ss_timeout),
                "--threads", str(threads),
                "--delay", str(delay),
            ]

            start = time.monotonic()
            stdout, stderr, retcode = await run_subprocess(cmd, timeout=run_timeout)
            elapsed = time.monotonic() - start

            if retcode == -9:
                status = OutputStatus.TIMEOUT
            elif retcode not in (0, 1):
                status = OutputStatus.ERROR
            else:
                status = OutputStatus.SUCCESS

            # Map each live host URL to its expected screenshot filename
            screenshots_taken = 0
            updates: list[tuple] = []
            relative_prefix = f"{ctx.target_id}/{ctx.session_id}"

            for host in host_rows:
                filename = _gowitness_filename(host["url"])
                full_path = os.path.join(screenshot_dir, filename)
                if os.path.isfile(full_path):
                    screenshots_taken += 1
                    rel_path = f"{relative_prefix}/{filename}"
                    updates.append((rel_path, host["id"]))

            if updates:
                await ctx.db.executemany(
                    "UPDATE live_hosts SET screenshot_path = ? WHERE id = ?",
                    updates,
                )
                await ctx.db.commit()
                log.info(
                    "%s gowitness: %d/%d screenshots taken for %s",
                    ctx.session_id[:8], screenshots_taken, len(host_rows), ctx.domain,
                )

            data = {"screenshots_taken": screenshots_taken, "count": screenshots_taken}

            await save_raw_output(
                ctx, cmd=cmd, stdout=stdout, stderr=stderr,
                status=status, elapsed=elapsed, data=data,
            )

            return StepResult(
                status=status,
                result_count=screenshots_taken,
                data=data,
                stdout=stdout,
                stderr=stderr,
                command=cmd,
                execution_time=elapsed,
            )

        finally:
            try:
                os.unlink(tmp_url_file)
            except OSError:
                pass
