-- ============================================================
-- Migration 016 — Programs (folders of wildcard assets)
--
-- Introduces a parent "program" entity above targets. A target
-- becomes an "asset" of a program when targets.program_id is set;
-- targets with program_id = NULL remain standalone (unchanged behaviour).
--
-- Design notes:
--   • Deleting a program ORPHANS its assets (ON DELETE SET NULL) —
--     no recon data is ever lost by deleting a folder.
--   • Config inheritance is materialise-on-write: a program holds
--     DEFAULT policy columns; an asset with config_source='inherit'
--     keeps synced copies of them on its own targets row, so the
--     scheduler keeps reading targets columns unchanged.
--   • Program-scan runs are tracked in program_scan_sessions +
--     program_scan_assets for progress rollup and notification
--     coalescing.
--
-- Forward-only: never modify this file. Add new migrations instead.
-- ============================================================

-- ── Programs (folders) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS programs (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    description      TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

    -- Notification granularity for this program's assets:
    --   'program' — coalesce: suppress noisy per-asset external pushes,
    --               emit one program-level summary per program scan.
    --   'asset'   — per-asset (legacy behaviour, one push per asset event).
    notify_scope     TEXT NOT NULL DEFAULT 'program',   -- 'program' | 'asset'

    -- DEFAULT scan/policy config inherited by assets with
    -- config_source='inherit' (materialised onto the asset's own columns).
    pipeline_template TEXT    NOT NULL DEFAULT 'standard',
    scan_priority     INTEGER NOT NULL DEFAULT 5,
    rescan_interval   INTEGER NOT NULL DEFAULT 24,
    manual_only       INTEGER NOT NULL DEFAULT 0,
    loop              INTEGER NOT NULL DEFAULT 0,
    wildcard_policy   TEXT    NOT NULL DEFAULT 'skip',
    retention_runs    INTEGER NOT NULL DEFAULT 5,
    schedule_mode     TEXT    NOT NULL DEFAULT 'hourly',
    schedule_days     INTEGER NOT NULL DEFAULT 1,
    schedule_weekday  INTEGER NOT NULL DEFAULT 0,
    schedule_hour     INTEGER NOT NULL DEFAULT 0,
    schedule_minute   INTEGER NOT NULL DEFAULT 0
);

-- ── Link targets → program ──────────────────────────────────────────────────
-- Nullable FK: NULL = standalone target. ON DELETE SET NULL = orphan on
-- program delete. Default NULL is required for SQLite ADD COLUMN + REFERENCES.
ALTER TABLE targets ADD COLUMN program_id TEXT REFERENCES programs(id) ON DELETE SET NULL;

-- Whether this asset inherits its program's config or overrides it.
-- Default 'override' preserves every existing target's own config exactly.
ALTER TABLE targets ADD COLUMN config_source TEXT NOT NULL DEFAULT 'override';  -- 'inherit' | 'override'

-- ── Program scope on notifications ──────────────────────────────────────────
-- Nullable: stamped from the asset's program at creation time so the feed and
-- external routing can group/coalesce by program.
ALTER TABLE notifications ADD COLUMN program_id TEXT REFERENCES programs(id) ON DELETE SET NULL;

-- ── Program scan runs (fan-out rollup) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_scan_sessions (
    id           TEXT PRIMARY KEY,
    program_id   TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    finished_at  TEXT,
    status       TEXT NOT NULL DEFAULT 'running',  -- running | completed | cancelled
    asset_total  INTEGER NOT NULL DEFAULT 0,
    asset_done   INTEGER NOT NULL DEFAULT 0,
    stats        TEXT     -- JSON rollup: {new_subdomains, new_hosts, changed_hosts, gone_hosts, takeovers}
);

CREATE TABLE IF NOT EXISTS program_scan_assets (
    id                 TEXT PRIMARY KEY,
    program_session_id TEXT NOT NULL REFERENCES program_scan_sessions(id) ON DELETE CASCADE,
    target_id          TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    session_id         TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    status             TEXT NOT NULL DEFAULT 'queued',  -- queued | running | completed | error | cancelled
    UNIQUE(program_session_id, target_id)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_targets_program            ON targets(program_id);
CREATE INDEX IF NOT EXISTS idx_notifications_program      ON notifications(program_id);
CREATE INDEX IF NOT EXISTS idx_program_scan_sessions_prog ON program_scan_sessions(program_id, status);
CREATE INDEX IF NOT EXISTS idx_program_scan_assets_run    ON program_scan_assets(program_session_id);
CREATE INDEX IF NOT EXISTS idx_program_scan_assets_target ON program_scan_assets(target_id);
