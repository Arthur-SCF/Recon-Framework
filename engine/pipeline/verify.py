"""
VerifyDedupAction — final pipeline step to detect and fix duplicate rows.

Checks subdomains and live_hosts for duplicates introduced by any tool,
keeps the row with the most data (longest sources JSON for subdomains,
earliest first_seen for live hosts), and deletes the rest.

Should normally report 0 duplicates if consolidation ran correctly.
Logs a WARNING if any duplicates are found.

step_id: verify_dedup
"""
from __future__ import annotations

import logging

from engine.pipeline.base import BaseAction, StepContext

log = logging.getLogger("engine.pipeline.verify")


class VerifyDedupAction(BaseAction):
    label = "Verify & Dedup"

    async def execute(self, ctx: StepContext) -> dict:
        sub_dupes_found, sub_dupes_fixed = await _dedup_subdomains(ctx)
        host_dupes_found, host_dupes_fixed = await _dedup_live_hosts(ctx)

        if sub_dupes_found or host_dupes_found:
            log.warning(
                "%s verify_dedup: found duplicates — subdomains: %d fixed, live_hosts: %d fixed",
                ctx.session_id[:8], sub_dupes_fixed, host_dupes_fixed,
            )
        else:
            log.info(
                "%s verify_dedup: no duplicates found for %s",
                ctx.session_id[:8], ctx.domain,
            )

        return {
            "subdomain_dupes_found": sub_dupes_found,
            "subdomain_dupes_fixed": sub_dupes_fixed,
            "host_dupes_found":      host_dupes_found,
            "host_dupes_fixed":      host_dupes_fixed,
            "count": 0,
        }


async def _dedup_subdomains(ctx: StepContext) -> tuple[int, int]:
    """
    Find duplicate subdomains for this target, keep the row with the longest
    `sources` JSON (most source data), delete the rest.
    Returns (dupes_found, dupes_fixed).
    """
    rows = await ctx.db.fetchall(
        """
        SELECT subdomain, COUNT(*) AS c
        FROM subdomains
        WHERE target_id = ?
        GROUP BY subdomain
        HAVING c > 1
        """,
        (ctx.target_id,),
    )

    if not rows:
        return 0, 0

    total_found = sum(int(r["c"]) - 1 for r in rows)
    total_fixed = 0

    for row in rows:
        sub = row["subdomain"]
        all_rows = await ctx.db.fetchall(
            "SELECT id, sources FROM subdomains WHERE target_id = ? AND subdomain = ?",
            (ctx.target_id, sub),
        )
        # Sort: keep the one with the longest sources JSON (most data)
        all_rows_sorted = sorted(
            all_rows,
            key=lambda r: len(r["sources"] or ""),
            reverse=True,
        )
        keep_id = all_rows_sorted[0]["id"]
        delete_ids = [r["id"] for r in all_rows_sorted[1:]]

        for did in delete_ids:
            await ctx.db.execute(
                "DELETE FROM subdomains WHERE id = ?", (did,)
            )
            total_fixed += 1

    if total_fixed:
        await ctx.db.commit()

    return total_found, total_fixed


async def _dedup_live_hosts(ctx: StepContext) -> tuple[int, int]:
    """
    Find duplicate live_hosts by URL for this target, keep the earliest
    (first_seen), delete the rest.
    Returns (dupes_found, dupes_fixed).
    """
    rows = await ctx.db.fetchall(
        """
        SELECT url, COUNT(*) AS c
        FROM live_hosts
        WHERE target_id = ?
        GROUP BY url
        HAVING c > 1
        """,
        (ctx.target_id,),
    )

    if not rows:
        return 0, 0

    total_found = sum(int(r["c"]) - 1 for r in rows)
    total_fixed = 0

    for row in rows:
        url = row["url"]
        all_rows = await ctx.db.fetchall(
            "SELECT id, first_seen FROM live_hosts WHERE target_id = ? AND url = ?",
            (ctx.target_id, url),
        )
        # Sort: keep earliest first_seen
        all_rows_sorted = sorted(all_rows, key=lambda r: r["first_seen"] or "")
        keep_id = all_rows_sorted[0]["id"]
        delete_ids = [r["id"] for r in all_rows_sorted[1:]]

        for did in delete_ids:
            await ctx.db.execute(
                "DELETE FROM live_hosts WHERE id = ?", (did,)
            )
            total_fixed += 1

    if total_fixed:
        await ctx.db.commit()

    return total_found, total_fixed
