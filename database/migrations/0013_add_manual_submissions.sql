-- Migration: Add manual submissions support
-- Allows users to manually submit Strava activity links when OAuth is unavailable

-- Manual submissions table
CREATE TABLE IF NOT EXISTS manual_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_session_id TEXT NOT NULL,
  strava_activity_id INTEGER NOT NULL UNIQUE,
  strava_url TEXT NOT NULL,

  -- Extracted data from Strava page
  athlete_name TEXT NOT NULL,
  activity_name TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  date TEXT NOT NULL,

  -- Original values (from Strava)
  original_distance REAL,
  original_time_seconds INTEGER,
  original_elevation_gain REAL,

  -- User-edited values
  edited_distance REAL,
  edited_time_seconds INTEGER,
  edited_elevation_gain REAL,

  -- Event classification
  event_name TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  submitted_at INTEGER NOT NULL,
  processed_at INTEGER,

  -- Notes
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_manual_submissions_session ON manual_submissions(submission_session_id);
CREATE INDEX IF NOT EXISTS idx_manual_submissions_status ON manual_submissions(status);
CREATE INDEX IF NOT EXISTS idx_manual_submissions_strava_id ON manual_submissions(strava_activity_id);

-- Add columns to races table to track manual submissions
-- Note: SQLite will error if column already exists, but CREATE TABLE IF NOT EXISTS above prevents issues on fresh installs
-- If migration fails here, the columns may already exist - check with: PRAGMA table_info(races);
-- Workaround: These may fail if already applied, which is okay
ALTER TABLE races ADD COLUMN source TEXT DEFAULT 'oauth'; -- 'oauth' or 'manual'
ALTER TABLE races ADD COLUMN manual_submission_id INTEGER REFERENCES manual_submissions(id);
