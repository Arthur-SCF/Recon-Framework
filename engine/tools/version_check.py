"""
Check installed tool versions against latest GitHub releases.

Results are cached in the DB settings table as 'tools.version_cache' (JSON).
Cache TTL: 24 hours.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger("engine.tools.version_check")

# Map step_id → (github_owner, github_repo)
TOOL_REPOS: dict[str, tuple[str, str]] = {
    "subfinder":        ("projectdiscovery", "subfinder"),
    "amass":            ("owasp-amass",      "amass"),
    "httpx":            ("projectdiscovery", "httpx"),
    "nuclei":           ("projectdiscovery", "nuclei"),
    "naabu":            ("projectdiscovery", "naabu"),
    "katana":           ("projectdiscovery", "katana"),
    "dnsx":             ("projectdiscovery", "dnsx"),
    "alterx":           ("projectdiscovery", "alterx"),
    "gowitness":        ("sensepost",        "gowitness"),
    "puredns":          ("d3mondev",         "puredns"),
    "ffuf":             ("ffuf",             "ffuf"),
    "s3scanner":        ("sa7mon",           "S3Scanner"),
    "zgrab2":           ("zmap",             "zgrab2"),
    "tlsx":             ("projectdiscovery", "tlsx"),
    "gau":              ("lc",               "gau"),
    # cloud_enum and subdomainizer are Python tools — no GitHub Releases API
}


async def fetch_latest_version(owner: str, repo: str) -> str | None:
    """GET GitHub releases/latest → tag_name (e.g. 'v2.6.3')."""
    url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url, headers={"Accept": "application/vnd.github.v3+json"}
            )
            if resp.status_code == 200:
                return resp.json().get("tag_name")
    except Exception as exc:
        log.debug("GitHub version check failed for %s/%s: %s", owner, repo, exc)
    return None


async def run_version_checks(db) -> dict[str, str | None]:
    """
    Fetch all latest versions concurrently (max 5 at a time to respect rate limits).
    Saves result to DB settings table with key 'tools.version_cache'.
    Returns dict of {step_id: latest_version_tag}.
    """
    sem = asyncio.Semaphore(5)

    async def _fetch(step_id: str, owner: str, repo: str) -> tuple[str, str | None]:
        async with sem:
            return step_id, await fetch_latest_version(owner, repo)

    tasks = [_fetch(sid, o, r) for sid, (o, r) in TOOL_REPOS.items()]
    results = dict(await asyncio.gather(*tasks))

    cache_json = json.dumps(
        {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "versions": results,
        }
    )
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        ("tools.version_cache", cache_json, now),
    )
    await db.commit()
    log.info("Tool version cache updated (%d tools checked)", len(results))
    return results


async def get_cached_versions(db) -> dict[str, str | None] | None:
    """
    Return cached versions if checked within 24 hours, else None.
    """
    try:
        row = await db.fetchone(
            "SELECT value FROM settings WHERE key = 'tools.version_cache'", ()
        )
    except Exception:
        return None
    if not row:
        return None
    try:
        data = json.loads(row["value"])
        checked_at = datetime.fromisoformat(data["checked_at"])
        age = (datetime.now(timezone.utc) - checked_at).total_seconds()
        if age > 86400:  # 24 hours
            return None
        return data["versions"]
    except Exception:
        return None


def _version_lt(current: str, latest: str) -> bool:
    """
    Return True if current < latest (simplified semver comparison).
    Strips leading 'v', splits on '.', compares as integers where possible.
    Returns False on any parse error to avoid false positive UPDATE badges.
    """
    try:
        def _parse(v: str) -> tuple[int, ...]:
            v = v.lstrip("v").split("-")[0]  # strip pre-release suffix
            return tuple(int(x) for x in v.split(".") if x.isdigit())

        c = _parse(current)
        l = _parse(latest)
        if not c or not l:
            return False
        return c < l
    except Exception:
        return False
