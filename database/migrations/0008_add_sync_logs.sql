-- Migration to add per-athlete sync_logs table for monitoring sync progress
-- The initial schema created a global sync_logs table; we're creating a new detailed sync log
CREATE TABLE IF NOT EXISTS athlete_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  sync_session_id TEXT NOT NULL,
  log_level TEXT NOT NULL, -- 'info', 'warning', 'error', 'success'
  message TEXT NOT NULL,
  metadata TEXT, -- JSON string for additional data
  created_at INTEGER NOT NULL,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_athlete_sync_logs_athlete_session
  ON athlete_sync_logs(athlete_id, sync_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_athlete_sync_logs_session
  ON athlete_sync_logs(sync_session_id, created_at DESC);
