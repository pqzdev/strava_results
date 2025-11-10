-- Migration: Add parkrun results tables
-- This migration adds support for parkrun club results tracking

-- Parkrun results table: stores parkrun results for the club
CREATE TABLE IF NOT EXISTS parkrun_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_name TEXT NOT NULL,
    parkrun_athlete_id TEXT, -- parkrun athlete ID if available
    event_name TEXT NOT NULL,
    event_number INTEGER NOT NULL,
    position INTEGER NOT NULL,
    time_seconds INTEGER NOT NULL, -- race time in seconds
    time_string TEXT NOT NULL, -- original time format (MM:SS or HH:MM:SS)
    age_grade TEXT, -- age grade percentage
    age_category TEXT, -- age category (e.g., SM25-29)
    date TEXT NOT NULL, -- ISO 8601 format
    club_name TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    -- Unique constraint to prevent duplicate results
    UNIQUE(athlete_name, event_name, event_number, date)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_parkrun_athlete_name ON parkrun_results(athlete_name);
CREATE INDEX IF NOT EXISTS idx_parkrun_date ON parkrun_results(date DESC);
CREATE INDEX IF NOT EXISTS idx_parkrun_event ON parkrun_results(event_name);
CREATE INDEX IF NOT EXISTS idx_parkrun_time ON parkrun_results(time_seconds);

-- Parkrun sync logs table: track parkrun sync operations
CREATE TABLE IF NOT EXISTS parkrun_sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_started_at INTEGER NOT NULL,
    sync_completed_at INTEGER,
    club_num INTEGER NOT NULL,
    results_fetched INTEGER DEFAULT 0,
    new_results_added INTEGER DEFAULT 0,
    errors_encountered INTEGER DEFAULT 0,
    status TEXT NOT NULL, -- 'running', 'completed', 'failed'
    error_message TEXT
);

-- Create index on parkrun sync timestamps
CREATE INDEX IF NOT EXISTS idx_parkrun_sync_logs_started ON parkrun_sync_logs(sync_started_at DESC);

-- Parkrun athletes table: manage visibility of parkrun athletes in the dashboard
CREATE TABLE IF NOT EXISTS parkrun_athletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_name TEXT UNIQUE NOT NULL,
    is_hidden INTEGER DEFAULT 0, -- 0 = visible, 1 = hidden
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Create index on athlete name
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_name ON parkrun_athletes(athlete_name);
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_hidden ON parkrun_athletes(is_hidden);
