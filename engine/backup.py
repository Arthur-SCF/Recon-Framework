"""SQLite hot backup helpers — gzip compressed."""
import gzip
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from engine.storage import DATA_ROOT

log = logging.getLogger("engine.backup")

BACKUP_DIR = DATA_ROOT / "backups"
_TS_RE = re.compile(r"^recon_(\d{8}_\d{6})\.db(?:\.gz)?$")


def _parse_entry(f: Path) -> dict | None:
    m = _TS_RE.match(f.name)
    if not m:
        return None
    try:
        return {
            "filename": f.name,
            "size_bytes": f.stat().st_size,
            "created_at": m.group(1),
        }
    except OSError:
        return None


def list_backups() -> list[dict]:
    """Return [{filename, size_bytes, created_at}] sorted newest-first.
    Handles both legacy .db and current .db.gz files."""
    if not BACKUP_DIR.exists():
        return []
    entries = [e for f in BACKUP_DIR.iterdir() if (e := _parse_entry(f)) is not None]
    entries.sort(key=lambda e: e["created_at"], reverse=True)
    return entries


def _cleanup_stale() -> None:
    """
    Keep BACKUP_DIR holding only finished .db.gz files by clearing intermediates
    left behind by interrupted runs. Safe to call before every backup:
      • *.db.tmp / *.db.tmp-journal — in-progress snapshot from this module
      • *.db-journal                — orphaned SQLite journal from a failed backup
    """
    if not BACKUP_DIR.exists():
        return
    for f in BACKUP_DIR.iterdir():
        if f.name.endswith((".db.tmp", ".db.tmp-journal", ".db-journal")):
            try:
                f.unlink(missing_ok=True)
            except OSError as exc:
                log.warning("Failed to remove stale backup artifact %s: %s", f.name, exc)


async def create_backup(db_path: str) -> dict:
    """
    Hot backup via aiosqlite backup API, then gzip-compressed.
    Saves as backups/recon_{YYYYMMDD_HHMMSS}.db.gz

    The uncompressed snapshot is written to a temporary .db.tmp file (never
    listed as a backup) and is always removed — even on cancellation or error —
    so BACKUP_DIR only ever holds finished .db.gz files.
    Returns the backup entry dict.
    """
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_stale()
    ts       = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    tmp_dest = BACKUP_DIR / f"recon_{ts}.db.tmp"
    gz_dest  = BACKUP_DIR / f"recon_{ts}.db.gz"
    success  = False
    try:
        src = await aiosqlite.connect(db_path)
        dst = await aiosqlite.connect(str(tmp_dest))
        try:
            await src.backup(dst)
        finally:
            await dst.close()
            await src.close()

        with tmp_dest.open("rb") as f_in, gzip.open(gz_dest, "wb", compresslevel=6) as f_out:
            shutil.copyfileobj(f_in, f_out)

        size = gz_dest.stat().st_size
        log.info("Backup created: %s (%d bytes compressed)", gz_dest.name, size)
        success = True
        return {"filename": gz_dest.name, "size_bytes": size, "created_at": ts}
    except Exception as exc:
        log.error("Backup failed: %s", exc)
        raise
    finally:
        tmp_dest.unlink(missing_ok=True)
        (BACKUP_DIR / f"{tmp_dest.name}-journal").unlink(missing_ok=True)
        if not success:
            gz_dest.unlink(missing_ok=True)  # drop partial/corrupt .gz from an interrupted run


def enforce_retention(keep: int = 3) -> int:
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
