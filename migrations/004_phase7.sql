-- ============================================================
-- Migration 004 — Phase 7: cloud_enum and s3scanner result tables
-- Forward-only: never modify this file.
-- ============================================================

-- Cloud asset discovery results (cloud_enum)
CREATE TABLE IF NOT EXISTS cloud_enum_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    asset_type  TEXT,       -- 's3', 'azure', 'gcp', 'generic'
    url         TEXT NOT NULL,
    keyword     TEXT,
    found_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(step_run_id, url)
);
CREATE INDEX IF NOT EXISTS idx_cloud_enum_target ON cloud_enum_results(target_id);
CREATE INDEX IF NOT EXISTS idx_cloud_enum_session ON cloud_enum_results(session_id);

-- S3 bucket misconfiguration results (s3scanner)
CREATE TABLE IF NOT EXISTS s3scanner_results (
    id           TEXT PRIMARY KEY,
    step_run_id  TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    target_id    TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    bucket_name    TEXT NOT NULL,
    region         TEXT,
    bucket_exists  INTEGER,      -- 0/1 boolean
    public_read    INTEGER,      -- 0/1
    public_write INTEGER,        -- 0/1
    url          TEXT,
    found_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(step_run_id, bucket_name)
);
CREATE INDEX IF NOT EXISTS idx_s3scanner_target ON s3scanner_results(target_id);
CREATE INDEX IF NOT EXISTS idx_s3scanner_session ON s3scanner_results(session_id);
