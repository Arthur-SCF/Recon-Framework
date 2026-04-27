"""
Real S3ScannerTool — S3 bucket misconfiguration detection.

Two-phase:
  1. Collect bucket name candidates:
     - Extract bucket names from cloud_enum_results for this session (S3 URLs)
     - Generate common patterns from domain keyword
  2. Run s3scanner against collected candidates
  3. Persist findings, fire WS event + notification per public bucket

step_id: s3scanner
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.s3scanner")


def _bucket_name_from_url(url: str) -> str | None:
    """Extract S3 bucket name from a URL like https://bucket.s3.amazonaws.com"""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        # virtual-hosted style: bucket.s3.amazonaws.com or bucket.s3-region.amazonaws.com
        if ".s3" in host and "amazonaws.com" in host:
            return host.split(".s3")[0]
        # path style: s3.amazonaws.com/bucket
        return None
    except Exception:
        return None


class S3ScannerTool(BaseTool):
    label           = "S3Scanner"
    binary_name     = "s3scanner"
    parallelisable  = True
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["s3scanner", "--help"]

    def parse_version(self, output: str) -> str | None:
        import re
        m = re.search(r'v?([\d.]+)', output or "")
        return m.group(1) if m else "installed"

    def build_command(self, ctx: StepContext) -> list[str]:
        return []  # built dynamically in run()

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse s3scanner plain-text output.

        Format per line:
          bucket_name | status | AuthUsers: [PERM,...], AllUsers: [PERM,...]

        status values: bucket_exists, bucket_not_exist, invalid_name, ...
        Public read  = AllUsers contains READ or FULL_CONTROL
        Public write = AllUsers contains WRITE or FULL_CONTROL
        """
        import re
        findings = []
        for line in stdout.splitlines():
            line = line.strip()
            if not line or line.startswith("Warning"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 2:
                continue

            bucket_name   = parts[0]
            status        = parts[1] if len(parts) > 1 else ""
            bucket_exists = status == "bucket_exists"

            # Parse AllUsers permissions from the line
            all_users_match = re.search(r"AllUsers:\s*\[([^\]]*)\]", line)
            all_users_perms = all_users_match.group(1).upper() if all_users_match else ""

            public_read  = bool(re.search(r"\bREAD\b|\bFULL_CONTROL\b", all_users_perms))
            public_write = bool(re.search(r"\bWRITE\b|\bFULL_CONTROL\b", all_users_perms))

            findings.append({
                "bucket_name":   bucket_name,
                "region":        None,
                "bucket_exists": bucket_exists,
                "public_read":   public_read,
                "public_write":  public_write,
                "url":           f"https://{bucket_name}.s3.amazonaws.com" if bucket_exists else None,
            })
        return {"findings": findings, "count": len(findings)}

    async def run(self, ctx: StepContext) -> StepResult:
        keyword = ctx.domain.split(".")[0]

        # Collect bucket candidates
        candidate_names: set[str] = set()

        # 1. From cloud_enum_results for this session
        cloud_rows = await ctx.db.fetchall(
            "SELECT url FROM cloud_enum_results WHERE session_id = ? AND asset_type = 's3'",
            (ctx.session_id,),
        )
        for r in cloud_rows:
            name = _bucket_name_from_url(r["url"] or "")
            if name:
                candidate_names.add(name)

        # 2. Common keyword-derived patterns
        for suffix in ("", "-assets", "-backup", "-cdn", "-prod", "-dev", "-static",
                       "-images", "-media", "-data", "-logs", "-uploads"):
            candidate_names.add(f"{keyword}{suffix}")

        if not candidate_names:
            log.info("%s s3scanner: no bucket candidates — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        run_timeout = ctx.config.get("timeout", self.default_timeout)

        tmp_fd, tmp_list = tempfile.mkstemp(
            prefix="s3scanner_", suffix=".txt", dir="/tmp"
        )
        try:
            with os.fdopen(tmp_fd, "w") as f:
                f.write("\n".join(sorted(candidate_names)))

            cmd = [
                "s3scanner",
                "scan",
                "--buckets-file", tmp_list,
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

            data: dict = {"findings": [], "count": 0}
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

            if data.get("findings"):
                try:
                    await self._persist(ctx, data["findings"])
                except Exception as exc:
                    log.error("%s s3scanner _persist failed: %r", ctx.session_id[:8], exc)
                    result.status = OutputStatus.ERROR
                    result.data["persist_error"] = str(exc)

            return result

        finally:
            try:
                if os.path.exists(tmp_list) and tmp_list.startswith("/tmp/"):
                    os.unlink(tmp_list)
            except OSError:
                pass

    async def _persist(self, ctx: StepContext, findings: list[dict]) -> None:
        from engine.websocket import ws_manager

        rows = []
        public_buckets = []

        for f in findings:
            rows.append((
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                f["bucket_name"],
                f.get("region"),
                int(f["bucket_exists"]),
                int(f["public_read"]),
                int(f["public_write"]),
                f.get("url"),
            ))
            if f["bucket_exists"] and (f["public_read"] or f["public_write"]):
                public_buckets.append(f)

        await ctx.db.executemany(
            """
            INSERT INTO s3scanner_results
                (id, step_run_id, session_id, target_id,
                 bucket_name, region, bucket_exists, public_read, public_write, url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, bucket_name) DO NOTHING
            """,
            rows,
        )

        # Notifications for public buckets
        if public_buckets:
            notif_rows = []
            for f in public_buckets:
                perms = []
                if f["public_read"]:
                    perms.append("public-read")
                if f["public_write"]:
                    perms.append("public-write")
                notif_rows.append((
                    str(uuid.uuid4()),
                    ctx.target_id,
                    ctx.session_id,
                    "s3_bucket_exposed",
                    f"Exposed S3 bucket: {f['bucket_name']}",
                    f"{', '.join(perms)} — {f.get('url') or f['bucket_name']}",
                    json.dumps(f),
                ))

            await ctx.db.executemany(
                """
                INSERT INTO notifications
                    (id, target_id, session_id, type, title, message, data)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                notif_rows,
            )

        await ctx.db.commit()

        for f in public_buckets:
            try:
                await ws_manager.broadcast(
                    "s3_bucket_exposed",
                    {
                        "target_id":    ctx.target_id,
                        "session_id":   ctx.session_id,
                        "bucket_name":  f["bucket_name"],
                        "public_read":  f["public_read"],
                        "public_write": f["public_write"],
                    },
                    target_id=ctx.target_id,
                )
            except Exception as exc:
                log.warning("%s s3scanner WS broadcast failed: %r", ctx.session_id[:8], exc)

        log.info(
            "%s s3scanner: %d total, %d public buckets for %s",
            ctx.session_id[:8], len(findings), len(public_buckets), ctx.domain,
        )
