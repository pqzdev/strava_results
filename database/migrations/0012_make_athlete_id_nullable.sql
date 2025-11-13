-- Migration: Make athlete_id nullable for manual submissions
-- Manual submissions may not have an associated athlete in the system

-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table
-- First, create a temporary backup of the races table
CREATE TABLE races_backup AS SELECT * FROM races;

-- Drop the old table and its indexes
DROP TABLE races;

-- Recreate races table with nullable athlete_id
-- Note: Only include columns that exist at this point in migration history
CREATE TABLE races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER, -- Changed from NOT NULL to nullable
    strava_activity_id INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    distance REAL NOT NULL, -- meters
    elapsed_time INTEGER NOT NULL, -- seconds
    moving_time INTEGER NOT NULL, -- seconds
    date TEXT NOT NULL, -- ISO 8601 format
    elevation_gain REAL, -- meters
    average_heartrate REAL,
    max_heartrate REAL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    manual_time INTEGER,
    manual_distance INTEGER,
    event_name TEXT,
    polyline TEXT,
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Restore the data
INSERT INTO races SELECT * FROM races_backup;

-- Drop the backup table
DROP TABLE races_backup;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_races_athlete_id ON races(athlete_id);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date DESC);
CREATE INDEX IF NOT EXISTS idx_races_distance ON races(distance);
CREATE INDEX IF NOT EXISTS idx_races_strava_activity_id ON races(strava_activity_id);
CREATE INDEX IF NOT EXISTS idx_races_event_name ON races(event_name);
