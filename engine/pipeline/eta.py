"""
eta.py — Pipeline ETA estimation.

Produces a rough upper-bound estimate for a pipeline run without requiring
historical data.  Uses per-tool empirical formulas that mirror (or extend)
the dynamic timeout logic already present in the tool classes.

All estimates are intentionally pessimistic: a scan completing faster than
the estimate is fine; one hitting the estimate means it timed out.

Usage (from a FastAPI endpoint):
    from engine.pipeline.eta import estimate_pipeline
    result = await estimate_pipeline(target_id, db)
    # result.total_seconds, result.per_step, result.critical_path_seconds

Public surface
--------------
estimate_pipeline(target_id, db) → ETAResult
estimate_step(step_id, config, db, target_id) → int   (seconds)
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

log = logging.getLogger("engine.pipeline.eta")

# ---------------------------------------------------------------------------
# Base rates / constants — kept in sync with tool defaults
# ---------------------------------------------------------------------------

_HTTPX_THREADS_DEFAULT  = 50
_HTTPX_TIMEOUT_DEFAULT  = 10      # per-host seconds
_NAABU_RATE_DEFAULT     = 1000   # pkts/s
_NAABU_PORTS_1000       = 1000
_NAABU_PORTS_FULL       = 65535
_SUBFINDER_THREADS      = 10
_KATANA_CONCURRENCY     = 10
_KATANA_RATE            = 100    # req/s
_GOWITNESS_THREADS      = 4
_GOWITNESS_TIMEOUT      = 10     # per-page seconds
_NUCLEI_RATE            = 100    # req/s
_NUCLEI_CONCURRENCY     = 25
_ZGRAB2_SENDERS         = 100
_NMAP_TIMING            = 4      # T4

# Buffer multipliers
_TOOL_BUFFER = 1.3   # +30% for startup/teardown and slowdown at extremes


@dataclass
class StepETA:
    step_id:       str
    label:         str
    enabled:       bool
    seconds:       int
    is_critical:   bool = False   # on the critical (longest sequential) path


@dataclass
class ETAResult:
    total_seconds:         int
    critical_path_seconds: int
    per_step:              list[StepETA]
    per_group:             dict[str, int]   # group_id → seconds


# ---------------------------------------------------------------------------
# Per-step estimate functions
# ---------------------------------------------------------------------------

def _httpx_eta(n_hosts: int, config: dict) -> int:
    threads = config.get("threads", _HTTPX_THREADS_DEFAULT)
    timeout = config.get("timeout_per_host", _HTTPX_TIMEOUT_DEFAULT)
    # ceil(n / concurrency) * per-host-timeout + network overhead constant
    if n_hosts == 0:
        return 30  # startup cost even with no targets
    parallel_slots = max(1, threads)
    seconds = math.ceil(n_hosts / parallel_slots) * timeout + 30
    return int(seconds * _TOOL_BUFFER)


def _naabu_eta(n_hosts: int, config: dict) -> int:
    rate      = config.get("rate", _NAABU_RATE_DEFAULT)
    top_ports = str(config.get("top_ports", "1000"))
    port_count = _NAABU_PORTS_FULL if top_ports == "full" else int(top_ports or 1000)
    # SYN scan: total_probes / rate + retries overhead
    retries = config.get("naabu_retries", 2)
    total_probes = n_hosts * port_count * (1 + retries)
    seconds = math.ceil(total_probes / max(1, rate)) + 60
    return int(seconds * _TOOL_BUFFER)


def _subfinder_eta(config: dict) -> int:
    timeout_per = config.get("timeout_per_source", 30)
    threads     = config.get("threads", _SUBFINDER_THREADS)
    # ~40 sources, parallelised by threads; startup + API call time
    n_sources  = 40
    batches    = math.ceil(n_sources / max(1, threads))
    return int(batches * timeout_per * _TOOL_BUFFER) + 10


def _puredns_bruteforce_eta(word_count: int, config: dict) -> int:
    rate = config.get("puredns_rate_limit", 20)
    # Same formula as puredns.py _bruteforce_timeout with 1.4x buffer
    return max(600, int(word_count / max(1, rate) * 1.4))


def _puredns_permutation_eta(perm_count: int, config: dict) -> int:
    rate = config.get("puredns_resolve_rate_limit", 50)
    return max(3600, int(perm_count / max(1, rate) * 2.5))


def _alterx_eta(n_subs: int, config: dict) -> int:
    # Permutation generation is CPU-bound; ~1M perms/sec, min 10 s
    pattern = config.get("pattern_config", "default")
    multiplier = {"default": 4, "subdomains-only": 2, "dns": 4, "advanced": 10}.get(pattern, 4)
    perms = n_subs * multiplier * 1000  # rough perm count
    seconds = max(10, math.ceil(perms / 1_000_000)) + 5
    return int(seconds * _TOOL_BUFFER)


def _katana_eta(n_hosts: int, config: dict) -> int:
    depth       = config.get("katana_depth", 3)
    concurrency = config.get("katana_concurrency", _KATANA_CONCURRENCY)
    rate        = config.get("katana_rate_limit", _KATANA_RATE)
    # Rough: each host spawns ~depth levels of ~10 pages; capped by rate
    pages_per_host = sum(10 ** i for i in range(1, depth + 1))
    total_pages    = n_hosts * pages_per_host
    seconds = math.ceil(total_pages / max(1, min(concurrency * 5, rate))) + 30
    return int(seconds * _TOOL_BUFFER)


def _gowitness_eta(n_hosts: int, config: dict) -> int:
    threads = config.get("gowitness_threads", _GOWITNESS_THREADS)
    timeout = config.get("gowitness_timeout", _GOWITNESS_TIMEOUT)
    delay   = config.get("gowitness_delay", 1)
    per_page = timeout + delay + 2  # +2 Chrome launch overhead
    seconds  = math.ceil(n_hosts / max(1, threads)) * per_page + 30
    return int(seconds * _TOOL_BUFFER)


def _nuclei_eta(n_hosts: int, config: dict) -> int:
    rate        = config.get("nuclei_rate_limit", _NUCLEI_RATE)
    concurrency = config.get("nuclei_concurrency", _NUCLEI_CONCURRENCY)
    # Takeover templates: ~150 templates, each makes ~1 req per host
    n_templates = 150
    total_req   = n_hosts * n_templates
    seconds     = math.ceil(total_req / max(1, rate)) + 60
    return int(seconds * _TOOL_BUFFER)


def _zgrab2_eta(n_ports: int, config: dict) -> int:
    senders = config.get("zgrab2_senders", _ZGRAB2_SENDERS)
    seconds = math.ceil(n_ports / max(1, senders)) * 5 + 30
    return int(seconds * _TOOL_BUFFER)


def _nmap_eta(n_ports: int, config: dict) -> int:
    timing = int(config.get("nmap_timing", _NMAP_TIMING))
    # T4 on ~1000 ports: ~2-5 min. Scale by timing inverse (T2 = 3× slower)
    timing_scale = {0: 20, 1: 10, 2: 4, 3: 2, 4: 1, 5: 0.5}.get(timing, 1)
    seconds = int(n_ports / 100 * 60 * timing_scale) + 120
    return int(seconds * _TOOL_BUFFER)


def _generic_timeout_eta(step_id: str, config: dict) -> int:
    """Fallback: return the configured timeout or a sensible per-tool default."""
    defaults = {
        "amass":         600,    # amass runs for timeout_minutes
        "cewl":          300,
        "subdomainizer": 300,
        "tlsx":          300,
        "assetfinder":   180,
        "crt_sh":        120,
        "gau":           300,
        "s3scanner":     300,
        "wafw00f":       300,
        "cloud_enum":    300,
        "wildcard_check": 60,
    }
    if step_id == "amass":
        return config.get("timeout_minutes", 10) * 60
    return config.get("timeout", defaults.get(step_id, 300))


# ---------------------------------------------------------------------------
# Estimate a single step
# ---------------------------------------------------------------------------

async def estimate_step(
    step_id:    str,
    config:     dict,
    db,
    target_id:  str,
) -> int:
    """Return estimated seconds for one step given its current config."""

    # Fetch relevant counts from DB — best-effort; fall back to 0 on error
    async def _count(sql: str, params: tuple) -> int:
        try:
            row = await db.fetchone(sql, params)
            return int(row[0]) if row and row[0] else 0
        except Exception:
            return 0

    if step_id in ("httpx_r1", "httpx_r2", "httpx_r3", "httpx_ports"):
        n = await _count(
            "SELECT COUNT(*) FROM subdomains WHERE target_id=?", (target_id,)
        )
        return _httpx_eta(n, config)

    if step_id == "naabu":
        n = await _count(
            "SELECT COUNT(*) FROM subdomains WHERE target_id=?", (target_id,)
        )
        return _naabu_eta(n, config)

    if step_id == "subfinder":
        return _subfinder_eta(config)

    if step_id in ("puredns_default", "puredns_custom"):
        # Estimate wordlist size — use typical small list (~110K)
        word_count = 110_000
        return _puredns_bruteforce_eta(word_count, config)

    if step_id == "puredns_permutation":
        n = await _count(
            "SELECT COUNT(*) FROM subdomains WHERE target_id=?", (target_id,)
        )
        # alterx expands to ~4000 perms per subdomain on average
        perm_count = max(n * 4000, 50_000)
        return _puredns_permutation_eta(perm_count, config)

    if step_id == "alterx":
        n = await _count(
            "SELECT COUNT(*) FROM subdomains WHERE target_id=?", (target_id,)
        )
        return _alterx_eta(n, config)

    if step_id == "katana":
        n = await _count(
            "SELECT COUNT(*) FROM live_hosts WHERE target_id=?", (target_id,)
        )
        return _katana_eta(n, config)

    if step_id == "gowitness":
        n = await _count(
            "SELECT COUNT(*) FROM live_hosts WHERE target_id=?", (target_id,)
        )
        return _gowitness_eta(n, config)

    if step_id == "nuclei_takeover":
        n = await _count(
            "SELECT COUNT(*) FROM live_hosts WHERE target_id=?", (target_id,)
        )
        return _nuclei_eta(n, config)

    if step_id == "zgrab2_service":
        n = await _count(
            "SELECT COUNT(*) FROM naabu_results WHERE target_id=?", (target_id,)
        )
        return _zgrab2_eta(n, config)

    if step_id == "nmap_service":
        n = await _count(
            "SELECT COUNT(*) FROM naabu_results WHERE target_id=?", (target_id,)
        )
        return _nmap_eta(n, config)

    # Actions (consolidate, diff, verify_dedup) and other short steps
    if step_id in ("consolidate_r1", "consolidate_r2", "consolidate_r3",
                   "diff", "verify_dedup", "wildcard_check"):
        return 30

    return _generic_timeout_eta(step_id, config)


# ---------------------------------------------------------------------------
# Estimate the full pipeline
# ---------------------------------------------------------------------------

async def estimate_pipeline(target_id: str, db) -> ETAResult:
    """
    Estimate the total and critical-path duration for a target's pipeline.

    Reads the current pipeline_groups / pipeline_steps from the DB and
    computes group totals (respecting parallel/sequential flags).
    """
    groups = await db.fetchall(
        """
        SELECT g.id, g.name, g.enabled, g.parallel,
               s.id AS sid, s.step_id, s.enabled AS sen,
               s.config_overrides
        FROM pipeline_groups g
        LEFT JOIN pipeline_steps s ON s.group_id = g.id
        WHERE g.target_id = ?
        ORDER BY g.position, s.position
        """,
        (target_id,),
    )

    # Collate into group-ordered structure
    group_order:  list[str] = []
    group_names:  dict[str, str]          = {}
    group_flags:  dict[str, dict]         = {}
    group_steps:  dict[str, list[dict]]   = {}

    for row in groups:
        gid = row["id"]
        if gid not in group_steps:
            group_order.append(gid)
            group_names[gid] = row["name"]
            group_flags[gid] = {
                "enabled":  bool(row["enabled"]),
                "parallel": bool(row["parallel"]),
            }
            group_steps[gid] = []
        if row["sid"]:
            import json as _json
            overrides = {}
            if row["config_overrides"]:
                try:
                    overrides = _json.loads(row["config_overrides"])
                except Exception:
                    pass
            group_steps[gid].append({
                "step_id": row["step_id"],
                "enabled": bool(row["sen"]),
                "config":  overrides,
            })

    per_step:  list[StepETA] = []
    per_group: dict[str, int] = {}

    from engine.pipeline.registry import STEP_REGISTRY

    for gid in group_order:
        if not group_flags[gid]["enabled"]:
            per_group[gid] = 0
            continue

        step_seconds: list[int] = []
        for step in group_steps[gid]:
            if not step["enabled"]:
                per_step.append(StepETA(
                    step_id=step["step_id"],
                    label=getattr(STEP_REGISTRY.get(step["step_id"]), "label", step["step_id"]),
                    enabled=False,
                    seconds=0,
                ))
                continue
            secs = await estimate_step(step["step_id"], step["config"], db, target_id)
            per_step.append(StepETA(
                step_id=step["step_id"],
                label=getattr(STEP_REGISTRY.get(step["step_id"]), "label", step["step_id"]),
                enabled=True,
                seconds=secs,
            ))
            step_seconds.append(secs)

        if not step_seconds:
            per_group[gid] = 0
        elif group_flags[gid]["parallel"]:
            per_group[gid] = max(step_seconds)
        else:
            per_group[gid] = sum(step_seconds)

    total = sum(per_group.values())
    # Critical path = sum of group totals (groups are always sequential)
    critical = total

    return ETAResult(
        total_seconds=total,
        critical_path_seconds=critical,
        per_step=per_step,
        per_group=per_group,
    )
