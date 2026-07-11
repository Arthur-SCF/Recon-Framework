-- ============================================================
-- Migration 017 — Non-destructive scope flags
--
-- Scope rules (include/exclude) previously only filtered NEW subdomains at
-- consolidation time; nothing re-applied them to already-discovered data, so
-- an exclude rule added after a scan had no effect — the out-of-scope host
-- stayed in live_hosts and kept generating notifications.
--
-- This adds a non-destructive `in_scope` flag to both unified result tables:
--
--     in_scope = 1  → in scope (default; unchanged behaviour)
--     in_scope = 0  → out of scope: hidden from every UI/report read,
--                     skipped by all probing tools, and never notified.
--
-- Rows are NEVER deleted for scope — only the flag flips, so removing a rule
-- restores visibility. The flag is (re)computed by
-- engine.pipeline.scope_service.reapply_scope whenever a scope rule changes,
-- and at write time by consolidation (subdomains) and httpx (live_hosts).
--
-- Existing rows default to in_scope = 1; a one-time reapply runs at startup
-- for targets that already have scope_rules (see engine/app.py lifespan).
--
-- Forward-only: never modify this file. Add new migrations instead.
-- ============================================================

ALTER TABLE subdomains ADD COLUMN in_scope INTEGER NOT NULL DEFAULT 1;
ALTER TABLE live_hosts ADD COLUMN in_scope INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_subdomains_scope ON subdomains(target_id, in_scope);
CREATE INDEX IF NOT EXISTS idx_live_hosts_scope ON live_hosts(target_id, in_scope);
