-- WOOD-8: Add batched sync support for handling athletes with large activity datasets
-- This migration creates the infrastructure for processing syncs in independent batches

-- Create sync_batches table to track individual batch jobs
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
CREATE INDEX IF NOT EXISTS idx_sync_batches_session
  ON sync_batches(sync_session_id, batch_number);

CREATE INDEX IF NOT EXISTS idx_sync_batches_athlete_status
  ON sync_batches(athlete_id, status);

CREATE INDEX IF NOT EXISTS idx_sync_batches_pending
  ON sync_batches(status, created_at) WHERE status = 'pending';

-- Add batch-aware sync tracking columns to athletes table
ALTER TABLE athletes ADD COLUMN current_batch_number INTEGER DEFAULT 0;
ALTER TABLE athletes ADD COLUMN total_batches_expected INTEGER;
ALTER TABLE athletes ADD COLUMN sync_session_id TEXT;
