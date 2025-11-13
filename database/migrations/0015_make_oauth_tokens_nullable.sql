-- Migration: Make OAuth tokens nullable for manual submission athletes
-- Manual submissions create athletes without OAuth tokens since they don't have API access

-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table
-- First, disable foreign key constraints temporarily
PRAGMA foreign_keys=OFF;

CREATE TABLE athletes_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strava_id INTEGER UNIQUE NOT NULL,
    firstname TEXT NOT NULL,
    lastname TEXT NOT NULL,
    profile_photo TEXT,
    access_token TEXT,  -- Changed from NOT NULL to nullable
    refresh_token TEXT,  -- Changed from NOT NULL to nullable
    token_expiry INTEGER,  -- Changed from NOT NULL to nullable
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_synced_at INTEGER,
    is_admin INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    is_blocked INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'pending',
    sync_error TEXT,
    total_activities_count INTEGER DEFAULT 0
);

-- Copy data from old table
INSERT INTO athletes_new SELECT * FROM athletes;

-- Drop old table
DROP TABLE athletes;

-- Rename new table
ALTER TABLE athletes_new RENAME TO athletes;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_athletes_strava_id ON athletes(strava_id);

-- Re-enable foreign key constraints
PRAGMA foreign_keys=ON;
