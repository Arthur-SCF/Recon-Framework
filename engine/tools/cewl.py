"""
Real CewlTool — custom wordlist generator from web content.

Selects the highest-scored live host URL for this target using the scoring
algorithm from BRAINSTORM §26, then runs CeWL against it to generate a
domain-specific wordlist. Results are persisted to cewl_results.

step_id: cewl
"""
from __future__ import annotations

import logging
import time
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.cewl")

# Scoring constants (BRAINSTORM §26)
_SCORE_STATUS_200  = 100
_SCORE_STATUS_3XX  =  50
_SCORE_STATUS_4XX  = -50
_SCORE_HTTPS       =  20
_SCORE_ROOT_WWW    =  50
_SCORE_LEN_1K      =  10
_SCORE_LEN_10K     =  20
_SCORE_LEN_50K     =  30
_SCORE_PARKED_TITLE = -30

_PARKED_KEYWORDS = frozenset([
    "parked", "default", "coming soon", "under construction",
    "placeholder", "page not found", "buy this domain",
])


def _score_host(host: dict, domain: str) -> int:
    score = 0
    sc = host.get("status_code") or 0

    if sc == 200:
        score += _SCORE_STATUS_200
    elif 300 <= sc < 400:
        score += _SCORE_STATUS_3XX
    elif sc >= 400:
        score += _SCORE_STATUS_4XX

    if (host.get("scheme") or "").lower() == "https":
        score += _SCORE_HTTPS

    h = (host.get("host") or "").lower()
    if h == domain or h == f"www.{domain}":
        score += _SCORE_ROOT_WWW

    cl = host.get("content_length") or 0
    if cl > 50_000:
        score += _SCORE_LEN_50K
    elif cl > 10_000:
        score += _SCORE_LEN_10K
    elif cl > 1_000:
        score += _SCORE_LEN_1K

    title = (host.get("title") or "").lower()
    if any(kw in title for kw in _PARKED_KEYWORDS):
        score += _SCORE_PARKED_TITLE

    return score


async def _select_url(ctx: StepContext) -> str | None:
    """Pick the highest-scored live host URL for CeWL to crawl."""
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
    log.debug("%s cewl: selected %s (score=%d)", ctx.session_id[:8], best_url, best_score)
    return best_url


class CewlTool(BaseTool):
    label           = "CeWL"
    binary_name     = "cewl"
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["cewl", "--version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'CeWL v?([\d.]+)', output or "", re.IGNORECASE)
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def _build_cewl_command(self, url: str, ctx: StepContext) -> list[str]:
        depth   = ctx.config.get("cewl_depth", 2)
        min_len = ctx.config.get("cewl_min_length", 5)
        return [
            "cewl", url,
            "-d", str(depth),
            "-m", str(min_len),
            "--lowercase",
        ]

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse one word per line; filter blank/CeWL comment lines."""
        words: list[str] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            word = line.strip()
            # CeWL outputs lines like "CeWL 5.x.x ..." at the top — skip them
            if not word or word.lower().startswith("cewl"):
                continue
            if word not in seen:
                seen.add(word)
                words.append(word)

        return {"words": words, "count": len(words)}

    async def run(self, ctx: StepContext) -> StepResult:
        url = await _select_url(ctx)
        if not url:
            log.info("%s cewl: no live hosts to crawl — skipping", ctx.session_id[:8])
            return StepResult(
                status=OutputStatus.SKIPPED,
                result_count=0,
                data={"words": [], "count": 0, "source_url": None},
            )

        cmd     = self._build_cewl_command(url, ctx)
        timeout = ctx.config.get("timeout", self.default_timeout)

        start                   = time.monotonic()
        stdout, stderr, retcode = await run_subprocess(cmd, timeout=timeout)
        elapsed                 = time.monotonic() - start

        if retcode == -9:
            status = OutputStatus.TIMEOUT
        elif retcode not in (0, 1):
            status = OutputStatus.ERROR
        else:
            status = OutputStatus.SUCCESS

        data: dict = {}
        if stdout and status != OutputStatus.TIMEOUT:
            data = self.parse_output(stdout, ctx)
            data["source_url"] = url

        await save_raw_output(ctx, cmd=cmd, stdout=stdout, stderr=stderr,
                              status=status, elapsed=elapsed, data=data)

        result = StepResult(
            status=status,
            result_count=data.get("count", 0),
            data=data,
            stdout=stdout,
            stderr=stderr,
            command=cmd,
            execution_time=elapsed,
        )

        if result.data.get("words"):
            try:
                await self._persist(ctx, result)
            except Exception as exc:
                log.error("%s cewl _persist failed: %r", ctx.session_id[:8], exc)
                result.status = OutputStatus.ERROR
                result.data["persist_error"] = str(exc)

        return result

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        words = result.data.get("words", [])
        if not words:
            return

        rows = [
            (
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                word,
            )
            for word in words
        ]

        await ctx.db.executemany(
            """
            INSERT INTO cewl_results
                (id, step_run_id, session_id, target_id, word)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, word) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("%s cewl: persisted %d words for %s (from %s)",
                 ctx.session_id[:8], len(rows), ctx.domain,
                 result.data.get("source_url", "?"))
