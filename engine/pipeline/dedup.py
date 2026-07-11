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


def is_in_scope(host: str, scope_rules: list[dict]) -> bool:
    """
    Decide whether a single host (a subdomain or a live-host hostname) is in
    scope under a target's scope rules.

    Semantics (match the user-facing include/exclude model):
      • include match   → in scope. ``include`` is a keep-in-scope OVERRIDE and
                          always wins over ``exclude``, so ``priority`` is not
                          consulted (it is vestigial under this model).
      • exclude match   → out of scope.
      • no rule matches → in scope. There is NO whitelist mode: adding an
                          ``include`` rule does not drop everything it fails to
                          match — it only adds/keeps what it matches.
      • no rules at all → in scope.

    Patterns are shell globs (fnmatch), e.g. ``*.staging.example.com`` or
    ``admin.example.com``, matched against the normalized lowercase host.
    """
    import fnmatch

    if not scope_rules:
        return True

    matched_exclude = False
    for rule in scope_rules:
        pattern = rule.get("pattern")
        if not pattern:
            continue
        if fnmatch.fnmatch(host, pattern):
            if rule.get("rule_type") == "include":
                return True          # include always wins
            if rule.get("rule_type") == "exclude":
                matched_exclude = True
    return not matched_exclude


def apply_scope_rules(
    subdomains: set[str],
    scope_rules: list[dict],
    base_domain: str | None = None,
) -> set[str]:
    """
    Return the subset of ``subdomains`` that is in scope.

    Thin wrapper over :func:`is_in_scope`, retained for the scope-preview
    endpoint. ``base_domain`` is unused (kept for signature compatibility).
    """
    if not scope_rules:
        return subdomains
    return {sub for sub in subdomains if is_in_scope(sub, scope_rules)}
