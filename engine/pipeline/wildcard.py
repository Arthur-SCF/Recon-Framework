"""
WildcardCheckAction — detects DNS wildcard domains and applies policy.

Resolves 5 random nonsense subdomains; if all 5 resolve to ≤2 distinct IPs,
the domain has wildcard DNS.

Policy (from target.wildcard_policy):
  skip  (default) — set wildcard_skip=1 on the session, log + notify, return
  force           — log warning, continue (puredns has its own wildcard filter)
  ask             — set wildcard_skip=1, pause session with pause_type='wildcard'
"""
from __future__ import annotations

import asyncio
import logging
import random
import string
import uuid
from datetime import datetime, timezone

from engine.pipeline.base import BaseAction, StepContext, OutputStatus

log = logging.getLogger("engine.pipe.wildcard")

_NONSENSE_LEN = 12
_PROBE_COUNT  = 5
_WILDCARD_IP_THRESHOLD = 2   # ≤ this many distinct IPs → wildcard


def _random_label() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=_NONSENSE_LEN))


async def _resolve_in_thread(hostname: str) -> list[str]:
    """Return list of IPv4/IPv6 addresses for hostname, empty on failure/timeout."""
    import socket
    loop = asyncio.get_event_loop()
    try:
        infos = await asyncio.wait_for(
            loop.run_in_executor(
                None, lambda: socket.getaddrinfo(hostname, None)
            ),
            timeout=10,
        )
        return list({info[4][0] for info in infos})
    except (Exception, asyncio.TimeoutError):
        return []


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class WildcardCheckAction(BaseAction):
    label = "Wildcard Check"

    async def execute(self, ctx: StepContext) -> dict:
        # Probe random nonsense subdomains
        labels    = [_random_label() for _ in range(_PROBE_COUNT)]
        hostnames = [f"{lbl}.{ctx.domain}" for lbl in labels]

        tasks   = [_resolve_in_thread(h) for h in hostnames]
        results = await asyncio.gather(*tasks)

        resolved     = [r for r in results if r]
        all_ips: set = set()
        for ips in resolved:
            all_ips.update(ips)

        wildcard_detected = (
            len(resolved) == _PROBE_COUNT and len(all_ips) <= _WILDCARD_IP_THRESHOLD
        )

        if not wildcard_detected:
            log.info("%s wildcard check: no wildcard detected", ctx.session_id[:8])
            return {"wildcard_detected": False, "policy": "n/a", "count": 0}

        log.warning(
            "%s wildcard detected on %s (IPs: %s)",
            ctx.session_id[:8], ctx.domain, ", ".join(sorted(all_ips)),
        )

        # Fetch policy from target row
        row = await ctx.db.fetchone(
            "SELECT wildcard_policy FROM targets WHERE id = ?", (ctx.target_id,)
        )
        policy = row["wildcard_policy"] if row else "skip"

        if policy == "force":
            log.warning(
                "%s wildcard policy=force — continuing anyway (puredns will filter)",
                ctx.session_id[:8],
            )
            await self._notify(ctx, policy, all_ips)
            return {"wildcard_detected": True, "policy": "force", "count": 0}

        # skip or ask: set wildcard_skip=1
        await ctx.db.execute(
            "UPDATE scan_sessions SET wildcard_skip = 1 WHERE id = ?",
            (ctx.session_id,),
        )

        if policy == "ask":
            await ctx.db.execute(
                "UPDATE scan_sessions SET status='paused', pause_type='wildcard', paused_at=? WHERE id=?",
                (_now(), ctx.session_id),
            )

        await ctx.db.commit()
        await self._notify(ctx, policy, all_ips)

        if policy == "ask":
            from engine.websocket import ws_manager
            try:
                await ws_manager.broadcast(
                    "scan_paused",
                    {"reason": "wildcard", "domain": ctx.domain},
                    target_id=ctx.target_id,
                    session_id=ctx.session_id,
                )
            except Exception:
                pass

        log.info(
            "%s wildcard policy=%s — brute-force steps will be skipped",
            ctx.session_id[:8], policy,
        )
        return {"wildcard_detected": True, "policy": policy, "count": 1}

    async def _notify(self, ctx: StepContext, policy: str, ips: set) -> None:
        """Write a notification row for the wildcard detection event."""
        try:
            prow = await ctx.db.fetchone(
                "SELECT program_id FROM targets WHERE id = ?", (ctx.target_id,)
            )
            program_id = prow["program_id"] if prow else None
            await ctx.db.execute(
                """
                INSERT INTO notifications (id, target_id, program_id, type, title, message, created_at)
                VALUES (?, ?, ?, 'wildcard', 'Wildcard DNS detected', ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    ctx.target_id,
                    program_id,
                    f"Wildcard DNS on {ctx.domain} (policy={policy}). "
                    f"Resolving IPs: {', '.join(sorted(ips))}",
                    _now(),
                ),
            )
            await ctx.db.commit()
        except Exception as exc:
            log.debug("wildcard notification insert failed: %r", exc)
