"""
Normalization and deduplication utilities.

These are the canonical implementations referenced in BRAINSTORM.md section 32.
Every tool's parse_output() and the consolidation step run through here.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

# Valid hostname regex (lowercase only — normalize first)
_HOSTNAME_RE = re.compile(
    r'^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)*$'
)


def normalize_subdomain(raw: str, base_domain: str) -> str | None:
    """
    Normalize a raw subdomain string. Returns None if invalid or out of scope.

    Handles: FQDN trailing dots, wildcard prefixes, quoted strings, URLs
    embedded as subdomains, port suffixes, path/query suffixes.
    """
    sub = raw.strip().lower()

    if not sub:
        return None

    # Remove trailing dot (DNS FQDN format)
    sub = sub.rstrip(".")

    # Remove leading wildcard
    if sub.startswith("*."):
        sub = sub[2:]

    # Strip surrounding quotes
    sub = sub.strip('"').strip("'")

    # Extract hostname if a full URL was given
    if "://" in sub:
        parsed = urlparse(sub)
        sub = parsed.hostname or sub

    # Remove port if present
    if ":" in sub:
        sub = sub.split(":")[0]

    # Remove path / query suffix
    sub = sub.split("/")[0].split("?")[0].split("#")[0]

    sub = sub.strip()
    if not sub:
        return None

    # Must belong to the base domain (or be the base domain itself)
    if sub != base_domain and not sub.endswith(f".{base_domain}"):
        return None

    # Must be a valid hostname
    if not _HOSTNAME_RE.match(sub):
        return None

    return sub


def normalize_url(raw_url: str) -> str:
    """
    Normalize a URL for deduplication.

    - Lowercases scheme and host.
    - Removes default ports (80 for http, 443 for https).
    - Removes trailing slash on bare paths.
    - Preserves path, query, fragment as-is.
    """
    raw_url = raw_url.strip()
    if not raw_url:
        return raw_url

    try:
        p = urlparse(raw_url)
    except Exception:
        return raw_url

    scheme = p.scheme.lower()
    host   = (p.hostname or "").lower()
    port   = p.port

    # Drop default ports
    if (scheme == "http"  and port == 80) or \
       (scheme == "https" and port == 443):
        port = None

    netloc = host
    if port:
        netloc = f"{host}:{port}"

    path = p.path.rstrip("/") or ""
    query = f"?{p.query}" if p.query else ""

    return f"{scheme}://{netloc}{path}{query}"


def apply_scope_rules(
    subdomains: set[str],
    scope_rules: list[dict],
    base_domain: str,
) -> set[str]:
    """
    Filter a set of normalized subdomains through scope rules.

    Rules are evaluated in priority order (higher priority = evaluated first).
    First matching rule wins (include → keep, exclude → drop).
    If no rules exist, all subdomains pass.
    If only exclude rules exist, non-matching subdomains pass.
    If include rules exist, only matching subdomains pass (whitelist mode).
    """
    import fnmatch

    if not scope_rules:
        return subdomains

    sorted_rules = sorted(scope_rules, key=lambda r: -r.get("priority", 0))
    has_include = any(r["rule_type"] == "include" for r in sorted_rules)

    result: set[str] = set()
    for sub in subdomains:
        matched_rule = None
        for rule in sorted_rules:
            pattern = rule["pattern"]
            if fnmatch.fnmatch(sub, pattern):
                matched_rule = rule
                break

        if matched_rule is None:
            # No rule matched: pass if no include rules exist
            if not has_include:
                result.add(sub)
        elif matched_rule["rule_type"] == "include":
            result.add(sub)
        # exclude: drop silently

    return result
