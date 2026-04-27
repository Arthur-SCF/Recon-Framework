-- ============================================================
-- Migration 001 — Initial Schema
-- Creates all tables, indexes, and default pipeline template seed.
-- Forward-only: never modify this file. Add new migrations instead.
-- ============================================================

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS targets (
    id               TEXT PRIMARY KEY,
    domain           TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL DEFAULT 'idle',  -- idle/running/completed/paused/error
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    last_scan_at     TEXT,
    scan_count       INTEGER NOT NULL DEFAULT 0,
    retention_runs   INTEGER NOT NULL DEFAULT 5,    -- how many raw scan sessions to keep
    retention_all    INTEGER NOT NULL DEFAULT 0,    -- 0=false, 1=true: keep everything
    scan_priority    INTEGER NOT NULL DEFAULT 5,    -- 1 (low) to 10 (high)
    rescan_interval  INTEGER NOT NULL DEFAULT 24,   -- hours between auto-rescans
    manual_only      INTEGER NOT NULL DEFAULT 0,    -- 0=false: never auto-scheduled
    loop             INTEGER NOT NULL DEFAULT 0,    -- 0=false: continuous recon mode
    wildcard_policy  TEXT NOT NULL DEFAULT 'skip'   -- 'skip' | 'force' | 'ask'
);

CREATE TABLE IF NOT EXISTS scan_sessions (
    id              TEXT PRIMARY KEY,
    target_id       TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running', -- running/paused/completed/cancelled/error
    current_step    TEXT,
    paused_at       TEXT,
    pause_type      TEXT,    -- 'manual' | 'auto' | 'auto_recovery' | 'shutdown'
    resume_after    TEXT REFERENCES targets(id) ON DELETE SET NULL,
    stats           TEXT     -- JSON: {new_subdomains, new_hosts, changed_hosts, gone_hosts}
);

CREATE TABLE IF NOT EXISTS step_runs (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
    target_id       TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    step_id         TEXT NOT NULL,   -- e.g. 'amass', 'httpx_r1', 'consolidate_r1'
    tool_id         TEXT NOT NULL,   -- registry key e.g. 'amass', 'httpx', 'consolidate_r1'
    status          TEXT NOT NULL DEFAULT 'pending', -- pending/running/success/error/timeout/skipped
    command         TEXT,            -- JSON array of command args (null for actions)
    stdout_path     TEXT,
    stderr_snippet  TEXT,            -- first 2000 chars for quick debug view
    result_count    INTEGER,
    started_at      TEXT,
    finished_at     TEXT,
    execution_time  REAL             -- seconds
);

-- ============================================================
-- PIPELINE CONFIGURATION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_groups (
    id          TEXT PRIMARY KEY,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    name        TEXT NOT NULL,
    parallel    INTEGER NOT NULL DEFAULT 0,  -- 0=sequential, 1=parallel
    enabled     INTEGER NOT NULL DEFAULT 1,
    UNIQUE(target_id, position)
);

CREATE TABLE IF NOT EXISTS pipeline_steps (
    id               TEXT PRIMARY KEY,
    group_id         TEXT NOT NULL REFERENCES pipeline_groups(id) ON DELETE CASCADE,
    target_id        TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    position         INTEGER NOT NULL,
    step_id          TEXT NOT NULL,   -- references STEP_REGISTRY key
    enabled          INTEGER NOT NULL DEFAULT 1,
    config_overrides TEXT             -- JSON: per-step config overrides
);

