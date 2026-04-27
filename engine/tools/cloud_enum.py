"""
Real CloudEnumTool — cloud asset discovery via cloud_enum.

Discovers S3 buckets, Azure blobs, GCP storage assets associated with a
target domain's company keyword. Results persisted to cloud_enum_results.

cloud_enum outputs lines like:
  [+] Found: https://keyword.s3.amazonaws.com
  [+] Found: https://keyword.blob.core.windows.net
We extract URLs by splitting on whitespace and taking the last token.

step_id: cloud_enum
"""
from __future__ import annotations

import logging
import re
import time
import uuid

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.cloud_enum")

# Map URL hostname fragments → asset type
_ASSET_TYPE_MAP = [
    (r"\.s3[.-]", "s3"),
    (r"s3\.amazonaws\.com", "s3"),
    (r"\.blob\.core\.windows\.net", "azure"),
    (r"\.azurewebsites\.net", "azure"),
    (r"storage\.googleapis\.com", "gcp"),
    (r"\.appspot\.com", "gcp"),
]


def _infer_asset_type(url: str) -> str:
    lower = url.lower()
    for pattern, asset_type in _ASSET_TYPE_MAP:
        if re.search(pattern, lower):
            return asset_type
    return "generic"


_FINDING_PREFIXES = (
    "Registered ",
    "Unathorized ",   # cloud_enum typo — intentionally kept
    "Protected ",
    "Open ",
    "Found: ",
    "Found:: ",       # cloud_enum uses double-colon for AWS App findings
)

def _extract_urls(log_content: str) -> list[str]:
    """Extract URLs/hostnames from cloud_enum's log file.

    The log file (-l flag) has clean output (no ANSI codes, no progress lines).
    Finding lines start with one of the status prefixes; the URL/hostname is
    always the last whitespace-separated token.
    Skip the header line (#### CLOUD_ENUM ... ####).
    """
    urls = []
    for line in log_content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not any(line.startswith(p) for p in _FINDING_PREFIXES):
            # Also catch "X Found::" variants (e.g. "AWS App Found::")
            if "Found::" not in line:
                continue
        last = line.split()[-1]
        # Normalise bare hostnames to https:// so downstream _infer_asset_type works
        if not last.startswith("http"):
            last = "https://" + last
        urls.append(last)
    return urls


class CloudEnumTool(BaseTool):
    label           = "Cloud Enum"
    binary_name     = "cloud_enum"
    parallelisable  = True
    default_timeout = 1200  # ~300 mutations × 2 keywords × 3 providers ÷ 5 threads × ~3s/req ≈ 1080s worst case

    def get_version_command(self) -> list[str]:
        return ["cloud_enum", "--help"]

    def parse_version(self, output: str) -> str | None:
        m = re.search(r'v?([\d.]+)', output or "")
        return m.group(1) if m else "installed"

    def build_command(self, ctx: StepContext) -> list[str]:
        return []  # built dynamically in run()

    def parse_output(self, log_content: str, ctx: StepContext) -> dict:
        urls = _extract_urls(log_content)
        findings = []
        for url in urls:
            findings.append({
                "url":        url,
                "asset_type": _infer_asset_type(url),
                "keyword":    ctx.domain.split(".")[0],
            })
        return {"findings": findings, "count": len(findings)}

    @staticmethod
    def _find_mutations_file() -> str | None:
        """Locate cloud_enum's fuzz.txt in the installed package."""
        try:
            import enum_tools
            from pathlib import Path
            candidate = Path(enum_tools.__file__).parent / "fuzz.txt"
            if candidate.is_file():
                return str(candidate)
        except ImportError:
            pass
        return None

    async def run(self, ctx: StepContext) -> StepResult:
        keyword = ctx.domain.split(".")[0]  # e.g. "rocketleague" from "rocketleague.com"

        disable_azure = ctx.config.get("cloud_enum_disable_azure", False)
        disable_gcp   = ctx.config.get("cloud_enum_disable_gcp", False)
        disable_aws   = ctx.config.get("cloud_enum_disable_aws", False)
        quickscan     = ctx.config.get("cloud_enum_quickscan", True)
        run_timeout   = ctx.config.get("timeout", self.default_timeout)

        # cloud_enum requires a writable log file (-l). We use a file inside
        # ctx.data_dir rather than /dev/stdout, which fails in the Docker
        # container due to cap_drop: ALL restricting /dev access.
        ctx.data_dir.mkdir(parents=True, exist_ok=True)
        log_path = str(ctx.data_dir / "cloud_enum.log")

        threads = ctx.config.get("cloud_enum_threads", 20)

        cmd: list[str] = [
            "cloud_enum",
            "-k", keyword,
            "-k", ctx.domain,
            "-l", log_path,
            "-t", str(threads),
        ]

        # Point to the bundled fuzz.txt for both -m (mutations) and -b (brute)
        # Both default to the relative path enum_tools/fuzz.txt which fails unless
        # cloud_enum is run from its install directory.
        fuzz_path = self._find_mutations_file()
        if fuzz_path:
            cmd.extend(["-m", fuzz_path, "-b", fuzz_path])

        if quickscan:
            cmd.append("-qs")
        if disable_aws:
            cmd.append("--disable-aws")
        if disable_azure:
            cmd.append("--disable-azure")
        if disable_gcp:
            cmd.append("--disable-gcp")

        start = time.monotonic()
        stdout, stderr, retcode = await run_subprocess(cmd, timeout=run_timeout)
        elapsed = time.monotonic() - start

        if retcode == -9:
            status = OutputStatus.TIMEOUT
        elif retcode not in (0, 1):
            status = OutputStatus.ERROR
        else:
            status = OutputStatus.SUCCESS

        # Findings go to the log file (clean, no ANSI). Stdout has progress/banners only.
        log_content = ""
        try:
            with open(log_path) as f:
                log_content = f.read()
        except OSError:
            pass

        data: dict = {"findings": [], "count": 0}
        if log_content and status != OutputStatus.TIMEOUT:
            data = self.parse_output(log_content, ctx)

        await save_raw_output(
            ctx, cmd=cmd,
            stdout=stdout + ("\n\n--- log file ---\n" + log_content if log_content else ""),
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

        if data.get("findings"):
            try:
                await self._persist(ctx, data["findings"])
            except Exception as exc:
                log.error("%s cloud_enum _persist failed: %r", ctx.session_id[:8], exc)
                result.status = OutputStatus.ERROR
                result.data["persist_error"] = str(exc)

        return result

    async def _persist(self, ctx: StepContext, findings: list[dict]) -> None:
        rows = [
            (
                str(uuid.uuid4()),
                ctx.step_run_id,
                ctx.session_id,
                ctx.target_id,
                f["asset_type"],
                f["url"],
                f["keyword"],
            )
            for f in findings
        ]
        await ctx.db.executemany(
            """
            INSERT INTO cloud_enum_results
                (id, step_run_id, session_id, target_id, asset_type, url, keyword)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(step_run_id, url) DO NOTHING
            """,
            rows,
        )
        await ctx.db.commit()
        log.info(
            "%s cloud_enum: persisted %d assets for %s",
            ctx.session_id[:8], len(findings), ctx.domain,
        )
