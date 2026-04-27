"""
Real AlterxTool — subdomain permutation generator.

Reads subdomains for this target from the subdomains table, writes to a temp
file, runs alterx, and persists permutations to alterx_results.

step_id: alterx
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

log = logging.getLogger("engine.tools.alterx")

_AGGRESSIVE_PATTERNS = "/app/wordlists/patterns/patterns-aggressive.yaml"


class AlterxTool(BaseTool):
    label           = "AlterX"
    binary_name     = "alterx"
    default_timeout = 1200   # 20 min — large targets can have 10k+ subdomains to permute

    def get_version_command(self) -> list[str]:
        return ["alterx", "-version"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?(\d+\.\d+\.\d+)', output or "")
        return m.group(1) if m else None

    def build_command(self, ctx: StepContext) -> list[str]:
        return []

    def _build_alterx_command(self, input_file: str, ctx: StepContext) -> list[str]:
        pattern_mode = ctx.config.get("pattern_config", "default")
        cmd = [
            "alterx",
            "-list", input_file,
            "-enrich",
            "-silent",
        ]
        if pattern_mode == "aggressive":
            import os as _os
            if _os.path.exists(_AGGRESSIVE_PATTERNS):
                cmd += ["-ac", _AGGRESSIVE_PATTERNS]
            else:
                log.warning("aggressive patterns file not found: %s", _AGGRESSIVE_PATTERNS)
        return cmd

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse one permutation per line."""
        permutations: list[str] = []
        seen: set[str] = set()

        for line in stdout.splitlines():
            normalized = normalize_subdomain(line, ctx.domain)
            if normalized and normalized not in seen:
                seen.add(normalized)
                permutations.append(normalized)

        return {"permutations": permutations, "count": len(permutations)}

    async def run(self, ctx: StepContext) -> StepResult:
        # Fetch all subdomains for this target
        rows = await ctx.db.fetchall(
            "SELECT subdomain FROM subdomains WHERE target_id = ?",
            (ctx.target_id,),
        )
        if not rows:
            log.info("%s alterx: no subdomains to permute — skipping", ctx.session_id[:8])
            return StepResult(
                status=OutputStatus.SKIPPED,
                result_count=0,
                data={"permutations": [], "count": 0},
            )

        subdomains = [r["subdomain"] for r in rows]

        tmp_fd, tmp_path = tempfile.mkstemp(prefix="alterx_input_", suffix=".txt", dir="/tmp")
        try:
            with os.fdopen(tmp_fd, "w") as fh:
                fh.write("\n".join(subdomains))

            cmd     = self._build_alterx_command(tmp_path, ctx)
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

            if result.data.get("permutations"):
                try:
                    await self._persist(ctx, result)
                except Exception as exc:
                    log.error("%s alterx _persist failed: %r", ctx.session_id[:8], exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    async def _persist(self, ctx: StepContext, result: StepResult) -> None:
        permutations = result.data.get("permutations", [])
        if not permutations:
            return

        rows = [
            (
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                perm,
            )
            for perm in permutations
        ]

        await ctx.db.executemany(
            """
            INSERT INTO alterx_results
                (id, step_run_id, session_id, target_id, subdomain)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, subdomain) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info("%s alterx: persisted %d permutations for %s",
                 ctx.session_id[:8], len(rows), ctx.domain)
