-- ============================================================
-- Migration 010 — Add pipeline_template column to targets
-- Tracks which template name was used to initialise the target's
-- pipeline so "reset" and "switch template" know the source.
-- ============================================================
ALTER TABLE targets ADD COLUMN pipeline_template TEXT NOT NULL DEFAULT 'standard';
