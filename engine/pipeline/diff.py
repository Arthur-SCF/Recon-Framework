"""
DiffAction — compares current session's live_hosts with the previous session.

Events emitted:
  discovered — host not seen in any prior session for this target
  changed    — host seen before but one or more tracked fields changed
  gone       — host seen in prior session, not found in current session
  returned   — host was previously 'gone', now back

Tracked change fields:
  status_code, title, webserver, tech, content_length, response_time, response_hash

All events are written to live_hosts_history.
Notifications are inserted for discovered/changed/gone/returned events.
A summary notification (scan_complete) is also inserted.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid

from engine.notifier import notify
from engine.pipeline.base import BaseAction, StepContext

log = logging.getLogger("engine.pipe.diff")

_TRACKED_FIELDS = (
    "status_code", "title", "webserver", "tech",
    "content_length", "response_time", "response_hash",
)


class DiffAction(BaseAction):
    label = "Diff Engine"

    async def execute(self, ctx: StepContext) -> dict:
        # ── Load current session's live hosts ─────────────────────────────────
        current_rows = await ctx.db.fetchall(
            "SELECT * FROM live_hosts WHERE target_id = ?",
            (ctx.target_id,),
        )
        current = {row["url"]: dict(row) for row in current_rows}

        # ── Find previous session ──────────────────────────────────────────────
        prev_session = await ctx.db.fetchone(
            """
            SELECT id FROM scan_sessions
            WHERE target_id = ? AND id != ? AND status = 'completed'
            ORDER BY finished_at DESC
            LIMIT 1
            """,
            (ctx.target_id, ctx.session_id),
        )

        if not prev_session:
            # First scan — all hosts are "discovered"
            discovered = list(current.values())
            changed = []
            gone = []
            returned = []
        else:
            prev_session_id = prev_session["id"]

            # Get live_hosts as they appeared at the end of the previous session
            # We use live_hosts_history to reconstruct the previous state
            prev_rows = await ctx.db.fetchall(
                """
                SELECT DISTINCT lh.url,
                    lhh.status_code, lhh.title, lhh.webserver, lhh.tech,
                    lhh.response_hash
                FROM live_hosts_history lhh
                JOIN live_hosts lh ON lh.id = lhh.live_host_id
                WHERE lhh.session_id = ? AND lhh.target_id = ?
                """,
                (prev_session_id, ctx.target_id),
            )
            prev_urls = {row["url"] for row in prev_rows}
            prev_state = {row["url"]: dict(row) for row in prev_rows}

            current_urls = set(current.keys())

            discovered = []
            changed = []
            gone_urls = prev_urls - current_urls
            gone = []

            for url, host in current.items():
                if url not in prev_urls:
                    discovered.append(host)
                else:
                    diffs = _compute_changes(prev_state[url], host)
                    if diffs:
                        changed.append((host, diffs))

            # Gone: was in previous session, not in current
            for url in gone_urls:
                lh_row = await ctx.db.fetchone(
                    "SELECT * FROM live_hosts WHERE target_id = ? AND url = ?",
                    (ctx.target_id, url),
                )
                if lh_row:
                    gone.append(dict(lh_row))

            # Returned: was previously marked 'gone', now present again
            # Check discovered hosts — if their last history event was 'gone', reclassify
            returned = []
            still_discovered = []
            for host in discovered:
                last_event = await ctx.db.fetchone(
                    """SELECT event_type FROM live_hosts_history
                       WHERE live_host_id = ?
                       ORDER BY recorded_at DESC LIMIT 1""",
                    (host["id"],),
                )
                if last_event and last_event["event_type"] == "gone":
                    returned.append(host)
                else:
                    still_discovered.append(host)
            discovered = still_discovered

        # ── Write history records ──────────────────────────────────────────────
        await self._record_history(ctx, discovered, "discovered")
        await self._record_history_changes(ctx, changed)
        await self._record_history(ctx, gone, "gone")
        await self._record_history(ctx, returned, "returned")

        # ── Send notifications ─────────────────────────────────────────────────
        stats = {
            "discovered": len(discovered),
            "changed":    len(changed),
            "gone":       len(gone),
            "returned":   len(returned),
        }
        await self._notify(ctx, stats, discovered, changed, gone, returned)

        count = len(discovered) + len(changed) + len(gone)
        log.info(
            "%s: +%d discovered, ~%d changed, -%d gone",
            ctx.domain, len(discovered), len(changed), len(gone),
        )
        return {**stats, "count": count}

    async def _record_history(
        self,
        ctx: StepContext,
        hosts: list[dict],
        event_type: str,
    ) -> None:
        if not hosts:
            return

        rows = []
        for host in hosts:
            rows.append((
                str(uuid.uuid4()),
                host["id"],
                ctx.target_id,
                ctx.session_id,
                host["url"],
                event_type,
                host.get("status_code"),
                host.get("title"),
                host.get("tech"),
                host.get("webserver"),
                host.get("response_hash"),
                None,  # changes — only for 'changed' events
            ))

        await ctx.db.executemany(
            """
            INSERT INTO live_hosts_history
                (id, live_host_id, target_id, session_id, url, event_type,
                 status_code, title, tech, webserver, response_hash, changes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        await ctx.db.commit()

    async def _record_history_changes(
        self,
        ctx: StepContext,
        changed: list[tuple[dict, dict]],
    ) -> None:
        if not changed:
            return

        rows = []
        for host, diffs in changed:
            rows.append((
                str(uuid.uuid4()),
                host["id"],
                ctx.target_id,
                ctx.session_id,
                host["url"],
                "changed",
                host.get("status_code"),
                host.get("title"),
                host.get("tech"),
                host.get("webserver"),
                host.get("response_hash"),
                json.dumps(diffs),
            ))

        await ctx.db.executemany(
            """
            INSERT INTO live_hosts_history
                (id, live_host_id, target_id, session_id, url, event_type,
                 status_code, title, tech, webserver, response_hash, changes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        await ctx.db.commit()

    async def _notify(
        self,
        ctx: StepContext,
        stats: dict,
        discovered: list[dict],
        changed: list[tuple[dict, dict]],
        gone: list[dict],
        returned: list[dict] | None = None,
    ) -> None:
        notifs = []

        if discovered:
            notifs.append((
                "new_hosts",
                f"{len(discovered)} new live host(s) on {ctx.domain}",
                f"Discovered: {', '.join(h['url'] for h in discovered[:5])}"
                + ("..." if len(discovered) > 5 else ""),
                {"hosts": [h["url"] for h in discovered[:20]]},
            ))

        if changed:
            notifs.append((
                "host_changed",
                f"{len(changed)} host(s) changed on {ctx.domain}",
                f"Changed: {', '.join(h['url'] for h, _ in changed[:5])}"
                + ("..." if len(changed) > 5 else ""),
                {"hosts": [h["url"] for h, _ in changed[:20]]},
            ))

        if gone:
            notifs.append((
                "host_gone",
                f"{len(gone)} host(s) went offline on {ctx.domain}",
                f"Gone: {', '.join(h['url'] for h in gone[:5])}"
                + ("..." if len(gone) > 5 else ""),
                {"hosts": [h["url"] for h in gone[:20]]},
            ))

        if returned:
            notifs.append((
                "host_returned",
                f"{len(returned)} host(s) came back on {ctx.domain}",
                f"Returned: {', '.join(h['url'] for h in returned[:5])}"
                + ("..." if len(returned) > 5 else ""),
                {"hosts": [h["url"] for h in returned[:20]]},
            ))

        # Summary notification
        notifs.append((
            "scan_complete",
            f"Scan complete — {ctx.domain}",
            (
                f"+{stats['discovered']} discovered, "
                f"~{stats['changed']} changed, "
                f"-{stats['gone']} gone"
            ),
            stats,
        ))

        try:
            for notif_type, title, message, data in notifs:
                await notify(
                    notification_type=notif_type,
                    title=title,
                    message=message,
                    data=data,
                    target_id=ctx.target_id,
                    session_id=ctx.session_id,
                )
        except Exception:
            log.exception("_notify: unexpected error dispatching notifications")

        # Auto-backup after each completed scan (fire-and-forget)
        try:
            from engine import backup as _backup
            from engine.config import get_settings as _get_settings
            asyncio.create_task(_backup.create_backup(_get_settings().db_path))
            _backup.enforce_retention(keep=3)
        except Exception:
            pass  # backup errors must never block scan completion


def _compute_changes(prev: dict, current: dict) -> dict:
    """Return a dict of changed fields: {field: {old: x, new: y}}."""
    diffs = {}
    for field in _TRACKED_FIELDS:
        old = prev.get(field)
        new = current.get(field)
        if old != new:
            diffs[field] = {"old": old, "new": new}
    return diffs
