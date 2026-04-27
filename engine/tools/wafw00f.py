"""
Real Wafw00fTool — WAF identification for all live hosts.

Scans live host URLs with wafw00f to identify WAF products.
Results are stored in-place on live_hosts.waf (column already exists).

wafw00f -f json writes a JSON array to the output file:
  [
    {"url": "https://example.com", "detected": true,  "firewall": "Cloudflare", "manufacturer": "…"},
    {"url": "https://other.com",   "detected": false, "firewall": "None",       "manufacturer": null}
  ]

IMPORTANT: do NOT use "-o /dev/stdout".
wafw00f always writes its banner + "[*] Checking…" progress lines to stdout regardless of the
"-o" flag. Using -o /dev/stdout mixes the banner text into the JSON, breaking parsing.
Instead, write JSON to a temp file and read it back after the process exits.

"detected" is a boolean; the WAF product name is in "firewall" (not "detected").

step_id: wafw00f
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time

from engine.pipeline.base import BaseTool, StepContext, StepResult, OutputStatus
from engine.storage import run_subprocess, save_raw_output

log = logging.getLogger("engine.tools.wafw00f")

_NO_WAF_VALUES = {"None", "none", "No WAF detected", ""}


class Wafw00fTool(BaseTool):
    label           = "Wafw00f"
    binary_name     = "wafw00f"
    parallelisable  = True
    default_timeout = 300

    def get_version_command(self) -> list[str]:
        return ["wafw00f", "--version"]

    def parse_version(self, output: str) -> str | None:
        m = re.search(r'v?([\d.]+)', output or "")
        return m.group(1) if m else "installed"

    def build_command(self, ctx: StepContext) -> list[str]:
        return []  # built dynamically in run()

    def _parse_json_file(self, json_path: str) -> dict:
        """Read and parse the wafw00f JSON output file."""
        results: dict[str, str] = {}
        try:
            content = open(json_path, encoding="utf-8", errors="replace").read().strip()
        except OSError:
            log.warning("wafw00f: JSON output file missing: %s", json_path)
            return {"waf_map": results, "count": 0}

        if not content:
            return {"waf_map": results, "count": 0}

        try:
            items = json.loads(content)
        except json.JSONDecodeError as exc:
            log.warning("wafw00f: failed to parse JSON output: %s", exc)
            return {"waf_map": results, "count": 0}

        if not isinstance(items, list):
            if isinstance(items, dict):
                items = list(items.values())
            else:
                return {"waf_map": results, "count": 0}

        for obj in items:
            if not isinstance(obj, dict):
                continue
            url      = obj.get("url") or obj.get("URL", "")
            detected = obj.get("detected")      # boolean
            # WAF product name is in "firewall", not in "detected"
            waf_name = (obj.get("firewall") or obj.get("waf") or "").strip()
            if url and detected is True and waf_name and waf_name not in _NO_WAF_VALUES:
                results[url] = waf_name

        return {"waf_map": results, "count": len(results)}

    async def run(self, ctx: StepContext) -> StepResult:
        rows = await ctx.db.fetchall(
            "SELECT id, url FROM live_hosts WHERE target_id = ? ORDER BY first_seen",
            (ctx.target_id,),
        )
        if not rows:
            log.info("%s wafw00f: no live hosts — skipping", ctx.session_id[:8])
            return StepResult(status=OutputStatus.SKIPPED, data={"count": 0})

        run_timeout = ctx.config.get("timeout", self.default_timeout)

        # Two temp files: input URL list + JSON output.
        # Never use -o /dev/stdout: wafw00f banner + progress also go to stdout
        # and corrupt the JSON. Write to a real temp file and read it back.
        tmp_fd_list, tmp_list = tempfile.mkstemp(prefix="wafw00f_in_",  suffix=".txt",  dir="/tmp")
        tmp_fd_out,  tmp_out  = tempfile.mkstemp(prefix="wafw00f_out_", suffix=".json", dir="/tmp")
        os.close(tmp_fd_out)   # wafw00f will open and write it

        try:
            with os.fdopen(tmp_fd_list, "w") as f:
                f.write("\n".join(r["url"] for r in rows))

            cmd = [
                "wafw00f",
                "-i", tmp_list,
                "-o", tmp_out,
                "-f", "json",
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

            # Parse from the JSON file regardless of exit code.
            # wafw00f may exit 1 when some hosts fail, but still write valid JSON.
            data: dict = self._parse_json_file(tmp_out)

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

            waf_map: dict[str, str] = data.get("waf_map", {})
            if waf_map:
                try:
                    updates = [
                        (waf_name, ctx.target_id, url)
                        for url, waf_name in waf_map.items()
                    ]
                    await ctx.db.executemany(
                        "UPDATE live_hosts SET waf = ? WHERE target_id = ? AND url = ?",
                        updates,
                    )
                    await ctx.db.commit()
                    log.info(
                        "%s wafw00f: %d WAFs detected for %s",
                        ctx.session_id[:8], len(waf_map), ctx.domain,
                    )
                except Exception as exc:
                    log.error("%s wafw00f update failed: %r", ctx.session_id[:8], exc)
                    result.data["update_error"] = str(exc)

            return result

        finally:
            for path in (tmp_list, tmp_out):
                try:
                    if os.path.exists(path) and path.startswith("/tmp/"):
                        os.unlink(path)
                except OSError:
                    pass
