-- migrations/014_error_handling.sql
-- Adds error classification + retry tracking to step_runs
-- Adds per-step retry configuration to pipeline_steps

ALTER TABLE step_runs ADD COLUMN error_category TEXT;
ALTER TABLE step_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pipeline_steps ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 1;
