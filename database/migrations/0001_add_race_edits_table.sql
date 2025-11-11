-- Migration: Add race_edits table for persistent manual corrections
-- Created: 2025-11-10

-- Race edits table: stores manual corrections that persist across syncs
CREATE TABLE IF NOT EXISTS race_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strava_activity_id INTEGER NOT NULL,
    athlete_id INTEGER NOT NULL,
    manual_time INTEGER, -- Manual time in seconds (overrides moving_time)
    manual_distance REAL, -- Manual distance in meters (overrides distance)
    edited_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(strava_activity_id, athlete_id),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_race_edits_activity ON race_edits(strava_activity_id, athlete_id);
