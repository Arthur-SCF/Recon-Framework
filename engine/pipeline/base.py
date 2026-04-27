"""
Pipeline base classes.

Every tool/action in the registry extends one of these three:
  - BaseTool    — external CLI binary (subprocess, shell=False)
  - BaseAction  — internal Python logic (consolidation, diff, etc.)
  - BaseStep    — common interface used by the runner
"""
from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("engine.pipeline")


# ── Output status ──────────────────────────────────────────────────────────────

class OutputStatus:
    SUCCESS  = "success"
    ERROR    = "error"
    TIMEOUT  = "timeout"
    SKIPPED  = "skipped"


# ── Step context passed to every run() call ────────────────────────────────────

@dataclass
class StepContext:
    target_id:        str
    domain:           str
    session_id:       str
    step_id:          str       # e.g. 'subfinder', 'consolidate_r1'
    step_run_id:      str       # UUID for this specific execution
    config:           dict      # merged: global config + per-step overrides
    db:               Any       # Database instance
    data_dir:         Path      # /data/scans/<domain>/<session_id>/<step_id>/
    previous_results: dict[str, Any] = field(default_factory=dict)
    # populated by runner from previous group results
    subdomains:       list[str] = field(default_factory=list)
    live_hosts:       list[str] = field(default_factory=list)


# ── Step result ────────────────────────────────────────────────────────────────

@dataclass
class StepResult:
    status:         str                   # OutputStatus constant
    result_count:   int   = 0
    data:           dict  = field(default_factory=dict)
    # raw output for storage (populated by BaseTool)
    stdout:         str   = ""
    stderr:         str   = ""
    command:        list[str] = field(default_factory=list)
    execution_time: float = 0.0
    # Error tracking (set by runner after retry loop)
    error_category: str | None = None     # ErrorCategory value or None
    retry_count:    int        = 0        # number of retry attempts made


# ── Base interfaces ────────────────────────────────────────────────────────────

class BaseStep(ABC):
    """Common interface. Every step in STEP_REGISTRY is a BaseStep subclass."""

    #: Human-readable label shown in UI
    label: str = "Unnamed Step"

    #: Whether this step can run in parallel with siblings
    parallelisable: bool = True

    #: Default timeout in seconds (overridable via config)
    default_timeout: int = 600

    #: Whether this step can be skipped by the user
    skippable: bool = True

    @abstractmethod
    async def run(self, ctx: StepContext) -> StepResult:
        """Execute the step and return a StepResult."""
        ...


class BaseTool(BaseStep, ABC):
    """
    External CLI tool.
    Subclasses implement `build_command()` and optionally `parse_output()`.
    The runner calls run(), which handles subprocess + storage boilerplate.
    """

    @abstractmethod
    def build_command(self, ctx: StepContext) -> list[str]:
        """Return the command as a list of strings. Never use shell=True."""
        ...

    def parse_output(self, stdout: str, ctx: StepContext) -> dict:
        """Parse stdout into structured data. Default: count newlines."""
        lines = [l.strip() for l in stdout.splitlines() if l.strip()]
        return {"items": lines, "count": len(lines)}

    def _effective_timeout(self, ctx: StepContext) -> int:
        """
        Return the timeout to use for this step, in order of precedence:
        1. ctx.config["timeout"] (user override)
        2. param_schemas default_for(step_id, "timeout")
        3. self.default_timeout class attribute

        This makes param_schemas.py the single source of truth for defaults.
        """
        if "timeout" in ctx.config:
            return int(ctx.config["timeout"])
        try:
            from engine.tools.param_schemas import default_for
            schema_default = default_for(ctx.step_id, "timeout")
            if schema_default is not None:
                return int(schema_default)
        except ImportError:
            pass
        return self.default_timeout

    async def run(self, ctx: StepContext) -> StepResult:
        from engine.storage import save_raw_output, run_subprocess
        start = time.monotonic()
        cmd = self.build_command(ctx)
        timeout = self._effective_timeout(ctx)

        log.info("[%s] running: %s", ctx.step_id, " ".join(cmd))
        stdout, stderr, returncode = await run_subprocess(cmd, timeout=timeout)
        elapsed = time.monotonic() - start

        if returncode == -9:
            status = OutputStatus.TIMEOUT
        elif returncode not in (0, 1):   # many tools exit 1 on "no results"
            status = OutputStatus.ERROR
        else:
            status = OutputStatus.SUCCESS

        data = {}
        if stdout and status != OutputStatus.TIMEOUT:
            data = self.parse_output(stdout, ctx)

        # persist raw output files (full content saved to disk)
        await save_raw_output(ctx, cmd=cmd, stdout=stdout, stderr=stderr,
                              status=status, elapsed=elapsed, data=data)

        # Prometheus metrics
        try:
            from engine.metrics import step_duration, steps_total
            step_duration.labels(step_id=ctx.step_id).observe(elapsed)
            steps_total.labels(step_id=ctx.step_id, status=status).inc()
        except Exception:
            pass

        from engine.errors import classify_error, ErrorCategory

        # Classify error for non-success results
        error_category: str | None = None
        if status == OutputStatus.TIMEOUT:
            error_category = ErrorCategory.TIMEOUT.value
        elif status == OutputStatus.ERROR:
            error_category = classify_error(stderr=stderr, step_id=ctx.step_id).value

        # Truncate in-memory copies — full output is on disk already.
        # Only the runner's _finish_step_run reads stderr_snippet (2KB cap),
        # so keeping large strings in StepResult wastes memory across the session.
        _MAX_KEEP = 4096
        return StepResult(
            status=status,
            result_count=data.get("count", 0),
            data=data,
            stdout=stdout[:_MAX_KEEP] if len(stdout) > _MAX_KEEP else stdout,
            stderr=stderr[:_MAX_KEEP] if len(stderr) > _MAX_KEEP else stderr,
            command=cmd,
            execution_time=elapsed,
            error_category=error_category,
        )


class BaseAction(BaseStep, ABC):
    """
    Internal Python logic — no subprocess.
    Consolidation, diff, wildcard check, etc.
    """

    skippable: bool = False  # internal bookkeeping — always runs

    async def run(self, ctx: StepContext) -> StepResult:
        start = time.monotonic()
        try:
            data = await self.execute(ctx)
            elapsed = time.monotonic() - start
            try:
                from engine.metrics import step_duration, steps_total
                step_duration.labels(step_id=ctx.step_id).observe(elapsed)
                steps_total.labels(step_id=ctx.step_id, status="success").inc()
            except Exception:
                pass
            return StepResult(
                status=OutputStatus.SUCCESS,
                result_count=data.get("count", 0),
                data=data,
                execution_time=elapsed,
            )
        except Exception as exc:
            elapsed = time.monotonic() - start
            log.error("[%s] action failed: %s", ctx.step_id, exc, exc_info=True)
            from engine.errors import classify_error
            error_category = classify_error(stderr=str(exc), step_id=ctx.step_id).value
            try:
                from engine.metrics import step_duration, steps_total
                step_duration.labels(step_id=ctx.step_id).observe(elapsed)
                steps_total.labels(step_id=ctx.step_id, status="error").inc()
            except Exception:
                pass
            return StepResult(
                status=OutputStatus.ERROR,
                data={"error": str(exc)},
                stderr=str(exc),
                execution_time=elapsed,
                error_category=error_category,
            )

    @abstractmethod
    async def execute(self, ctx: StepContext) -> dict:
        """Perform the action and return a result dict with optional 'count' key."""
        ...
