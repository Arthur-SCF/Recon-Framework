"""
Real PureDnsTool — DNS brute-force and resolution.

Handles three step_ids via dispatch:
  puredns_default     — bruteforce with merged wordlist
  puredns_permutation — resolve alterx_results for this session
  puredns_custom      — resolve cewl_results for this session

All persist to puredns_results with run_type='default'|'permutation'|'custom'.

Output capture: puredns writes resolved subdomains to a temp file (-w /tmp/…).
We read the file after the process exits, including on timeout, so partial results
are never lost. Do NOT use -w /dev/stdout — partial writes through a PIPE are
discarded when the process is killed.

Rate limits (home WiFi defaults — raise via config_overrides for VPS/server):
  bruteforce  — default 20 qps (wildcard detection adds per-query overhead;
                massdns retries on no-response so real packet rate > configured)
  resolve     — default 50 qps (pure resolution, no wildcard overhead)
  At 50 qps, 93K permutations take ~1860s (~31 min), within the resolve timeout.

Wildcard batch:
  --wildcard-batch controls how many subdomains puredns groups per wildcard-
  detection pass. The default was 1 000 000, which caused one massive burst at
  startup that flooded home router NAT tables. We now default to 25 000, which
  spreads the wildcard checks into smaller bursts across the run.
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
import uuid
from pathlib import Path

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.pipeline.dedup import normalize_subdomain
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.puredns")

_RESOLVERS         = "/data/resolvers/resolvers.txt"
_TRUSTED_RESOLVERS = "/data/resolvers/resolvers-trusted.txt"

_RUN_TYPE_MAP = {
    "puredns_default":     "default",
    "puredns_permutation": "permutation",
    "puredns_custom":      "custom",
}


# Timeout for custom resolve mode (cewl-based — small input, bounded).
_RESOLVE_TIMEOUT = 1800

# Bruteforce timeout — dynamic, scaled to word count.
# Formula: ceil(words / qps) * 1.4 — 40% buffer over theoretical minimum.
# This gives ~51 min for small (~110K), ~93 min for medium (~200K), ~23 h for large (~3M).
_TIMEOUT_MULTIPLIER  = 1.4
_TIMEOUT_MINIMUM     = 600   # never less than 10 min for bruteforce

# Permutation timeout — uses a larger multiplier (2.5×) because resolution speed
# varies more with resolver health, network jitter, and wildcard detection overhead.
# Minimum 3600s (1 h) — permutation sets are always large.
_PERM_TIMEOUT_MULTIPLIER = 2.5
_PERM_TIMEOUT_MINIMUM    = 3600  # never less than 1 h for permutation

# Default rates — kept low for home WiFi/NAT. Override via config_overrides.
_DEFAULT_BRUTEFORCE_RATE = 20
_DEFAULT_RESOLVE_RATE    = 50


def _bruteforce_timeout(word_count: int, rate_limit: int) -> int:
    """Return a bruteforce timeout (seconds) scaled to word_count and rate_limit."""
    return max(_TIMEOUT_MINIMUM, int(word_count / rate_limit * _TIMEOUT_MULTIPLIER))


def _permutation_timeout(count: int, rate_limit: int) -> int:
    """Return a permutation-resolve timeout (seconds) scaled to count and rate_limit."""
    return max(_PERM_TIMEOUT_MINIMUM, int(count / rate_limit * _PERM_TIMEOUT_MULTIPLIER))


class PureDnsTool(BaseTool):
    label           = "PureDNS"
    binary_name     = "puredns"
    parallelisable  = False
    default_timeout = _RESOLVE_TIMEOUT

    def get_version_command(self) -> list[str]:
        return ["puredns", "--version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?(\d+\.\d+\.\d+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse one subdomain per line from puredns output file."""
        subdomains: list[str] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            normalized = normalize_subdomain(line, ctx.domain)
            if normalized and normalized not in seen:
                seen.add(normalized)
                subdomains.append(normalized)

        return {"subdomains": subdomains, "count": len(subdomains)}

    async def run(self, ctx: StepContext) -> StepResult:
        run_type  = _RUN_TYPE_MAP.get(ctx.step_id, "default")

        # Separate rate limits: bruteforce is slower due to wildcard detection;
        # pure resolve can run at a higher rate safely.
        if run_type == "default":
            rate_limit = ctx.config.get("puredns_rate_limit", 20)
        else:
            rate_limit = ctx.config.get("puredns_resolve_rate_limit", 50)

        # Smaller batch = smaller burst per wildcard-detection pass.
        # 25 000 distributes the load across the run instead of one huge burst at start.
        wc_batch = ctx.config.get("puredns_wildcard_batch", 25000)

        # Fail fast if resolvers file is missing — without it puredns does nothing
        if not os.path.exists(_RESOLVERS):
            log.error(
                "%s puredns (%s): resolvers file missing: %s — "
                "run POST /api/v1/wordlists/resolvers/update to download it",
                ctx.session_id[:8], run_type, _RESOLVERS,
            )
            return StepResult(
                status=OutputStatus.ERROR,
                data={"error": f"resolvers file not found: {_RESOLVERS}", "count": 0},
            )

        tmp_input  = None
        tmp_output = None
        wordlist   = None

        try:
            # Output file: puredns writes resolved subdomains here progressively.
            # Reading this file after the process exits (even on timeout) gives us
            # partial results instead of nothing.
            tmp_fd_out, tmp_output = tempfile.mkstemp(
                prefix=f"puredns_{run_type}_out_", suffix=".txt", dir="/tmp"
            )
            os.close(tmp_fd_out)   # puredns opens and writes it

            if run_type == "default":
                from engine.wordlists import prepare_puredns_wordlist
                wordlist, word_count = prepare_puredns_wordlist(ctx.config)
                if not os.path.exists(wordlist) or os.path.getsize(wordlist) == 0:
                    log.warning("%s puredns_default: wordlist empty — skipping", ctx.session_id[:8])
                    return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

                if word_count > 1_000_000:
                    estimated_s = _bruteforce_timeout(word_count, rate_limit)
                    log.warning(
                        "%s puredns_default: LARGE wordlist selected (%d words at %d qps) — "
                        "estimated runtime %dh %dm. Consider using 'small' or 'medium' wordlist.",
                        ctx.session_id[:8], word_count, rate_limit,
                        estimated_s // 3600, (estimated_s % 3600) // 60,
                    )

                cmd = self._build_bruteforce_cmd(wordlist, ctx.domain, rate_limit, wc_batch, tmp_output)

            elif run_type == "permutation":
                rows = await ctx.db.fetchall(
                    "SELECT DISTINCT subdomain FROM alterx_results WHERE session_id = ? AND target_id = ?",
                    (ctx.session_id, ctx.target_id),
                )
                if not rows:
                    log.info("%s puredns_permutation: no alterx results — skipping", ctx.session_id[:8])
                    return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

                log.info("%s puredns_permutation: resolving %d permutations at %d qps (~%ds)",
                         ctx.session_id[:8], len(rows), rate_limit,
                         max(1, len(rows) // rate_limit))

                tmp_fd, tmp_input = tempfile.mkstemp(prefix="puredns_perm_", suffix=".txt", dir="/tmp")
                with os.fdopen(tmp_fd, "w") as fh:
                    fh.write("\n".join(r["subdomain"] for r in rows))
                cmd = self._build_resolve_cmd(tmp_input, rate_limit, tmp_output)

            elif run_type == "custom":
                rows = await ctx.db.fetchall(
                    "SELECT DISTINCT word FROM cewl_results WHERE session_id = ? AND target_id = ?",
                    (ctx.session_id, ctx.target_id),
                )
                if not rows:
                    log.info("%s puredns_custom: no cewl results — skipping", ctx.session_id[:8])
                    return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

                candidates = [f"{r['word'].strip().lower()}.{ctx.domain}" for r in rows if r["word"].strip()]
                if not candidates:
                    return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

                tmp_fd, tmp_input = tempfile.mkstemp(prefix="puredns_cewl_", suffix=".txt", dir="/tmp")
                with os.fdopen(tmp_fd, "w") as fh:
                    fh.write("\n".join(candidates))
                cmd = self._build_resolve_cmd(tmp_input, rate_limit, tmp_output)
            else:
                log.error("unknown puredns step_id: %s", ctx.step_id)
                return StepResult(status=OutputStatus.ERROR, data={"count": 0})

            if run_type == "default":
                timeout = ctx.config.get(
                    "puredns_default_timeout",
                    _bruteforce_timeout(word_count, rate_limit),
                )
            elif run_type == "permutation":
                # Dynamic timeout: 2.5× buffer + 1 h minimum — permutation resolution
                # is slower and more variable than bruteforce due to resolver jitter.
                timeout = ctx.config.get(
                    "puredns_permutation_timeout",
                    _permutation_timeout(len(rows), rate_limit),
                )
            else:
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

            # Read from the output file regardless of status.
            # Even on timeout, puredns has been writing progressively — partial results count.
            file_content = ""
            try:
                file_content = Path(tmp_output).read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass

            data: dict = {}
            if file_content:
                data = self.parse_output(file_content, ctx)
                data["run_type"] = run_type
                if status == OutputStatus.TIMEOUT and data.get("count", 0) > 0:
                    log.info(
                        "%s puredns (%s): timed out but recovered %d partial results",
                        ctx.session_id[:8], run_type, data["count"],
                    )

            await save_raw_output(ctx, cmd=cmd, stdout=file_content, stderr=stderr,
                                  status=status, elapsed=elapsed, data=data)

            result = StepResult(
                status=status,
                result_count=data.get("count", 0),
                data=data,
                stdout=file_content[:4096] if len(file_content) > 4096 else file_content,
                stderr=stderr[:4096]       if len(stderr) > 4096       else stderr,
                command=cmd,
                execution_time=elapsed,
            )

            if result.data.get("subdomains"):
                try:
                    await self._persist(ctx, result, run_type)
                except Exception as exc:
                    log.error("%s puredns _persist failed: %r", ctx.session_id[:8], exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result

        finally:
            for path in (tmp_input, tmp_output, wordlist if run_type == "default" else None):
                if path and path.startswith("/tmp/"):
                    try:
                        os.unlink(path)
                    except OSError:
                        pass

    def _build_bruteforce_cmd(self, wordlist: str, domain: str,
                              rate_limit: int, wc_batch: int, output_file: str) -> list[str]:
        cmd = [
            "puredns", "bruteforce", wordlist, domain,
            "-r", _RESOLVERS,
            "--rate-limit", str(rate_limit),
            "--wildcard-batch", str(wc_batch),
            "-q",
            "-w", output_file,
        ]
        if os.path.exists(_TRUSTED_RESOLVERS):
            cmd += ["--resolvers-trusted", _TRUSTED_RESOLVERS]
        return cmd

    def _build_resolve_cmd(self, input_file: str, rate_limit: int, output_file: str) -> list[str]:
        cmd = [
            "puredns", "resolve", input_file,
            "-r", _RESOLVERS,
            "--rate-limit", str(rate_limit),
            "-q",
            "-w", output_file,
        ]
        if os.path.exists(_TRUSTED_RESOLVERS):
            cmd += ["--resolvers-trusted", _TRUSTED_RESOLVERS]
        return cmd

    async def _persist(self, ctx: StepContext, result: StepResult, run_type: str) -> None:
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
                run_type,
            )
            for sub in subdomains
        ]

        await ctx.db.executemany(
            """
            INSERT INTO puredns_results
                (id, step_run_id, session_id, target_id, subdomain, run_type)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("%s puredns (%s): persisted %d subdomains for %s",
                 ctx.session_id[:8], run_type, len(rows), ctx.domain)
