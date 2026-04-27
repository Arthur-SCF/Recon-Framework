CREATE TABLE IF NOT EXISTS report_schedules (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    target_id    TEXT,           -- NULL = global (all targets)
    frequency    TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly')),
    day_of_week  INTEGER,        -- 0=Mon..6=Sun, NULL if daily
    hour         INTEGER NOT NULL DEFAULT 9,  -- UTC hour (0-23)
    channel_id   TEXT,           -- NULL = broadcast to all enabled channels
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT,           -- ISO8601 UTC of last dispatch
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
