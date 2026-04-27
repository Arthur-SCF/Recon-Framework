#!/bin/bash
# SQLite hot backup — safe to run while the backend is live (WAL mode).
# Uses SQLite's .backup command which produces a consistent snapshot even
# with concurrent writes.
#
# Usage:
#   bash /app/scripts/backup.sh
#
# Environment variables (all optional):
#   DB_PATH         — path to recon.db      (default: /data/recon.db)
#   BACKUP_DIR      — directory for backups  (default: /data/backups)
#   RETENTION_DAYS  — days to keep backups   (default: 7)

set -euo pipefail

DB_PATH="${DB_PATH:-/data/recon.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEST="${BACKUP_DIR}/recon-${TIMESTAMP}.db"

if [ ! -f "$DB_PATH" ]; then
  echo "[ERROR] Database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# SQLite .backup is atomic and WAL-safe (flushes WAL frames into the backup)
sqlite3 "$DB_PATH" ".backup '${DEST}'"

SIZE=$(du -sh "$DEST" 2>/dev/null | cut -f1)
echo "[$(date -Iseconds)] Backup complete: ${DEST} (${SIZE})"

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "recon-*.db" -mtime +"${RETENTION_DAYS}" -delete

REMAINING=$(find "$BACKUP_DIR" -name "recon-*.db" | wc -l)
echo "[$(date -Iseconds)] Retention: kept last ${REMAINING} backup(s) (>${RETENTION_DAYS}d pruned)"
