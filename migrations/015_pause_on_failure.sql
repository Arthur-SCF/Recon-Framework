-- migrations/015_pause_on_failure.sql
-- Adds per-target auto-pause flag: when enabled, the pipeline pauses
-- automatically after a step exhausts all retries with an error status.

ALTER TABLE targets ADD COLUMN pause_on_failure INTEGER NOT NULL DEFAULT 0;
