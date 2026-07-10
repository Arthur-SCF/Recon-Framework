"""
Notification dispatcher.

Every notification goes to:
  1. The notifications table in SQLite (persistent in-app feed)
  2. WebSocket broadcast (real-time push to connected browsers)
  3. Telegram (if enabled and the event type is subscribed)

Call notify() from anywhere — it is fire-and-forget friendly (returns None,
logs errors instead of raising).
"""
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx

log = logging.getLogger("engine.notifier")

# Telegram API base — never log tokens
_TELEGRAM_BASE = "https://api.telegram.org/bot{token}/sendMessage"


_NOISY_TYPES = frozenset(
    {"new_hosts", "host_changed", "host_gone", "host_returned", "scan_complete"}
)


async def notify(
    *,
    notification_type: str,
    title: str,
    message: str | None = None,
    data: dict | None = None,
    target_id: str | None = None,
    program_id: str | None = None,
    session_id: str | None = None,
) -> str | None:
    """
    Create and dispatch a notification. Returns the new notification ID, or None on error.

    notification_type must be one of:
      new_subdomains | new_hosts | host_changed | host_gone | host_returned |
      takeover_candidate | scan_complete | scan_error | system | step_error

    program_id is auto-resolved from target_id when omitted. Under a program's
    'program' notify_scope, noisy per-asset events are persisted and pushed to
    the in-app feed but held back from Telegram/webhooks — the program-scan
    rollup delivers a single external summary instead.
    """
    from engine.db import get_db
    from engine.websocket import ws_manager

    notif_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    try:
        db = await get_db()
    except Exception:
        log.exception("notify: database unavailable")
        return None

    if program_id is None and target_id:
        try:
            prow = await db.fetchone(
                "SELECT program_id FROM targets WHERE id = ?", (target_id,)
            )
            if prow:
                program_id = prow["program_id"]
        except Exception:
            log.debug("notify: could not resolve program for target %s", target_id)

    # 1. Persist to database
    try:
        await db.execute(
            """
            INSERT INTO notifications
                (id, target_id, program_id, session_id, type, title, message, data, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                notif_id,
                target_id,
                program_id,
                session_id,
                notification_type,
                title,
                message,
                json.dumps(data) if data else None,
                now,
            ),
        )
        await db.commit()
    except Exception:
        log.exception("Failed to persist notification")
        return None

    # 2. WebSocket broadcast — the in-app feed is never suppressed
    try:
        await ws_manager.broadcast(
            event_type="notification",
            data={
                "id": notif_id,
                "type": notification_type,
                "title": title,
                "message": message,
                "data": data,
                "program_id": program_id,
            },
            target_id=target_id,
            session_id=session_id,
        )
    except Exception:
        log.exception("Failed to broadcast notification over WebSocket")
        # Non-fatal — DB write succeeded

    # 3. External dispatch (Telegram + webhooks) unless suppressed by program scope
    if not await _suppress_external(db, notification_type, program_id, data):
        try:
            await _maybe_send_telegram(notification_type, title, message, data)
        except Exception:
            log.exception("Telegram notification failed")
        try:
            from engine.api.webhooks import dispatch_webhooks, VALID_EVENTS
            if notification_type in VALID_EVENTS:
                import asyncio as _asyncio
                _asyncio.create_task(
                    dispatch_webhooks(db, notification_type, title, message or "", data)
                )
        except Exception:
            log.exception("Webhook dispatch failed")

    return notif_id


async def _suppress_external(
    db, notification_type: str, program_id: str | None, data: dict | None
) -> bool:
    """
    True when a per-asset event should skip Telegram/webhooks because its
    program uses 'program' notify_scope. The program-scan rollup (which carries
    data['program']) is never suppressed.
    """
    if not program_id or notification_type not in _NOISY_TYPES:
        return False
    if (data or {}).get("program"):
        return False
    try:
        row = await db.fetchone(
            "SELECT notify_scope FROM programs WHERE id = ?", (program_id,)
        )
    except Exception:
        return False
    return bool(row) and row["notify_scope"] == "program"


def _h(s: str) -> str:
    """HTML-escape a string for Telegram HTML parse_mode."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _build_telegram_text(
    notification_type: str,
    title: str,
    message: str | None,
    data: dict | None,
) -> str:
    """Build a richly formatted HTML message for each notification type."""
    d = data or {}

    if notification_type == "scan_complete" and d.get("program"):
        program    = _h(str(d.get("program", "")))
        assets     = d.get("assets", 0)
        discovered = d.get("discovered", 0)
        changed    = d.get("changed", 0)
        gone       = d.get("gone", 0)
        return (
            f"✅ <b>Program scan complete</b> — <code>{program}</code>\n"
            f"\n"
            f"📦 <b>{assets}</b> asset(s)  ·  "
            f"🆕 <b>{discovered}</b> discovered  ·  "
            f"🔄 <b>{changed}</b> changed  ·  "
            f"💀 <b>{gone}</b> gone"
        )

    if notification_type == "scan_complete":
        discovered = d.get("discovered", 0)
        changed    = d.get("changed", 0)
        gone       = d.get("gone", 0)
        domain     = d.get("domain") or (title.split(" — ", 1)[-1] if " — " in title else title)
        return (
            f"✅ <b>Scan complete</b> — <code>{_h(domain)}</code>\n"
            f"\n"
            f"🆕 <b>{discovered}</b> discovered  ·  "
            f"🔄 <b>{changed}</b> changed  ·  "
            f"💀 <b>{gone}</b> gone"
        )

    if notification_type in ("new_hosts", "host_changed", "host_gone", "host_returned"):
        hosts  = d.get("hosts", [])
        count  = len(hosts)
        plural = "s" if count != 1 else ""
        domain = title.split(" on ", 1)[-1] if " on " in title else ""
        _icons = {
            "new_hosts":     ("🆕", f"{count} new host{plural}"),
            "host_changed":  ("🔄", f"{count} host{plural} changed"),
            "host_gone":     ("💀", f"{count} host{plural} offline"),
            "host_returned": ("♻️", f"{count} host{plural} returned"),
        }
        icon, label = _icons[notification_type]
        header = f"{icon} <b>{label}</b>"
        if domain:
            header += f" — <code>{_h(domain)}</code>"
        lines = [header, ""]
        for url in hosts[:5]:
            lines.append(f"• <code>{_h(url)}</code>")
        if len(hosts) > 5:
            lines.append(f"<i>…and {len(hosts) - 5} more</i>")
        return "\n".join(lines)

    if notification_type == "takeover_candidate":
        subdomain = _h(d.get("subdomain", title))
        service   = _h(d.get("service", ""))
        severity  = d.get("severity", "").upper()
        url       = _h(d.get("url", ""))
        sev_emoji = {
            "CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡",
            "LOW": "🟢", "INFO": "🔵",
        }.get(severity, "⚪")
        lines = [f"🎯 <b>Takeover candidate</b>", "", f"<code>{subdomain}</code>"]
        if url:
            lines.append(f"🔗 {url}")
        if service:
            lines.append(f"{sev_emoji} <b>{severity}</b> — {service}")
        return "\n".join(lines)

    if notification_type == "step_error":
        step_id   = _h(d.get("step_id", ""))
        category  = d.get("error_category", "")
        domain    = _h(title.split(" — ", 1)[0]) if " — " in title else ""
        if category == "upstream":
            return (
                f"⏭️ <b>Step skipped</b> — <code>{domain}</code>\n"
                f"\n"
                f"<code>{step_id}</code>\n"
                f"No upstream data — dependency produced no results."
            )
        retry_count = d.get("retry_count", 0)
        max_retries = d.get("max_retries", 2)
        lines = [
            f"⚠️ <b>Step failed</b> — <code>{domain}</code>",
            "",
            f"<code>{step_id}</code>",
            f"📋 Category: <b>{_h(category)}</b>",
            f"🔁 Attempts: <b>{retry_count + 1}</b>",
        ]
        if message:
            for line in message.splitlines():
                if line.startswith("Error:"):
                    err = _h(line[6:].strip()[:200])
                    lines.append(f"💬 <code>{err}</code>")
                    break
        if d.get("pause_on_failure"):
            lines += ["", "⏸️ <i>Scan paused — use the buttons to act.</i>"]
        return "\n".join(lines)

    if notification_type == "scan_error":
        domain = _h(d.get("domain", title))
        return (
            f"🚨 <b>Scan error</b> — <code>{domain}</code>\n"
            f"\n"
            f"<i>Pipeline encountered an unexpected error.</i>"
        )

    # Fallback for unknown types
    lines = [f"<b>{_h(title)}</b>"]
    if message:
        lines.append(_h(message))
    return "\n".join(lines)


