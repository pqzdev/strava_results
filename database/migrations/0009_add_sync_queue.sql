-- Migration to add sync_queue table for reliable batched activity downloads
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'full_sync', -- 'full_sync' or 'incremental_sync'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 0, -- Higher = more urgent
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Pagination state for resumable syncs
  last_processed_before INTEGER, -- Unix timestamp for pagination cursor
  activities_synced INTEGER DEFAULT 0,
  total_activities_expected INTEGER, -- Estimate, can be null

  -- Sync session tracking
  sync_session_id TEXT, -- Links to sync_logs for detailed logging

  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Index for efficient job claiming (most important query)
CREATE INDEX IF NOT EXISTS idx_sync_queue_claim
  ON sync_queue(status, priority DESC, created_at ASC)
  WHERE status = 'pending';

-- Index for athlete-specific queries
CREATE INDEX IF NOT EXISTS idx_sync_queue_athlete
  ON sync_queue(athlete_id, status, created_at DESC);

-- Index for monitoring and cleanup
CREATE INDEX IF NOT EXISTS idx_sync_queue_completed
  ON sync_queue(completed_at DESC)
  WHERE status IN ('completed', 'failed');