CREATE TABLE IF NOT EXISTS pipeline_templates (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description  TEXT,
    config       TEXT NOT NULL,       -- JSON: full pipeline config (groups + steps)
    is_default   INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- UNIFIED RESULT TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS subdomains (
    id              TEXT PRIMARY KEY,
    target_id       TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain       TEXT NOT NULL,
    sources         TEXT,            -- JSON array of tool IDs that found it
    first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen       TEXT NOT NULL DEFAULT (datetime('now')),
    first_session   TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    is_live         INTEGER NOT NULL DEFAULT 0,
    consolidated_in TEXT,            -- JSON array: ["r1", "r2", "r3"]
    UNIQUE(target_id, subdomain)
);

CREATE TABLE IF NOT EXISTS live_hosts (
    id              TEXT PRIMARY KEY,
    target_id       TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain_id    TEXT REFERENCES subdomains(id) ON DELETE SET NULL,
    url             TEXT NOT NULL,
    -- HTTP
    status_code     INTEGER,
    title           TEXT,
    content_length  INTEGER,
    content_type    TEXT,
    -- Server
    webserver       TEXT,
    tech            TEXT,            -- JSON array
    -- Network
    host            TEXT,
    port            INTEGER,
    scheme          TEXT,
    final_url       TEXT,
    -- TLS
    tls_version     TEXT,
    tls_cipher      TEXT,
    tls_subject_cn  TEXT,
    tls_issuer      TEXT,
    tls_not_before  TEXT,
    tls_not_after   TEXT,
    tls_self_signed INTEGER,
    tls_expired     INTEGER,
    tls_mismatched  INTEGER,
    -- DNS
    cname           TEXT,
    cdn             TEXT,
    cdn_name        TEXT,
    a_records       TEXT,            -- JSON array
    aaaa_records    TEXT,            -- JSON array
    -- Response
    response_hash   TEXT,
    header_hash     TEXT,
    response_time   REAL,
    -- Security headers
    has_csp         INTEGER,
    has_xfo         INTEGER,
    has_xcto        INTEGER,
    has_hsts        INTEGER,
    -- Screenshot
    screenshot_path TEXT,
    -- WAF (optional, from wafw00f)
    waf             TEXT,
    -- Tracking
    first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen       TEXT NOT NULL DEFAULT (datetime('now')),
    last_status     INTEGER,
    last_title      TEXT,
    UNIQUE(target_id, url)
);

CREATE TABLE IF NOT EXISTS live_hosts_history (
    id            TEXT PRIMARY KEY,
    live_host_id  TEXT NOT NULL REFERENCES live_hosts(id) ON DELETE CASCADE,
    target_id     TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    session_id    TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    url           TEXT NOT NULL,
    event_type    TEXT NOT NULL,     -- 'discovered' | 'changed' | 'gone' | 'returned'
    status_code   INTEGER,
    title         TEXT,
    tech          TEXT,
    webserver     TEXT,
    response_hash TEXT,
    changes       TEXT,              -- JSON: {"field": {"old": x, "new": y}, ...}
    recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    target_id  TEXT REFERENCES targets(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,  -- 'new_subdomains'|'new_hosts'|'host_changed'|
                               -- 'host_gone'|'takeover_candidate'|'scan_complete'|'scan_error'
    title      TEXT NOT NULL,
    message    TEXT,
    data       TEXT,           -- JSON payload with details
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
    id         TEXT PRIMARY KEY,
    service    TEXT NOT NULL UNIQUE,  -- 'shodan', 'censys', 'securitytrails', etc.
    key_name   TEXT,
    key_value  TEXT NOT NULL,         -- Fernet-encrypted at rest
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scope_rules (
    id         TEXT PRIMARY KEY,
    target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    rule_type  TEXT NOT NULL,   -- 'include' | 'exclude'
    pattern    TEXT NOT NULL,   -- glob pattern e.g. '*.dev.example.com'
    priority   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- TOOL-SPECIFIC RESULT TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS amass_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    ip_addresses TEXT,           -- JSON array
    sources     TEXT,            -- JSON array ["CertSpotter", "GoogleCT"]
    tag         TEXT,            -- cert, dns, brute, etc.
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS subfinder_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS tlsx_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS assetfinder_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS ctl_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS gau_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    subdomain   TEXT,
    UNIQUE(step_run_id, url)
);

CREATE TABLE IF NOT EXISTS puredns_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    run_type    TEXT,            -- 'default' | 'custom' | 'permutation'
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS alterx_results (
    id               TEXT PRIMARY KEY,
    step_run_id      TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id       TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id        TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain        TEXT NOT NULL,
    source_subdomain TEXT,
    UNIQUE(step_run_id, subdomain)
);

CREATE TABLE IF NOT EXISTS naabu_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    host        TEXT NOT NULL,
    port        INTEGER NOT NULL,
    protocol    TEXT NOT NULL DEFAULT 'tcp',
    UNIQUE(step_run_id, host, port)
);

CREATE TABLE IF NOT EXISTS katana_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT,
    url         TEXT,
    source_url  TEXT,
    UNIQUE(step_run_id, url)
);

CREATE TABLE IF NOT EXISTS subdomainizer_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT,
    url         TEXT,
    source_url  TEXT,
    UNIQUE(step_run_id, url)
);

CREATE TABLE IF NOT EXISTS nuclei_takeover_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    subdomain   TEXT NOT NULL,
    url         TEXT,
    template_id TEXT,
    service     TEXT,
    severity    TEXT,
    matched_at  TEXT,
    verified    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(step_run_id, subdomain, template_id)
);

CREATE TABLE IF NOT EXISTS cewl_results (
    id          TEXT PRIMARY KEY,
    step_run_id TEXT NOT NULL REFERENCES step_runs(id) ON DELETE CASCADE,
    session_id  TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
    target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    word        TEXT NOT NULL,
    UNIQUE(step_run_id, word)
);

