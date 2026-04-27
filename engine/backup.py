"""SQLite hot backup helpers."""
import logging
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from engine.storage import DATA_ROOT

log = logging.getLogger("engine.backup")

BACKUP_DIR = DATA_ROOT / "backups"


def list_backups() -> list[dict]:
    """Return [{filename, size_bytes, created_at}] sorted newest-first."""
    if not BACKUP_DIR.exists():
        return []
    entries = []
    for f in BACKUP_DIR.glob("recon_*.db"):
        try:
            stat = f.stat()
            # Extract timestamp from filename: recon_YYYYMMDD_HHMMSS.db
            ts = f.stem[len("recon_"):]
            entries.append({
                "filename": f.name,
                "size_bytes": stat.st_size,
                "created_at": ts,
            })
        except OSError:
            pass
    entries.sort(key=lambda e: e["created_at"], reverse=True)
    return entries


async def create_backup(db_path: str) -> dict:
    """
    Hot backup via aiosqlite backup API (sqlite3_backup_init).
    File: backups/recon_{YYYYMMDD_HHMMSS}.db
    Returns the backup entry dict.
    """
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"recon_{ts}.db"
    try:
        src_conn = await aiosqlite.connect(db_path)
        dst_conn = await aiosqlite.connect(str(dest))
        try:
            await src_conn.backup(dst_conn)
        finally:
            await dst_conn.close()
            await src_conn.close()
        size = dest.stat().st_size
        log.info("Backup created: %s (%d bytes)", dest.name, size)
        return {"filename": dest.name, "size_bytes": size, "created_at": ts}
    except Exception as exc:
        log.error("Backup failed: %s", exc)
        # Clean up partial file
        if dest.exists():
            dest.unlink(missing_ok=True)
        raise


def enforce_retention(keep: int = 10) -> int:
    """Delete oldest backups beyond `keep`. Returns count deleted."""
    entries = list_backups()
    to_delete = entries[keep:]
    deleted = 0
    for entry in to_delete:
        path = BACKUP_DIR / entry["filename"]
        try:
            path.unlink(missing_ok=True)
            deleted += 1
            log.debug("Deleted old backup: %s", entry["filename"])
        except OSError as exc:
            log.warning("Failed to delete backup %s: %s", entry["filename"], exc)
    return deleted
