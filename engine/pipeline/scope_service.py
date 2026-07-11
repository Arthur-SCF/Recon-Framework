"""
Scope service — (re)apply a target's scope rules to already-stored data.

Scope rules used to only filter NEW subdomains at consolidation time; nothing
ever re-applied them to data already discovered, so an ``exclude`` rule added
after a scan had no effect. This module recomputes the non-destructive
``in_scope`` flag on existing ``subdomains`` and ``live_hosts`` whenever a
target's scope rules change, and seeds concrete (non-wildcard) ``include``
patterns as manual subdomains the automation never found.

Non-destructive: rows are NEVER deleted for scope — only their ``in_scope``
flag flips, so removing a rule restores visibility. Out-of-scope rows
(in_scope = 0) are hidden from every UI/report read, skipped by all probing
tools, and never generate notifications (see engine/pipeline/diff.py).
"""
from __future__ import annotations

import json
import logging
import uuid

from engine.db import Database
from engine.pipeline.dedup import is_in_scope, normalize_subdomain

log = logging.getLogger("engine.scope")

# Glob metacharacters — an include pattern containing any of these is a
# keep-in-scope override only; it cannot be materialised into a concrete host.
_GLOB_METACHARS = ("*", "?", "[")


async def reapply_scope(db: Database, target_id: str) -> dict:
    """
    Recompute ``in_scope`` for every ``subdomains`` and ``live_hosts`` row of a
    target, and seed concrete ``include`` patterns as manual subdomains.

    Idempotent and non-destructive. Only rows whose flag actually changes are
    written (batched), and seeding never clobbers a real discovery row.

    Returns a summary: ``{subdomains_updated, hosts_updated, seeded}``.
    """
    target = await db.fetchone(
        "SELECT domain FROM targets WHERE id = ?", (target_id,)
    )
    if not target:
        return {"subdomains_updated": 0, "hosts_updated": 0, "seeded": 0}
    base_domain: str = target["domain"]

    rule_rows = await db.fetchall(
        "SELECT rule_type, pattern, priority FROM scope_rules WHERE target_id = ?",
        (target_id,),
    )
    rules = [dict(r) for r in rule_rows]

    # ── Recompute subdomains.in_scope (only rows that changed) ────────────────
    sub_rows = await db.fetchall(
        "SELECT id, subdomain, in_scope FROM subdomains WHERE target_id = ?",
        (target_id,),
    )
    existing_subs = {r["subdomain"] for r in sub_rows}
    sub_updates: list[tuple] = [
        (1 if is_in_scope(r["subdomain"], rules) else 0, r["id"])
        for r in sub_rows
        if (1 if is_in_scope(r["subdomain"], rules) else 0) != r["in_scope"]
    ]

    # ── Recompute live_hosts.in_scope from the HOST string (not the FK, which
    #    is nullable for port-scan / IP hosts) ──────────────────────────────
    host_rows = await db.fetchall(
        "SELECT id, host, in_scope FROM live_hosts WHERE target_id = ?",
        (target_id,),
    )
    host_updates: list[tuple] = [
        (1 if is_in_scope(r["host"] or "", rules) else 0, r["id"])
        for r in host_rows
        if (1 if is_in_scope(r["host"] or "", rules) else 0) != r["in_scope"]
    ]

    # ── Seed concrete (non-wildcard) include patterns as manual subdomains ────
    seeds: list[tuple] = []
    for rule in rules:
        if rule.get("rule_type") != "include":
            continue
        pattern = (rule.get("pattern") or "").strip()
        if not pattern or any(c in pattern for c in _GLOB_METACHARS):
            continue  # wildcard include is a keep-override only — cannot seed
        norm = normalize_subdomain(pattern, base_domain)
        if not norm or norm in existing_subs:
            continue
        seeds.append((str(uuid.uuid4()), target_id, norm, json.dumps(["manual"])))
        existing_subs.add(norm)

    if not (sub_updates or host_updates or seeds):
        return {"subdomains_updated": 0, "hosts_updated": 0, "seeded": 0}

    async with db.transaction():
        if sub_updates:
            await db.executemany(
                "UPDATE subdomains SET in_scope = ? WHERE id = ?", sub_updates
            )
        if host_updates:
            await db.executemany(
                "UPDATE live_hosts SET in_scope = ? WHERE id = ?", host_updates
            )
        if seeds:
            # in_scope = 1: a seed comes from an include pattern, which always
            # resolves in-scope. ON CONFLICT guards against a concurrent insert.
            await db.executemany(
                """
                INSERT INTO subdomains
                    (id, target_id, subdomain, sources, is_live, in_scope)
                VALUES (?, ?, ?, ?, 0, 1)
                ON CONFLICT(target_id, subdomain) DO NOTHING
                """,
                seeds,
            )

    log.info(
        "reapply_scope %s: %d subs updated, %d hosts updated, %d seeded",
        target_id, len(sub_updates), len(host_updates), len(seeds),
    )
    return {
        "subdomains_updated": len(sub_updates),
        "hosts_updated": len(host_updates),
        "seeded": len(seeds),
    }


async def reapply_scope_all(db: Database) -> None:
    """
    One-time startup pass: reapply scope for every target that already has
    scope rules, so migration 017's ``DEFAULT 1`` doesn't leave previously
    excluded hosts visible until the next rule edit.
    """
    rows = await db.fetchall(
        "SELECT DISTINCT target_id FROM scope_rules"
    )
    for r in rows:
        try:
            await reapply_scope(db, r["target_id"])
        except Exception:
            log.exception("reapply_scope_all: failed for target %s", r["target_id"])
