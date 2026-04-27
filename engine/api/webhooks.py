"""
Webhook notification channels — CRUD + test dispatch.

Each channel has a type (discord / slack / generic), a URL, optional events
filter, and an enabled flag.  URLs are stored as-is (no encryption needed —
they are not secrets by themselves).  An optional `secret` field is stored
for HMAC signing; it is encrypted at rest via Fernet (same pattern as API
keys).

SSRF protection: all webhook URLs are validated against a private-IP blocklist
at both write time (Pydantic validator) and dispatch time (_post_webhook).
"""

import asyncio
import ipaddress
import json
import logging
import socket
import uuid
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from engine.crypto import CryptoError, encrypt
from engine.db import Database, get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhooks"])

# ── SSRF protection ───────────────────────────────────────────────────────────

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / AWS IMDS
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),        # ULA
    ipaddress.ip_network("fe80::/10"),       # link-local IPv6
]


def _is_ssrf_url(url: str) -> bool:
    """Return True if the URL resolves to a private/internal/loopback address."""
    try:
        host = urlparse(url).hostname or ""
        if not host:
            return True
        # Literal IP — no DNS needed
        try:
            addr = ipaddress.ip_address(host)
            return any(addr in net for net in _BLOCKED_NETWORKS)
        except ValueError:
            pass
        # DNS resolution — check every returned address
        for *_, sockaddr in socket.getaddrinfo(host, None):
            try:
                addr = ipaddress.ip_address(sockaddr[0])
                if any(addr in net for net in _BLOCKED_NETWORKS):
                    return True
            except ValueError:
                continue
        return False
    except Exception:
        return True  # fail closed


VALID_EVENTS = frozenset(
    ["new_hosts", "host_changed", "host_gone", "scan_complete", "scan_error"]
)

