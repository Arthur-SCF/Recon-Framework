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


async def notify(
    *,
    notification_type: str,
    title: str,
    message: str | None = None,
    data: dict | None = None,
    target_id: str | None = None,
    session_id: str | None = None,
) -> str | None:
    """
    Create and dispatch a notification. Returns the new notification ID, or None on error.

    notification_type must be one of:
      new_subdomains | new_hosts | host_changed | host_gone | host_returned |
      takeover_candidate | scan_complete | scan_error | system | step_error
    """
    from engine.db import get_db
    from engine.websocket import ws_manager

    notif_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # 1. Persist to database
    try:
        db = await get_db()
        await db.execute(
            """
            INSERT INTO notifications
                (id, target_id, session_id, type, title, message, data, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                notif_id,
                target_id,
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

    # 2. WebSocket broadcast
    try:
        await ws_manager.broadcast(
            event_type="notification",
            data={
                "id": notif_id,
                "type": notification_type,
                "title": title,
                "message": message,
                "data": data,
            },
            target_id=target_id,
            session_id=session_id,
        )
    except Exception:
        log.exception("Failed to broadcast notification over WebSocket")
        # Non-fatal — DB write succeeded

    # 3. Telegram
    try:
        await _maybe_send_telegram(notification_type, title, message, data)
    except Exception:
        log.exception("Telegram notification failed")

    return notif_id


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

    text = f"*{title}*"
    if message:
        text += f"\n{message}"

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
        "parse_mode": "Markdown",
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
