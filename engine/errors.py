"""
Error classification for pipeline step failures.

ErrorCategory enum + classify_error() function.
classify_error() pattern-matches stderr to categorize failures so the
pipeline runner can make retry decisions and send targeted notifications.
"""
from __future__ import annotations

import re
from enum import Enum


class ErrorCategory(str, Enum):
    TRANSIENT = "transient"   # network timeout, rate limit — retryable
    CONFIG    = "config"      # missing binary, bad API key — not retryable
    RESOURCE  = "resource"    # disk full, OOM — not retryable
    TIMEOUT   = "timeout"     # SIGKILL after time limit — retryable
    UPSTREAM  = "upstream"    # dependency had no data — not retryable
    UNKNOWN   = "unknown"     # catch-all — retryable (benefit of the doubt)


# Patterns checked in priority order: resource → config → transient → unknown
# More specific patterns come first so they don't get masked by broad ones.
_RESOURCE_PATTERNS: list[re.Pattern] = [re.compile(p) for p in [
    r"no space left",
    r"out of memory",
    r"cannot allocate",
    r"too many open files",
    r"enomem",
    r"enospc",
    r"disk quota exceeded",
]]

_CONFIG_PATTERNS: list[re.Pattern] = [re.compile(p) for p in [
    r"command not found",
    r"no such file or directory",
    r"permission denied",
    r"eacces",
    r"invalid api",
    r"invalid.*key",
    r"unauthorized",
    r"403 Forbidden",
    r"\b401\b",
    r"missing.*config",
    r"executable file not found",
    r"not found",
]]

_TRANSIENT_PATTERNS: list[re.Pattern] = [re.compile(p) for p in [
    r"connection refused",
    r"timed?\s*out",
    r"rate.?limit",
    r"too many requests",
    r"\b429\b",
    r"servfail",
    r"temporary failure",
    r"503 Service",
    r"network is unreachable",
    r"no route to host",
    r"connection reset",
    r"broken pipe",
    r"EOF",
    r"i/o timeout",
]]

# Steps that require upstream data to be meaningful.
# Maps step_id → (table, session-scoped WHERE clause template).
# The runner checks COUNT(*) before running these steps.
UPSTREAM_DEPS: dict[str, tuple[str, str]] = {
    "nuclei_takeover": ("live_hosts", "target_id = ? AND last_seen IS NOT NULL"),
    "gowitness":       ("live_hosts", "target_id = ? AND last_seen IS NOT NULL"),
    "naabu_full":      ("live_hosts", "target_id = ? AND last_seen IS NOT NULL"),
    "zgrab2_service":  ("naabu_results", "target_id = ?"),
    "nmap_service":    ("naabu_results", "target_id = ?"),
    "katana":          ("live_hosts", "target_id = ? AND last_seen IS NOT NULL"),
    "subdomainizer":   ("live_hosts", "target_id = ? AND last_seen IS NOT NULL"),
}


def classify_error(stderr: str, step_id: str) -> ErrorCategory:
    """
    Classify a step failure from its stderr output.

    Returns ErrorCategory. TIMEOUT is NOT handled here — the runner detects
    timeout from BaseTool.run() returning TIMEOUT status (exit code -9) and
    sets error_category directly without calling this function.

    Check order: resource → config → transient → unknown.

    Args:
        stderr: Error text to classify.
        step_id: Step identifier. Reserved for future per-step pattern overrides;
                 currently unused.
    """
    text = (stderr or "").lower()

    for pattern in _RESOURCE_PATTERNS:
        if pattern.search(text):
            return ErrorCategory.RESOURCE

    for pattern in _CONFIG_PATTERNS:
        if pattern.search(text):
            return ErrorCategory.CONFIG

    for pattern in _TRANSIENT_PATTERNS:
        if pattern.search(text):
            return ErrorCategory.TRANSIENT

    return ErrorCategory.UNKNOWN
