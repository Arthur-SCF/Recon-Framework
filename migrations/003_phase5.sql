-- ============================================================
-- Migration 003 — Phase 5: Active Discovery
-- Adds wildcard_skip column to scan_sessions.
-- Forward-only: never modify this file. Add new migrations instead.
-- ============================================================

ALTER TABLE scan_sessions ADD COLUMN wildcard_skip INTEGER NOT NULL DEFAULT 0;
