"""
Tool health check system.

check_tool_health(tool)  — checks one tool: installed, version, path
check_all_tools()        — checks every tool in STEP_REGISTRY that is a BaseTool
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from engine.storage import run_subprocess


@dataclass
class ToolHealth:
    step_id:   str
    name:      str
    installed: bool
    version:   str | None = None
    path:      str | None = None
    error:     str | None = None
    checked_at: str = field(
        default_factory=lambda: datetime.now(tz=timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
    )


async def check_tool_health(step_id: str, tool_instance) -> ToolHealth:
    """Check if a tool binary is installed and return its version."""
    binary = getattr(tool_instance, "binary_name", None)
    name   = getattr(tool_instance, "label", step_id)

    if not binary:
        # BaseAction subclass — no binary to check
        return ToolHealth(step_id=step_id, name=name, installed=True,
                          version="(internal)", path=None)

    # Check binary exists in PATH
    stdout, _, rc = await run_subprocess(["which", binary], timeout=5)
    if rc != 0:
        return ToolHealth(step_id=step_id, name=name, installed=False,
                          error=f"'{binary}' not found in PATH")

    path = stdout.strip()

    # Get version
    version = None
    get_ver = getattr(tool_instance, "get_version_command", None)
    parse_ver = getattr(tool_instance, "parse_version", None)

    if get_ver and parse_ver:
        try:
            ver_cmd = get_ver()
            ver_out, ver_err, _ = await run_subprocess(ver_cmd, timeout=10)
            # Try stdout first, fall back to stderr (some tools print version to stderr)
            version = parse_ver(ver_out) or parse_ver(ver_err)
        except Exception:
            version = None

    return ToolHealth(step_id=step_id, name=name, installed=True,
                      version=version, path=path)


async def check_all_tools() -> list[ToolHealth]:
    """Run health checks for every step in STEP_REGISTRY."""
    from engine.pipeline.registry import STEP_REGISTRY
    from engine.pipeline.base import BaseTool

    results: list[ToolHealth] = []
    seen_classes: set = set()

    for step_id, cls in STEP_REGISTRY.items():
        # De-duplicate: consolidate_r1/r2/r3 all map to the same class
        if cls in seen_classes:
            # Still emit an entry but skip the health check
            results.append(ToolHealth(
                step_id=step_id,
                name=getattr(cls, "label", step_id),
                installed=True,
                version="(internal)",
            ))
            continue
        seen_classes.add(cls)

        instance = cls()
        health = await check_tool_health(step_id, instance)
        results.append(health)

    return results
