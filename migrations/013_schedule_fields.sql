-- Migration 013: granular scheduling fields
-- Adds per-target schedule mode (hourly / daily / weekly) with time-of-day support.
-- Existing targets default to 'hourly' which preserves the current rescan_interval behaviour.

ALTER TABLE targets ADD COLUMN schedule_mode    TEXT    NOT NULL DEFAULT 'hourly';
ALTER TABLE targets ADD COLUMN schedule_days    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE targets ADD COLUMN schedule_weekday INTEGER NOT NULL DEFAULT 0;  -- 0=Mon … 6=Sun
ALTER TABLE targets ADD COLUMN schedule_hour    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE targets ADD COLUMN schedule_minute  INTEGER NOT NULL DEFAULT 0;
