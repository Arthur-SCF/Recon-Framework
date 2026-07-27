"""
Telegram bot polling listener for RECON_APP.

Provides interactive error recovery via Telegram:
- Long-polls getUpdates (30s timeout, 35s httpx timeout)
- Enforces chat_id whitelist on every update
- Dispatches text commands: /status /pause /resume /loops /help
- Dispatches inline button callbacks: skip, rerun, restart, cancel

Usage:
    bot = TelegramBot(token="...", chat_id="...")
    await bot.start()
    # ... application runs ...
    await bot.stop()
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger("engine.telegram_bot")

_TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _extract_chat_id(update: dict) -> str | None:
    """Extract chat_id from any update type."""
    if "message" in update:
        return str(update["message"].get("chat", {}).get("id", ""))
    if "callback_query" in update:
        return str(update["callback_query"].get("message", {}).get("chat", {}).get("id", ""))
    return None


class TelegramBot:
    """
    Long-polling Telegram bot with text command + inline button support.

    start() spawns the background polling task.
    stop() cancels it and closes the httpx client.
    restart() stop + start with fresh credentials (call after config change).
    """

    def __init__(self, token: str, chat_id: str) -> None:
        self._token = token
        self._chat_id = str(chat_id)
        self._client: httpx.AsyncClient = httpx.AsyncClient(timeout=None)
        self._poll_task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._poll_task and not self._poll_task.done():
            log.warning("TelegramBot.start() called while already running — ignoring")
            return
        self._poll_task = asyncio.create_task(
            self._poll_loop(), name="telegram-poll"
        )
        log.info("TelegramBot started (chat_id=%s)", self._chat_id)

    async def stop(self) -> None:
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        await self._client.aclose()
        log.info("TelegramBot stopped")

    async def restart(self, token: str, chat_id: str) -> None:
        """Stop, update credentials, and restart the polling loop."""
        await self.stop()
        self._token = token
        self._chat_id = str(chat_id)
        self._client = httpx.AsyncClient(timeout=None)
        await self.start()
        log.info("TelegramBot restarted with new credentials")

    # ── Core polling loop ──────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        offset = 0
        log.info("Telegram poll loop starting")
        while True:
            try:
                resp = await self._client.post(
                    _TELEGRAM_API.format(token=self._token, method="getUpdates"),
                    json={
                        "offset": offset,
                        "timeout": 30,
                        "allowed_updates": ["message", "callback_query"],
                    },
                    timeout=35.0,
                )
                data = resp.json()
                if not data.get("ok"):
                    log.warning("Telegram getUpdates failed: %s", data)
                    await asyncio.sleep(5)
                    continue

                for update in data.get("result", []):
                    offset = update["update_id"] + 1

                    # Security: only accept updates from the configured chat
                    chat_id = _extract_chat_id(update)
                    if not chat_id or chat_id != self._chat_id:
                        continue

                    if "message" in update:
                        await self._handle_message(update["message"])
                    elif "callback_query" in update:
                        await self._handle_callback(update["callback_query"])

            except asyncio.CancelledError:
                log.info("Telegram poll loop cancelled")
                raise
            except Exception as exc:
                log.error("Telegram poll error: %s", exc)
                await asyncio.sleep(5)

    # ── Text command dispatcher ────────────────────────────────────────────────

    async def _handle_message(self, message: dict) -> None:
        text = (message.get("text") or "").strip()
        chat_id = str(message.get("chat", {}).get("id", ""))

        if not text.startswith("/"):
            return

        parts = text.split(None, 2)
        cmd = parts[0].lower()

        if cmd == "/status":
            await self._cmd_status(chat_id)
        elif cmd == "/pause":
            await self._cmd_pause(chat_id)
        elif cmd == "/resume":
            await self._cmd_resume(chat_id)
        elif cmd == "/loops":
            sub = parts[1].lower() if len(parts) > 1 else ""
            await self._cmd_loops(chat_id, sub)
        elif cmd == "/help":
            await self._cmd_help(chat_id)
        else:
            await self._send(chat_id, "❓ Unknown command. Use /help for available commands.")

    async def _cmd_status(self, chat_id: str) -> None:
        from engine import scheduler
        from engine.db import get_db

        db = await get_db()
        active_sid = scheduler.get_active_session()
        queue = scheduler.get_queue()

        lines: list[str] = []

        if active_sid:
            row = await db.fetchone(
                "SELECT target_id, started_at, current_step FROM scan_sessions WHERE id=?",
                (active_sid,),
            )
            if row:
                target = await db.fetchone(
                    "SELECT domain FROM targets WHERE id=?", (row["target_id"],)
                )
                domain = target["domain"] if target else "unknown"
                try:
                    started = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00"))
                    elapsed_s = int((datetime.now(timezone.utc) - started).total_seconds())
                    elapsed = f"{elapsed_s // 60}m" if elapsed_s >= 60 else f"{elapsed_s}s"
                except Exception:
                    elapsed = "?"
                step = row["current_step"] if "current_step" in row.keys() else "?"
                lines.append(f"🟢 <b>Active:</b> <code>{domain}</code>")
                lines.append(f"   ↳ <i>{step}</i> · {elapsed} elapsed")
            else:
                lines.append("🟡 Active session data unavailable")
        else:
            lines.append("⚪ No active scan")

        lines.append("")
        if queue:
            lines.append(f"📋 <b>Queue</b> ({len(queue)} target{'s' if len(queue) != 1 else ''})")
            for i, tid in enumerate(queue[:5], 1):
                trow = await db.fetchone(
                    "SELECT domain, scan_priority FROM targets WHERE id=?", (tid,)
                )
                if trow:
                    lines.append(f"   {i}. <code>{trow['domain']}</code> · priority {trow['scan_priority']}")
        else:
            lines.append("📋 Queue: <i>empty</i>")

        lines.append("")
        loops_icon = "⏸️" if scheduler.is_loops_paused() else "♾️"
        queue_icon = "⏸️" if scheduler.is_queue_paused() else "▶️"
        loops_state = "paused" if scheduler.is_loops_paused() else "running"
        queue_state = "paused" if scheduler.is_queue_paused() else "running"
        lines.append(f"{loops_icon} Loops: <b>{loops_state}</b>  ·  {queue_icon} Queue: <b>{queue_state}</b>")

        await self._send(chat_id, "📊 <b>Scanner Status</b>\n\n" + "\n".join(lines))

    async def _cmd_pause(self, chat_id: str) -> None:
        from engine import scheduler
        scheduler.set_queue_paused(True)
        scheduler.set_loops_paused(True)
        await self._send(chat_id, "⏸️ <b>All scans paused</b>\nQueue and loops stopped.")

    async def _cmd_resume(self, chat_id: str) -> None:
        from engine import scheduler
        scheduler.set_queue_paused(False)
        scheduler.set_loops_paused(False)
        await self._send(chat_id, "▶️ <b>Resumed</b>\nQueue and loops running.")

    async def _cmd_loops(self, chat_id: str, sub: str) -> None:
        from engine import scheduler
        if sub == "pause":
            scheduler.set_loops_paused(True)
            await self._send(chat_id, "⏸️ <b>Loops paused.</b>")
        elif sub == "resume":
            scheduler.set_loops_paused(False)
            await self._send(chat_id, "▶️ <b>Loops resumed.</b>")
        else:
            await self._send(chat_id, "Usage: /loops pause  or  /loops resume")

    async def _cmd_help(self, chat_id: str) -> None:
        help_text = (
            "🛠️ <b>Recon Bot Commands</b>\n"
            "\n"
            "/status — Active scan, queue &amp; state\n"
            "/pause — Pause everything\n"
            "/resume — Resume everything\n"
            "/loops pause — Pause auto-loops only\n"
            "/loops resume — Resume auto-loops only\n"
            "/help — This message"
        )
        await self._send(chat_id, help_text)

    # ── Inline button callback dispatcher ─────────────────────────────────────

    async def _handle_callback(self, callback_query: dict) -> None:
        cq_id = callback_query["id"]
        data = callback_query.get("data", "")

        # Extract message coordinates so we can remove buttons after action
        msg = callback_query.get("message", {})
        msg_id = msg.get("message_id")
        chat_id = str(msg.get("chat", {}).get("id", ""))

        try:
            action, sid_short, step_id = data.split(":", 2)
        except ValueError:
            await self._answer_callback(cq_id, "Invalid callback data")
            return

        from engine.db import get_db
        db = await get_db()

        session = await db.fetchone(
            "SELECT id, target_id, status FROM scan_sessions WHERE id LIKE ?",
            (f"{sid_short}%",),
        )
        if not session:
            await self._answer_callback(cq_id, "Session not found")
            return

        session_id = session["id"]
        target_id = session["target_id"]

        # Stale-state checks
        if action in ("skip", "rerun") and session["status"] != "paused":
            await self._answer_callback(cq_id, "Scan is no longer paused")
            await self._clear_keyboard(chat_id, msg_id, "⚠️ Action no longer valid")
            return

        target = await db.fetchone(
            "SELECT domain FROM targets WHERE id=?", (target_id,)
        )
        if not target:
            await self._answer_callback(cq_id, "Target not found")
            return

        domain = target["domain"]

        _action_labels = {
            "skip":    "✓ Skipped — scan resumed",
            "rerun":   "✓ Step restarted",
            "restart": "✓ Scan restarted",
            "cancel":  "✓ Scan cancelled",
        }

        try:
            if action == "skip":
                await self._do_skip_and_resume(db, session_id, target_id, domain, step_id)
                await self._answer_callback(cq_id, f"Skipped {step_id} — scan resumed")
            elif action == "rerun":
                await self._do_rerun_step(db, session_id, target_id, domain, step_id)
                await self._answer_callback(cq_id, f"Rerunning {step_id}")
            elif action == "restart":
                await self._do_restart_scan(db, session_id, target_id, domain)
                await self._answer_callback(cq_id, "Scan restarted")
            elif action == "cancel":
                await self._do_cancel_scan(db, session_id, target_id, domain)
                await self._answer_callback(cq_id, "Scan cancelled")
            else:
                await self._answer_callback(cq_id, f"Unknown action: {action}")
                return

            # Remove keyboard from original message — prevents re-clicking
            label = _action_labels.get(action, "✓ Done")
            await self._clear_keyboard(chat_id, msg_id, label)

        except Exception as exc:
            log.error("Callback action %s failed: %s", action, exc, exc_info=True)
            await self._answer_callback(cq_id, "Action failed — check logs")

    # ── Callback action implementations ───────────────────────────────────────

    async def _do_skip_and_resume(
        self, db, session_id: str, target_id: str, domain: str, step_id: str
    ) -> None:
        """Mark the failed step_run as skipped, then resume the session."""
        step_run = await db.fetchone(
            """
            SELECT id FROM step_runs
            WHERE session_id=? AND step_id=? AND status IN ('error','timeout')
            ORDER BY started_at DESC LIMIT 1
            """,
            (session_id, step_id),
        )
        if step_run:
            await db.execute(
                "UPDATE step_runs SET status='skipped', finished_at=? WHERE id=?",
                (_now(), step_run["id"]),
            )

        await db.execute(
            "UPDATE scan_sessions SET status='running', paused_at=NULL, pause_type=NULL WHERE id=?",
            (session_id,),
        )
        await db.execute(
            "UPDATE targets SET status='running' WHERE id=?",
            (target_id,),
        )
        await db.commit()

        # Register in-memory skip signal so _run_step won't re-execute this step
        from engine.pipeline import signals
        signals.request_skip(session_id, step_id)

        import asyncio as _asyncio
        from engine.pipeline.runner import run_pipeline
        _asyncio.create_task(
            run_pipeline(db, session_id, target_id, domain),
            name=f"pipeline-{session_id[:8]}",
        )
        log.info("skip+resume: session %s step %s skipped, pipeline relaunched", session_id[:8], step_id)

    async def _do_rerun_step(
        self, db, session_id: str, target_id: str, domain: str, step_id: str
    ) -> None:
        """Reset the failed step_run to pending, then resume the session."""
        step_run = await db.fetchone(
            """
            SELECT id FROM step_runs
            WHERE session_id=? AND step_id=? AND status IN ('error','timeout','skipped')
            ORDER BY started_at DESC LIMIT 1
            """,
            (session_id, step_id),
        )
        if step_run:
            await db.execute(
                "UPDATE step_runs SET status='pending', finished_at=NULL WHERE id=?",
                (step_run["id"],),
            )

        await db.execute(
            "UPDATE scan_sessions SET status='running', paused_at=NULL, pause_type=NULL WHERE id=?",
            (session_id,),
        )
        await db.execute(
            "UPDATE targets SET status='running' WHERE id=?",
            (target_id,),
        )
        await db.commit()

        import asyncio as _asyncio
        from engine.pipeline.runner import run_pipeline
        _asyncio.create_task(
            run_pipeline(db, session_id, target_id, domain),
            name=f"pipeline-{session_id[:8]}",
        )
        log.info("rerun: session %s step %s reset to pending, pipeline relaunched", session_id[:8], step_id)

    async def _do_restart_scan(
        self, db, session_id: str, target_id: str, domain: str
    ) -> None:
        """Cancel the current session and re-enqueue the target."""
        now = _now()
        await db.execute(
            "UPDATE scan_sessions SET status='cancelled', finished_at=? WHERE id=?",
            (now, session_id),
        )
        await db.execute(
            "UPDATE step_runs SET status='skipped', finished_at=? WHERE session_id=? AND status='running'",
            (now, session_id),
        )
        await db.execute(
            "UPDATE targets SET status='idle' WHERE id=?",
            (target_id,),
        )
        await db.commit()

        from engine import scheduler
        scheduler.enqueue_manual(target_id)
        log.info("restart: session %s cancelled, target %s re-enqueued", session_id[:8], target_id)

    async def _do_cancel_scan(
        self, db, session_id: str, target_id: str, domain: str
    ) -> None:
        """Cancel the session and set target to idle."""
        now = _now()
        await db.execute(
            "UPDATE scan_sessions SET status='cancelled', finished_at=? WHERE id=?",
            (now, session_id),
        )
        await db.execute(
            "UPDATE step_runs SET status='skipped', finished_at=? WHERE session_id=? AND status='running'",
            (now, session_id),
        )
        await db.execute(
            "UPDATE targets SET status='idle' WHERE id=?",
            (target_id,),
        )
        await db.commit()

        from engine.websocket import ws_manager
        try:
            await ws_manager.broadcast(
                "scan_cancelled",
                {"session_id": session_id},
                target_id=target_id,
                session_id=session_id,
            )
        except Exception:
            pass
        log.info("cancel: session %s cancelled, target %s idle", session_id[:8], target_id)

    # ── Low-level Telegram API wrappers ───────────────────────────────────────

    async def _send(
        self,
        chat_id: str,
        text: str,
        reply_markup: dict | None = None,
    ) -> None:
        """Send a Telegram message. Logs on failure, does not raise."""
        payload: dict = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup

        try:
            resp = await self._client.post(
                _TELEGRAM_API.format(token=self._token, method="sendMessage"),
                json=payload,
                timeout=10.0,
            )
            if resp.status_code != 200:
                log.warning(
                    "Telegram sendMessage returned %d: %s",
                    resp.status_code, resp.text[:200],
                )
        except Exception as exc:
            log.error("Telegram sendMessage failed: %s", exc)

    async def _answer_callback(self, callback_query_id: str, text: str) -> None:
        """Acknowledge a callback query (shows toast on user's phone)."""
        try:
            resp = await self._client.post(
                _TELEGRAM_API.format(token=self._token, method="answerCallbackQuery"),
                json={"callback_query_id": callback_query_id, "text": text},
                timeout=5.0,
            )
            if resp.status_code != 200:
                log.warning(
                    "Telegram answerCallbackQuery returned %d: %s",
                    resp.status_code, resp.text[:100],
                )
        except Exception as exc:
            log.error("Telegram answerCallbackQuery failed: %s", exc)

    async def _clear_keyboard(
        self, chat_id: str, message_id: int | None, footer: str = "✓ Done"
    ) -> None:
        """
        Remove inline keyboard from a message and append a one-line status footer.
        Prevents users from re-clicking action buttons after an action was taken.
        """
        if not chat_id or not message_id:
            return
        try:
            resp = await self._client.post(
                _TELEGRAM_API.format(token=self._token, method="editMessageReplyMarkup"),
                json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "reply_markup": {"inline_keyboard": []},
                },
                timeout=5.0,
            )
            if resp.status_code != 200:
                log.warning(
                    "Telegram editMessageReplyMarkup returned %d: %s",
                    resp.status_code, resp.text[:100],
                )
        except Exception as exc:
            log.error("Telegram editMessageReplyMarkup failed: %s", exc)