-- ============================================================
-- INDEXES (from BRAINSTORM section 21)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_subdomains_target     ON subdomains(target_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_target_sub ON subdomains(target_id, subdomain);
CREATE INDEX IF NOT EXISTS idx_subdomains_first_seen ON subdomains(target_id, first_seen);

CREATE INDEX IF NOT EXISTS idx_live_hosts_target     ON live_hosts(target_id);
CREATE INDEX IF NOT EXISTS idx_live_hosts_url        ON live_hosts(target_id, url);
CREATE INDEX IF NOT EXISTS idx_live_hosts_status     ON live_hosts(target_id, status_code);
CREATE INDEX IF NOT EXISTS idx_live_hosts_first_seen ON live_hosts(target_id, first_seen);
CREATE INDEX IF NOT EXISTS idx_live_hosts_last_seen  ON live_hosts(target_id, last_seen);

CREATE INDEX IF NOT EXISTS idx_history_target   ON live_hosts_history(target_id);
CREATE INDEX IF NOT EXISTS idx_history_session  ON live_hosts_history(session_id);
CREATE INDEX IF NOT EXISTS idx_history_type     ON live_hosts_history(target_id, event_type);
CREATE INDEX IF NOT EXISTS idx_history_recorded ON live_hosts_history(target_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_step_runs_session ON step_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_step_runs_target  ON step_runs(target_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_groups_target ON pipeline_groups(target_id, position);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_group   ON pipeline_steps(group_id, position);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_target  ON pipeline_steps(target_id);

CREATE INDEX IF NOT EXISTS idx_sessions_target ON scan_sessions(target_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON scan_sessions(status);

CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read, created_at);

CREATE INDEX IF NOT EXISTS idx_scope_rules_target ON scope_rules(target_id);

-- Tool-specific result table indexes
CREATE INDEX IF NOT EXISTS idx_amass_results_step    ON amass_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_amass_results_session ON amass_results(session_id);
CREATE INDEX IF NOT EXISTS idx_amass_results_target  ON amass_results(target_id);

CREATE INDEX IF NOT EXISTS idx_subfinder_results_step    ON subfinder_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_subfinder_results_session ON subfinder_results(session_id);
CREATE INDEX IF NOT EXISTS idx_subfinder_results_target  ON subfinder_results(target_id);

CREATE INDEX IF NOT EXISTS idx_tlsx_results_step    ON tlsx_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_tlsx_results_session ON tlsx_results(session_id);
CREATE INDEX IF NOT EXISTS idx_tlsx_results_target  ON tlsx_results(target_id);

CREATE INDEX IF NOT EXISTS idx_assetfinder_results_step    ON assetfinder_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_assetfinder_results_session ON assetfinder_results(session_id);
CREATE INDEX IF NOT EXISTS idx_assetfinder_results_target  ON assetfinder_results(target_id);

CREATE INDEX IF NOT EXISTS idx_ctl_results_step    ON ctl_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_ctl_results_session ON ctl_results(session_id);
CREATE INDEX IF NOT EXISTS idx_ctl_results_target  ON ctl_results(target_id);

CREATE INDEX IF NOT EXISTS idx_gau_results_step    ON gau_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_gau_results_session ON gau_results(session_id);
CREATE INDEX IF NOT EXISTS idx_gau_results_target  ON gau_results(target_id);

CREATE INDEX IF NOT EXISTS idx_puredns_results_step    ON puredns_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_puredns_results_session ON puredns_results(session_id);
CREATE INDEX IF NOT EXISTS idx_puredns_results_target  ON puredns_results(target_id);

CREATE INDEX IF NOT EXISTS idx_alterx_results_step    ON alterx_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_alterx_results_session ON alterx_results(session_id);
CREATE INDEX IF NOT EXISTS idx_alterx_results_target  ON alterx_results(target_id);

CREATE INDEX IF NOT EXISTS idx_naabu_results_step    ON naabu_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_naabu_results_session ON naabu_results(session_id);
CREATE INDEX IF NOT EXISTS idx_naabu_results_target  ON naabu_results(target_id);

CREATE INDEX IF NOT EXISTS idx_katana_results_step    ON katana_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_katana_results_session ON katana_results(session_id);
CREATE INDEX IF NOT EXISTS idx_katana_results_target  ON katana_results(target_id);

CREATE INDEX IF NOT EXISTS idx_subdomainizer_results_step    ON subdomainizer_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_subdomainizer_results_session ON subdomainizer_results(session_id);
CREATE INDEX IF NOT EXISTS idx_subdomainizer_results_target  ON subdomainizer_results(target_id);

CREATE INDEX IF NOT EXISTS idx_nuclei_takeover_results_step    ON nuclei_takeover_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_nuclei_takeover_results_session ON nuclei_takeover_results(session_id);
CREATE INDEX IF NOT EXISTS idx_nuclei_takeover_results_target  ON nuclei_takeover_results(target_id);

CREATE INDEX IF NOT EXISTS idx_cewl_results_step    ON cewl_results(step_run_id);
CREATE INDEX IF NOT EXISTS idx_cewl_results_session ON cewl_results(session_id);
CREATE INDEX IF NOT EXISTS idx_cewl_results_target  ON cewl_results(target_id);
