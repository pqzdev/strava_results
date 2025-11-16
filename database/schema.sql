-- Strava Running Club Aggregator - D1 Database Schema

-- Athletes table: stores connected Strava users and their OAuth tokens
CREATE TABLE IF NOT EXISTS athletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strava_id INTEGER UNIQUE NOT NULL,
    firstname TEXT NOT NULL,
    lastname TEXT NOT NULL,
    profile_photo TEXT,
    access_token TEXT,  -- Nullable for manual submission athletes
    refresh_token TEXT, -- Nullable for manual submission athletes
    token_expiry INTEGER, -- Unix timestamp, nullable
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_synced_at INTEGER, -- Last successful activity fetch
    is_admin INTEGER DEFAULT 0, -- 0 = false, 1 = true
    is_hidden INTEGER DEFAULT 0, -- Hide from public results
    is_blocked INTEGER DEFAULT 0, -- Prevent registration
    sync_status TEXT DEFAULT 'pending', -- pending, in_progress, completed, error
    sync_error TEXT, -- Error message if sync failed
    total_activities_count INTEGER DEFAULT 0, -- Total activities fetched (not just races)
    current_batch_number INTEGER DEFAULT 0, -- WOOD-8: Current batch being processed
    total_batches_expected INTEGER, -- WOOD-8: Total number of batches expected
    sync_session_id TEXT -- WOOD-8: Active sync session ID
);

-- Create index on strava_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_athletes_strava_id ON athletes(strava_id);

-- Races table: stores race activities from all connected athletes
CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
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
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_races_athlete_id ON races(athlete_id);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date DESC);
CREATE INDEX IF NOT EXISTS idx_races_distance ON races(distance);
CREATE INDEX IF NOT EXISTS idx_races_strava_activity_id ON races(strava_activity_id);

-- Sync logs table: track sync operations and rate limit usage
CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_started_at INTEGER NOT NULL,
    sync_completed_at INTEGER,
    athletes_processed INTEGER DEFAULT 0,
    activities_fetched INTEGER DEFAULT 0,
    new_races_added INTEGER DEFAULT 0,
    errors_encountered INTEGER DEFAULT 0,
    rate_limit_remaining INTEGER, -- Strava API rate limit at end of sync
    status TEXT NOT NULL, -- 'running', 'completed', 'failed'
    error_message TEXT
);

-- Create index on sync timestamps
CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(sync_started_at DESC);

-- WOOD-8: Sync batches table: track individual batch jobs for handling large activity datasets
CREATE TABLE IF NOT EXISTS sync_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Association
    athlete_id INTEGER NOT NULL,
    sync_session_id TEXT NOT NULL,  -- Links all batches in a sync
    batch_number INTEGER NOT NULL,
    -- Pagination state
    before_timestamp INTEGER,       -- Pagination cursor (where this batch started)
    after_timestamp INTEGER,        -- For incremental syncs
    -- Batch results
    activities_fetched INTEGER DEFAULT 0,
    races_added INTEGER DEFAULT 0,
    races_removed INTEGER DEFAULT 0,
    -- Status tracking
    status TEXT NOT NULL,           -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    started_at INTEGER,
    completed_at INTEGER,
    error_message TEXT,
    -- Metadata
    strava_rate_limit_15min INTEGER,
    strava_rate_limit_daily INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Indexes for efficient batch queries
CREATE INDEX IF NOT EXISTS idx_sync_batches_session ON sync_batches(sync_session_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_sync_batches_athlete_status ON sync_batches(athlete_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_batches_pending ON sync_batches(status, created_at) WHERE status = 'pending';

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
