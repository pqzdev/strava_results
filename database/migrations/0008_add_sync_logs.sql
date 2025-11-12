-- Migration to add sync_logs table for monitoring sync progress
CREATE TABLE IF NOT EXISTS sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  sync_session_id TEXT NOT NULL,
  log_level TEXT NOT NULL, -- 'info', 'warning', 'error', 'success'
  message TEXT NOT NULL,
  metadata TEXT, -- JSON string for additional data
  created_at INTEGER NOT NULL,
  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_athlete_session
  ON sync_logs(athlete_id, sync_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_session
  ON sync_logs(sync_session_id, created_at DESC);