async def _maybe_send_telegram(
    notification_type: str,
    title: str,
    message: str | None,
    data: dict | None = None,
) -> None:
    """Send a Telegram message if configured and subscribed for this event type."""
    from engine.db import get_db
    from engine.crypto import decrypt, CryptoError

    db = await get_db()

    rows = await db.fetchall(
        "SELECT key, value FROM settings WHERE key LIKE 'telegram.%'"
    )
    cfg: dict[str, str | None] = {row[0]: row[1] for row in rows}

    if cfg.get("telegram.enabled") != "true":
        return

    token_encrypted = cfg.get("telegram.bot_token")
    chat_id = cfg.get("telegram.chat_id")
    if not token_encrypted or not chat_id:
        return

    # Check subscription for this event type
    event_key_map = {
        "new_hosts":          "telegram.notify_new_hosts",
        "host_changed":       "telegram.notify_host_changes",
        "host_gone":          "telegram.notify_host_gone",
        "host_returned":      "telegram.notify_host_returned",
        "new_subdomains":     "telegram.notify_new_subdomains",
        "takeover_candidate": "telegram.notify_takeover",
        "scan_complete":      "telegram.notify_scan_complete",
        "scan_error":         "telegram.notify_errors",
        "system":             "telegram.notify_system",
        "step_error":         "telegram.notify_step_errors",
    }
    sub_key = event_key_map.get(notification_type)
    if sub_key and cfg.get(sub_key) != "true":
        return

    try:
        token = decrypt(token_encrypted)
    except CryptoError:
        log.warning("Cannot send Telegram — failed to decrypt bot token")
        return

    text = _build_telegram_text(notification_type, title, message, data)

    # Build inline keyboard for actionable notifications
    reply_markup: dict | None = None
    if data:
        session_id = data.get("session_id") or ""
        step_id    = data.get("step_id") or ""
        sid        = session_id[:8] if session_id else ""

        if notification_type == "step_error" and sid and data.get("pause_on_failure"):
            reply_markup = {
                "inline_keyboard": [
                    [
                        {"text": "Resume & Skip", "callback_data": f"skip:{sid}:{step_id}"},
                        {"text": "Restart Step",  "callback_data": f"rerun:{sid}:{step_id}"},
                    ],
                    [
                        {"text": "Restart Scan",  "callback_data": f"restart:{sid}:"},
                        {"text": "Cancel Scan",   "callback_data": f"cancel:{sid}:"},
                    ],
                ]
            }
        elif notification_type == "scan_error" and sid:
            reply_markup = {
                "inline_keyboard": [
                    [{"text": "Restart Scan", "callback_data": f"restart:{sid}:"}],
                ]
            }

    url = _TELEGRAM_BASE.format(token=token)
    payload: dict = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    import asyncio as _asyncio
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code != 200:
                    log.warning(
                        "Telegram API returned %d: %s",
                        resp.status_code,
                        resp.text[:200],
                    )
                return  # success — exit retry loop
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            last_exc = exc
            if attempt == 0:
                log.warning("Telegram send failed (attempt 1): %s — retrying in 2s", exc)
                await _asyncio.sleep(2)
    if last_exc:
        raise last_exc
