-- Fix partially applied migrations by completing safe operations
-- and marking them as applied in d1_migrations table

-- ============================================================
-- Migration 0013: Add manual_submissions table and indexes
-- ============================================================

-- Create table if not exists
CREATE TABLE IF NOT EXISTS manual_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_session_id TEXT NOT NULL,
  strava_activity_id INTEGER NOT NULL UNIQUE,
  strava_url TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  activity_name TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  date TEXT NOT NULL,
  original_distance REAL,
  original_time_seconds INTEGER,
  original_elevation_gain REAL,
  edited_distance REAL,
  edited_time_seconds INTEGER,
  edited_elevation_gain REAL,
  event_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at INTEGER NOT NULL,
  processed_at INTEGER,
  notes TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_manual_submissions_session ON manual_submissions(submission_session_id);
CREATE INDEX IF NOT EXISTS idx_manual_submissions_status ON manual_submissions(status);
CREATE INDEX IF NOT EXISTS idx_manual_submissions_strava_id ON manual_submissions(strava_activity_id);

-- Mark migration 0013 as applied
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (17, '0013_add_manual_submissions.sql', strftime('%s', 'now'));

-- ============================================================
-- Migration 0014: Add athlete_profile_photo to manual_submissions
-- ============================================================

-- Column already exists, just mark as applied
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (18, '0014_add_athlete_profile_photo_to_submissions.sql', strftime('%s', 'now'));

-- ============================================================
-- Migration 0015: Make OAuth tokens nullable
-- ============================================================

-- This migration recreates the athletes table, which is complex
-- Since the table already has the correct structure, just mark as applied
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (19, '0015_make_oauth_tokens_nullable.sql', strftime('%s', 'now'));

-- ============================================================
-- Migration 0017: Add admin_users table
-- ============================================================

-- Create table if not exists
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  google_id TEXT,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- Add initial admins
INSERT OR IGNORE INTO admin_users (email, name) VALUES ('pedroqueiroz@gmail.com', 'Pedro Queiroz');
INSERT OR IGNORE INTO admin_users (email, name) VALUES ('woodstockresults@gmail.com', 'Woodstock Results');

-- Mark migration 0017 as applied
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (20, '0017_add_admin_users_table.sql', strftime('%s', 'now'));

-- ============================================================
-- Migration 0018: Add is_hidden to races
-- ============================================================

-- Create index
CREATE INDEX IF NOT EXISTS idx_races_is_hidden ON races(is_hidden);

-- Mark migration 0018 as applied
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (21, '0018_add_race_visibility.sql', strftime('%s', 'now'));

-- ============================================================
-- Migration 0019: Add description to races
-- ============================================================

-- Create index
CREATE INDEX IF NOT EXISTS idx_races_description ON races(description);

-- Mark migration 0019 as applied
INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (22, '0019_add_race_description.sql', strftime('%s', 'now'));