WEBHOOK_TYPES = {"discord", "slack", "generic"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class WebhookChannelCreate(BaseModel):
    type: Literal["discord", "slack", "generic"]
    name: str
    url: str
    secret: str | None = None
    events: list[str] = ["new_hosts", "host_changed", "host_gone", "scan_complete", "scan_error"]
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 80:
            raise ValueError("name must be 1–80 chars")
        return v

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("url must start with http:// or https://")
        if len(v) > 2048:
            raise ValueError("url too long")
        if _is_ssrf_url(v):
            raise ValueError("url must not point to a private or internal address")
        return v

    @field_validator("events")
    @classmethod
    def validate_events(cls, v: list[str]) -> list[str]:
        invalid = set(v) - VALID_EVENTS
        if invalid:
            raise ValueError(f"unknown events: {', '.join(sorted(invalid))}")
        return list(set(v))


class WebhookChannelUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    secret: str | None = None
    events: list[str] | None = None
    enabled: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v or len(v) > 80:
                raise ValueError("name must be 1–80 chars")
        return v

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not (v.startswith("http://") or v.startswith("https://")):
                raise ValueError("url must start with http:// or https://")
            if len(v) > 2048:
                raise ValueError("url too long")
            if _is_ssrf_url(v):
                raise ValueError("url must not point to a private or internal address")
        return v

    @field_validator("events")
    @classmethod
    def validate_events(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            invalid = set(v) - VALID_EVENTS
            if invalid:
                raise ValueError(f"unknown events: {', '.join(sorted(invalid))}")
            return list(set(v))
        return v


class WebhookChannelOut(BaseModel):
    id: str
    type: str
    name: str
    enabled: bool
    events: list[str]
    created_at: str
    # url and secret are intentionally NOT included in responses


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_out(row: dict) -> WebhookChannelOut:
    return WebhookChannelOut(
        id=row["id"],
        type=row["type"],
        name=row["name"],
        enabled=bool(row["enabled"]),
        events=json.loads(row["events"]),
        created_at=row["created_at"],
    )


def _build_payload(channel_type: str, event_type: str, title: str, message: str, data: dict) -> dict:
    """Build a webhook payload appropriate for the channel type."""
    if channel_type == "discord":
        color_map = {
            "new_hosts":     0x2ECC71,   # green
            "host_changed":  0xF1C40F,   # yellow
            "host_gone":     0xE74C3C,   # red
            "scan_complete": 0x3498DB,   # blue
            "scan_error":    0xE74C3C,   # red
        }
        return {
            "embeds": [{
                "title": title,
                "description": message or "",
                "color": color_map.get(event_type, 0x95A5A6),
            }]
        }

    if channel_type == "slack":
        return {
            "text": f"*{title}*",
            "attachments": [{"text": message or ""}] if message else [],
        }

    # generic
    return {
        "event": event_type,
        "title": title,
        "message": message or "",
        "data": data,
    }


async def _post_webhook(url: str, payload: dict) -> None:
    """Fire-and-forget HTTP POST. Errors are logged, not propagated."""
    if _is_ssrf_url(url):
        logger.warning("Webhook POST blocked — SSRF risk: %s", url[:60])
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code >= 400:
                logger.warning("Webhook POST %s returned %s", url[:60], resp.status_code)
    except Exception as exc:
        logger.warning("Webhook POST failed for %s: %s", url[:60], exc)


async def dispatch_webhooks(
    db: Database,
    event_type: str,
    title: str,
    message: str,
    data: dict | None = None,
) -> None:
    """
    Fan out a notification to all enabled channels that subscribe to event_type.
    Called fire-and-forget via asyncio.create_task().
    """
    try:
        rows = await db.fetchall(
            "SELECT * FROM notification_channels WHERE enabled = 1", ()
        )
    except Exception as exc:
        logger.error("dispatch_webhooks: failed to fetch channels: %s", exc)
        return

    for row in rows:
        try:
            events: list[str] = json.loads(row["events"])
        except (json.JSONDecodeError, KeyError):
            continue
        if event_type not in events:
            continue
        payload = _build_payload(row["type"], event_type, title, message, data or {})
        asyncio.create_task(_post_webhook(row["url"], payload))


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/v1/webhooks", response_model=list[WebhookChannelOut])
async def list_webhooks(db: Database = Depends(get_db)):
    rows = await db.fetchall(
        "SELECT * FROM notification_channels ORDER BY created_at DESC", ()
    )
    return [_row_to_out(r) for r in rows]


@router.post("/api/v1/webhooks", response_model=WebhookChannelOut, status_code=status.HTTP_201_CREATED)
async def create_webhook(body: WebhookChannelCreate, db: Database = Depends(get_db)):
    channel_id = str(uuid.uuid4())
    events_json = json.dumps(body.events)
    try:
        encrypted_secret = encrypt(body.secret) if body.secret else None
    except CryptoError as exc:
        raise HTTPException(status_code=500, detail="Failed to encrypt webhook secret") from exc
    await db.execute(
        """
        INSERT INTO notification_channels (id, type, name, url, secret, events, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (channel_id, body.type, body.name, body.url, encrypted_secret, events_json, int(body.enabled)),
    )
    await db.commit()
    row = await db.fetchone(
        "SELECT * FROM notification_channels WHERE id = ?", (channel_id,)
    )
    return _row_to_out(row)


@router.put("/api/v1/webhooks/{channel_id}", response_model=WebhookChannelOut)
async def update_webhook(
    channel_id: str,
    body: WebhookChannelUpdate,
    db: Database = Depends(get_db),
):
    row = await db.fetchone(
        "SELECT * FROM notification_channels WHERE id = ?", (channel_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Channel not found")

    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.url is not None:
        updates["url"] = body.url
    if body.secret is not None:
        try:
            updates["secret"] = encrypt(body.secret)
        except CryptoError as exc:
            raise HTTPException(status_code=500, detail="Failed to encrypt webhook secret") from exc
    if body.events is not None:
        updates["events"] = json.dumps(body.events)
    if body.enabled is not None:
        updates["enabled"] = int(body.enabled)

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE notification_channels SET {set_clause} WHERE id = ?",
            (*updates.values(), channel_id),
        )
        await db.commit()

    row = await db.fetchone(
        "SELECT * FROM notification_channels WHERE id = ?", (channel_id,)
    )
    return _row_to_out(row)


@router.delete("/api/v1/webhooks/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(channel_id: str, db: Database = Depends(get_db)):
    row = await db.fetchone(
        "SELECT id FROM notification_channels WHERE id = ?", (channel_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Channel not found")
    await db.execute(
        "DELETE FROM notification_channels WHERE id = ?", (channel_id,)
    )
    await db.commit()


@router.post("/api/v1/webhooks/{channel_id}/test")
async def test_webhook(channel_id: str, db: Database = Depends(get_db)):
    """Send a test payload to the channel's URL and return the result."""
    row = await db.fetchone(
        "SELECT * FROM notification_channels WHERE id = ?", (channel_id,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Channel not found")

    if _is_ssrf_url(row["url"]):
        raise HTTPException(
            status_code=400,
            detail="Webhook URL points to a private or internal address",
        )

    payload = _build_payload(
        row["type"],
        "scan_complete",
        "Test notification",
        "This is a test from RECON_APP.",
        {},
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(row["url"], json=payload)
        return {"success": resp.status_code < 400, "status_code": resp.status_code}
    except httpx.RequestError as exc:
        return {"success": False, "error": str(exc)}
