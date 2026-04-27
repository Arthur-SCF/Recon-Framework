"""
ConsolidateAction — real implementation.

Runs at consolidate_r1, consolidate_r2, consolidate_r3 steps.
Collects results from all tool-specific tables for this session,
deduplicates and normalizes, applies scope rules, then upserts into
the unified `subdomains` table.

Round semantics:
  r1 — after passive enum + DNS brute (subfinder, amass, tlsx, assetfinder,
       crt_sh, gau, puredns_default)
  r2 — after permutation resolution (alterx → puredns_permutation)
  r3 — after JS crawling (katana, subdomainizer)
"""
from __future__ import annotations

import json
import logging
import uuid

from engine.pipeline.base import BaseAction, StepContext

log = logging.getLogger("engine.pipe.consolidate")
from engine.pipeline.dedup import normalize_subdomain, apply_scope_rules


# Maps step_id → (table_name, subdomain_column)
_TOOL_TABLES: dict[str, tuple[str, str]] = {
    "subfinder":           ("subfinder_results",    "subdomain"),
    "amass":               ("amass_results",        "subdomain"),
    "tlsx":                ("tlsx_results",         "subdomain"),
    "assetfinder":         ("assetfinder_results",  "subdomain"),
    "crt_sh":              ("ctl_results",          "subdomain"),
    "gau":                 ("gau_results",          "subdomain"),
    "puredns_default":     ("puredns_results",      "subdomain"),
    "alterx":              ("alterx_results",       "subdomain"),
    "puredns_permutation": ("puredns_results",      "subdomain"),
    "katana":              ("katana_results",       "subdomain"),
    "subdomainizer":       ("subdomainizer_results","subdomain"),
}

# Which tools feed each consolidation round
_ROUND_TOOLS: dict[str, list[str]] = {
    "consolidate_r1": [
        "subfinder", "amass", "tlsx", "assetfinder",
        "crt_sh", "gau", "puredns_default",
    ],
    "consolidate_r2": [
        # alterx produces raw permutation candidates — puredns_permutation resolves them.
        # Only the resolved subdomains (from puredns_results) enter the unified table.
        # Including alterx here would flood the table with 10k-100k unresolved entries.
        # puredns_custom resolves cewl-generated word candidates (also persisted to puredns_results).
        "puredns_permutation",
        "puredns_custom",
    ],
    "consolidate_r3": [
        "katana", "subdomainizer",
    ],
}


class ConsolidateAction(BaseAction):
    label = "Consolidate"

    async def execute(self, ctx: StepContext) -> dict:
        round_key = ctx.step_id   # e.g. "consolidate_r1"
        round_num = {"consolidate_r1": "r1",
                     "consolidate_r2": "r2",
                     "consolidate_r3": "r3"}.get(round_key, "r1")

        tool_ids = _ROUND_TOOLS.get(round_key, [])

        # ── Collect from tool tables ───────────────────────────────────────────
        raw_subdomains: dict[str, set[str]] = {}   # subdomain → set of source tool_ids

        for tool_id in tool_ids:
            table_info = _TOOL_TABLES.get(tool_id)
            if not table_info:
                continue
            table, col = table_info

            # Use step_run_id JOIN to scope results to this specific tool_id,
            # preventing shared tables (puredns_results) from leaking data
            # across consolidation rounds.
            rows = await ctx.db.fetchall(
                f"""
                SELECT t.{col}
                FROM {table} t
                JOIN step_runs sr ON sr.id = t.step_run_id
                WHERE t.session_id = ? AND t.target_id = ? AND sr.step_id = ?
                """,
                (ctx.session_id, ctx.target_id, tool_id),
            )
            for row in rows:
                raw = row[col]
                if raw:
                    raw_subdomains.setdefault(raw, set()).add(tool_id)

        if not raw_subdomains:
            log.debug("%s: no raw results to consolidate", round_key)
            return {"new_subdomains": 0, "total": 0, "count": 0}

        # ── Normalize ─────────────────────────────────────────────────────────
        normalized: dict[str, set[str]] = {}
        for raw, sources in raw_subdomains.items():
            norm = normalize_subdomain(raw, ctx.domain)
            if norm:
                normalized.setdefault(norm, set()).update(sources)

        # ── Apply scope rules ─────────────────────────────────────────────────
        scope_rows = await ctx.db.fetchall(
            "SELECT rule_type, pattern, priority FROM scope_rules WHERE target_id = ?",
            (ctx.target_id,),
        )
        scope_rules = [dict(r) for r in scope_rows]
        in_scope = apply_scope_rules(set(normalized.keys()), scope_rules, ctx.domain)

        # ── Upsert into unified subdomains table ──────────────────────────────
        new_count   = 0
        total_count = 0

        for sub in in_scope:
            sources = sorted(normalized.get(sub, set()))
            sources_json = json.dumps(sources)

            existing = await ctx.db.fetchone(
                "SELECT id, sources, consolidated_in FROM subdomains WHERE target_id = ? AND subdomain = ?",
                (ctx.target_id, sub),
            )

            if existing:
                # Merge sources and mark this round
                existing_sources = set(json.loads(existing["sources"] or "[]"))
                merged_sources   = json.dumps(sorted(existing_sources | set(sources)))

                existing_rounds  = set(json.loads(existing["consolidated_in"] or "[]"))
                existing_rounds.add(round_num)
                rounds_json = json.dumps(sorted(existing_rounds))

                await ctx.db.execute(
                    """
                    UPDATE subdomains
                    SET sources = ?, consolidated_in = ?, last_seen = datetime('now')
                    WHERE id = ?
                    """,
                    (merged_sources, rounds_json, existing["id"]),
                )
            else:
                # New subdomain
                await ctx.db.execute(
                    """
                    INSERT INTO subdomains
                        (id, target_id, subdomain, sources, consolidated_in,
                         first_session, is_live)
                    VALUES (?, ?, ?, ?, ?, ?, 0)
                    """,
                    (
                        str(uuid.uuid4()),
                        ctx.target_id,
                        sub,
                        sources_json,
                        json.dumps([round_num]),
                        ctx.session_id,
                    ),
                )
                new_count += 1

            total_count += 1

        await ctx.db.commit()

        log.info(
            "%s: %d new, %d total (from %d raw, %d normalized, %d in scope)",
            round_key, new_count, total_count,
            len(raw_subdomains), len(normalized), len(in_scope),
        )

        return {
            "new_subdomains": new_count,
            "total":          total_count,
            "raw":            len(raw_subdomains),
            "count":          total_count,   # total, not just new — so result_count is non-zero on re-scans
        }
