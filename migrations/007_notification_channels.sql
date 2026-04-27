CREATE TABLE IF NOT EXISTS notification_channels (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL CHECK(type IN ('discord', 'slack', 'generic')),
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    secret     TEXT,
    events     TEXT NOT NULL DEFAULT '["new_hosts","host_changed","host_gone","scan_complete","scan_error"]',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
