"""
Settings API — Telegram config + API key management.

GET  /api/v1/settings/telegram           — get telegram settings (token masked)
PUT  /api/v1/settings/telegram           — update telegram settings
POST /api/v1/settings/telegram/test      — send a test Telegram message

GET    /api/v1/settings/api-keys           — list configured API keys (values hidden)
POST   /api/v1/settings/api-keys           — add or update an API key (encrypts value)
DELETE /api/v1/settings/api-keys/{service} — remove an API key
"""
import logging
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from engine.db import Database, get_db
from engine.crypto import CryptoError, decrypt, encrypt
from engine.api.schemas import (
    ApiKeyCreate,
    ApiKeyOut,
    BackupEntry,
    GeneralSettingsIn,
    GeneralSettingsOut,
    StorageStatsOut,
    StorageTargetEntry,
    TelegramSettingsIn,
    TelegramSettingsOut,
)

log = logging.getLogger("engine.api.settings")
router = APIRouter(prefix="/settings", tags=["settings"])


# ── General Settings ──────────────────────────────────────────────────────────

@router.get("/", response_model=GeneralSettingsOut)
async def get_general_settings(db: Database = Depends(get_db)) -> GeneralSettingsOut:
    rows = await db.fetchall(
        "SELECT key, value FROM settings WHERE key IN ('engine.disk_pause_threshold', 'scheduler.mode')"
    )
    cfg = {r["key"]: r["value"] for r in rows}
    return GeneralSettingsOut(
        disk_pause_threshold=float(cfg.get("engine.disk_pause_threshold", "90.0")),
        scheduler_mode=cfg.get("scheduler.mode", "sequential"),
    )


@router.put("/", response_model=GeneralSettingsOut)
async def update_general_settings(
    body: GeneralSettingsIn, db: Database = Depends(get_db)
) -> GeneralSettingsOut:
    now = datetime.now(timezone.utc).isoformat()
    updates: dict[str, str] = {}

    if body.disk_pause_threshold is not None:
        updates["engine.disk_pause_threshold"] = str(body.disk_pause_threshold)
    if body.scheduler_mode is not None:
        updates["scheduler.mode"] = body.scheduler_mode
        from engine import scheduler as _sched
        _sched.set_mode(body.scheduler_mode)

    for key, value in updates.items():
        await db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, now),
        )
    await db.commit()
    return await get_general_settings(db)


# ── Storage Stats & Cleanup ────────────────────────────────────────────────────

@router.get("/storage", response_model=StorageStatsOut)
async def get_storage_stats(db: Database = Depends(get_db)) -> StorageStatsOut:
    import shutil as _shutil
    from pathlib import Path as _Path
    from engine.storage import DATA_ROOT

    usage = _shutil.disk_usage(str(DATA_ROOT))
    scans_dir = DATA_ROOT / "scans"
    per_target: list[StorageTargetEntry] = []
    if scans_dir.exists():
        for domain_dir in sorted(scans_dir.iterdir()):
            if domain_dir.is_dir():
                try:
                    size = sum(
                        f.stat().st_size
                        for f in _Path(domain_dir).rglob("*")
                        if f.is_file()
                    )
                    per_target.append(StorageTargetEntry(domain=domain_dir.name, used_bytes=size))
                except OSError:
                    pass

    per_target.sort(key=lambda x: x.used_bytes, reverse=True)
    return StorageStatsOut(
        total_bytes=usage.total,
        used_bytes=usage.used,
        free_bytes=usage.free,
        used_pct=round(usage.used / usage.total * 100, 1),
        targets=per_target,
    )


@router.post("/storage/cleanup", status_code=200)
async def run_storage_cleanup(db: Database = Depends(get_db)) -> dict:
    from engine.storage import cleanup_old_sessions

    targets = await db.fetchall(
        "SELECT id, domain, retention_runs FROM targets"
    )
    total_cleaned = 0
    for t in targets:
        cleaned = await cleanup_old_sessions(
            domain=t["domain"],
            target_id=t["id"],
            db=db,
            retention_runs=t["retention_runs"],
        )
        total_cleaned += cleaned

    await db.commit()
    return {"cleaned_sessions": total_cleaned}


