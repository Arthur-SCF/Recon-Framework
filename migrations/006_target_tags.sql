-- Migration 006: target tags
CREATE TABLE IF NOT EXISTS target_tags (
    id          TEXT PRIMARY KEY,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    tag         TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(target_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_target_tags_target ON target_tags(target_id);
CREATE INDEX IF NOT EXISTS idx_target_tags_tag    ON target_tags(tag);