# ── Telegram ──────────────────────────────────────────────────────────────────

@router.get("/telegram", response_model=TelegramSettingsOut)
async def get_telegram(db: Database = Depends(get_db)) -> TelegramSettingsOut:
    rows = await db.fetchall(
        "SELECT key, value FROM settings WHERE key LIKE 'telegram.%'"
    )
    cfg = {r["key"]: r["value"] for r in rows}
    return TelegramSettingsOut(
        enabled=cfg.get("telegram.enabled") == "true",
        has_token=bool(cfg.get("telegram.bot_token")),
        chat_id=cfg.get("telegram.chat_id"),
        notify_new_hosts=cfg.get("telegram.notify_new_hosts") != "false",
        notify_host_changes=cfg.get("telegram.notify_host_changes") != "false",
        notify_scan_complete=cfg.get("telegram.notify_scan_complete") != "false",
        notify_errors=cfg.get("telegram.notify_errors") != "false",
        notify_host_gone=cfg.get("telegram.notify_host_gone") != "false",
        notify_host_returned=cfg.get("telegram.notify_host_returned") != "false",
        notify_new_subdomains=cfg.get("telegram.notify_new_subdomains") != "false",
        notify_takeover=cfg.get("telegram.notify_takeover") != "false",
        notify_system=cfg.get("telegram.notify_system") != "false",
        notify_step_errors=cfg.get("telegram.notify_step_errors") != "false",
        commands_enabled=cfg.get("telegram.commands_enabled") == "true",
    )


@router.put("/telegram", response_model=TelegramSettingsOut)
async def update_telegram(
    body: TelegramSettingsIn, db: Database = Depends(get_db)
) -> TelegramSettingsOut:
    now = datetime.now(timezone.utc).isoformat()

    updates: dict[str, str | None] = {
        "telegram.enabled":               "true" if body.enabled else "false",
        "telegram.chat_id":               body.chat_id,
        "telegram.notify_new_hosts":      "true" if body.notify_new_hosts else "false",
        "telegram.notify_host_changes":   "true" if body.notify_host_changes else "false",
        "telegram.notify_scan_complete":  "true" if body.notify_scan_complete else "false",
        "telegram.notify_errors":         "true" if body.notify_errors else "false",
        "telegram.notify_host_gone":      "true" if body.notify_host_gone else "false",
        "telegram.notify_host_returned":  "true" if body.notify_host_returned else "false",
        "telegram.notify_new_subdomains": "true" if body.notify_new_subdomains else "false",
        "telegram.notify_takeover":       "true" if body.notify_takeover else "false",
        "telegram.notify_system":         "true" if body.notify_system else "false",
        "telegram.notify_step_errors":    "true" if body.notify_step_errors else "false",
        "telegram.commands_enabled":      "true" if body.commands_enabled else "false",
    }

    # Only update token if a new one was provided
    if body.bot_token:
        try:
            updates["telegram.bot_token"] = encrypt(body.bot_token)
        except CryptoError as exc:
            raise HTTPException(
                status_code=500, detail="Failed to encrypt bot token"
            ) from exc

    for key, value in updates.items():
        await db.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, now),
        )
    await db.commit()

    # Restart bot on config change
    import asyncio as _asyncio
    try:
        from engine.app import _restart_telegram_bot
        _asyncio.create_task(_restart_telegram_bot())
    except Exception as exc:
        log.warning("Bot restart trigger failed: %s", exc)

    return await get_telegram(db)


@router.post("/telegram/test", status_code=status.HTTP_204_NO_CONTENT)
async def test_telegram(db: Database = Depends(get_db)) -> None:
    rows = await db.fetchall(
        "SELECT key, value FROM settings WHERE key LIKE 'telegram.%'"
    )
    cfg = {r["key"]: r["value"] for r in rows}

    token_enc = cfg.get("telegram.bot_token")
    chat_id = cfg.get("telegram.chat_id")

    if not token_enc or not chat_id:
        raise HTTPException(
            status_code=400,
            detail="Telegram bot token and chat ID must be configured first",
        )

    try:
        token = decrypt(token_enc)
    except CryptoError as exc:
        raise HTTPException(
            status_code=500, detail="Failed to decrypt bot token"
        ) from exc

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": "✅ RECON_APP — Telegram notifications are working!",
                },
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Telegram API error: {resp.status_code}",
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502, detail=f"Network error: {exc}"
        ) from exc


# ── API Keys ──────────────────────────────────────────────────────────────────

@router.get("/api-keys", response_model=list[ApiKeyOut])
async def list_api_keys(db: Database = Depends(get_db)) -> list[ApiKeyOut]:
    rows = await db.fetchall(
        "SELECT id, service, key_name, created_at, updated_at FROM api_keys ORDER BY service"
    )
    return [
        ApiKeyOut(
            id=r["id"],
            service=r["service"],
            key_name=r["key_name"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]


@router.post("/api-keys", response_model=ApiKeyOut, status_code=status.HTTP_201_CREATED)
async def upsert_api_key(
    body: ApiKeyCreate, db: Database = Depends(get_db)
) -> ApiKeyOut:
    try:
        encrypted_value = encrypt(body.key_value)
    except CryptoError as exc:
        raise HTTPException(
            status_code=500, detail="Failed to encrypt API key"
        ) from exc

    now = datetime.now(timezone.utc).isoformat()
    existing = await db.fetchone(
        "SELECT id FROM api_keys WHERE service = ?", (body.service,)
    )

    if existing:
        await db.execute(
            "UPDATE api_keys SET key_name = ?, key_value = ?, updated_at = ? WHERE service = ?",
            (body.key_name, encrypted_value, now, body.service),
        )
        key_id = existing["id"]
    else:
        key_id = str(uuid.uuid4())
        await db.execute(
            """
            INSERT INTO api_keys (id, service, key_name, key_value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (key_id, body.service, body.key_name, encrypted_value, now, now),
        )
    await db.commit()

    row = await db.fetchone(
        "SELECT id, service, key_name, created_at, updated_at FROM api_keys WHERE id = ?",
        (key_id,),
    )
    return ApiKeyOut(
        id=row["id"],
        service=row["service"],
        key_name=row["key_name"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.delete("/api-keys/{service}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(service: str, db: Database = Depends(get_db)) -> None:
    row = await db.fetchone(
        "SELECT id FROM api_keys WHERE service = ?", (service,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="API key not found")
    await db.execute("DELETE FROM api_keys WHERE service = ?", (service,))
    await db.commit()


# ── API Key Test ──────────────────────────────────────────────────────────────

# (url, auth_type) where auth_type is one of:
#   "query_key"   — append ?key={key}
#   "query_apikey"— append ?apikey={key}
#   "bearer"      — Authorization: token {key}  (GitHub uses "token" not "Bearer")
#   "header"      — custom header name after "header_" prefix, e.g. "header_x-apikey"
_KEY_TEST_CONFIGS: dict[str, tuple[str, str]] = {
    "shodan":         ("https://api.shodan.io/api-info?key={key}", "query_inline"),
    "securitytrails": ("https://api.securitytrails.com/v1/ping?apikey={key}", "query_inline"),
    "virustotal":     ("https://www.virustotal.com/api/v3/user", "header_x-apikey"),
    "github":         ("https://api.github.com/user", "bearer_token"),
    "urlscan":        ("https://urlscan.io/user/quotas", "header_api-key"),
    "alienvault":     ("https://otx.alienvault.com/api/v1/user/me", "header_x-otx-api-key"),
}


@router.post("/api-keys/{service}/test")
async def test_api_key(service: str, db: Database = Depends(get_db)) -> dict:
    row = await db.fetchone(
        "SELECT key_value FROM api_keys WHERE service = ?", (service,)
    )
    if not row:
        raise HTTPException(status_code=404, detail="API key not found")

    try:
        key = decrypt(row["key_value"])
    except CryptoError as exc:
        raise HTTPException(status_code=500, detail="Failed to decrypt API key") from exc

    if service not in _KEY_TEST_CONFIGS:
        return {"valid": None, "message": f"No test endpoint configured for '{service}'"}

    url_template, auth_type = _KEY_TEST_CONFIGS[service]
    url = url_template.format(key=key)
    headers: dict[str, str] = {}

    if auth_type == "query_inline":
        pass  # key already embedded in URL template
    elif auth_type == "bearer_token":
        headers["Authorization"] = f"token {key}"
    elif auth_type.startswith("header_"):
        header_name = auth_type[len("header_"):]
        headers[header_name] = key

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
        valid = resp.status_code == 200
        return {"valid": valid, "message": f"HTTP {resp.status_code}"}
    except httpx.RequestError as exc:
        return {"valid": False, "message": f"Network error: {exc}"}


# ── Tool health ────────────────────────────────────────────────────────────────

@router.get("/tools", response_model=list)
async def get_tool_health(db: Database = Depends(get_db)):
    """Check all registered tools for installation status and version."""
    from engine.tools.health import check_all_tools
    from engine.tools.version_check import get_cached_versions, _version_lt
    from engine.api.schemas import ToolHealthOut
    results = await check_all_tools()
    cached = await get_cached_versions(db) or {}
    out = []
    for h in results:
        latest = cached.get(h.step_id)
        update_available = _version_lt(h.version or "", latest or "") if (h.version and latest) else False
        out.append(
            ToolHealthOut(
                step_id=h.step_id,
                name=h.name,
                installed=h.installed,
                version=h.version,
                latest_version=latest,
                update_available=update_available,
                path=h.path,
                error=h.error,
                checked_at=h.checked_at,
            )
        )
    return out


@router.get("/tools-updates")
async def get_tools_updates(db: Database = Depends(get_db)):
    """
    Lightweight endpoint — returns only update availability from cache.
    No subprocess calls. Used by Dashboard to avoid blocking page load.
    """
    from engine.tools.version_check import get_cached_versions, _version_lt
    from engine.tools.health import check_all_tools
    cached = await get_cached_versions(db) or {}
    # We still need installed versions — use health check results (cached by OS, fast)
    results = await check_all_tools()
    return [
        {
            "step_id": h.step_id,
            "version": h.version,
            "latest_version": cached.get(h.step_id),
            "update_available": _version_lt(h.version or "", cached.get(h.step_id) or "") if (h.version and cached.get(h.step_id)) else False,
        }
        for h in results
    ]


# ── Backup ────────────────────────────────────────────────────────────────────

@router.get("/backup", response_model=list[BackupEntry])
async def list_backups_endpoint() -> list[BackupEntry]:
    """List all backups newest-first."""
    from engine.backup import list_backups
    return [BackupEntry(**e) for e in list_backups()]


@router.post("/backup", response_model=BackupEntry, status_code=status.HTTP_201_CREATED)
async def create_backup_endpoint() -> BackupEntry:
    """Trigger a manual hot backup. Returns the new backup entry."""
    from engine.backup import create_backup, enforce_retention
    from engine.config import get_settings
    try:
        entry = await create_backup(get_settings().db_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}") from exc
    enforce_retention(keep=3)
    return BackupEntry(**entry)


@router.delete("/backup/{filename}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_backup_endpoint(filename: str) -> None:
    """Delete a specific backup file."""
    import re
    from engine.backup import BACKUP_DIR
    # Allow only safe filenames: alphanumeric, underscores, dots — no path separators
    if not re.fullmatch(r"[A-Za-z0-9_.]+", filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = (BACKUP_DIR / filename).resolve()
    # Path traversal guard
    if not str(path).startswith(str(BACKUP_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    path.unlink()
