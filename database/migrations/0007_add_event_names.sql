-- Add event_name column to races table
ALTER TABLE races ADD COLUMN event_name TEXT;

-- Create event_suggestions table for AI-generated event name suggestions
CREATE TABLE IF NOT EXISTS event_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_ids TEXT NOT NULL, -- JSON array of race IDs in this group
  suggested_event_name TEXT NOT NULL,
  avg_date TEXT NOT NULL, -- Average date of races in group (for display)
  avg_distance INTEGER NOT NULL, -- Average distance in meters
  race_count INTEGER NOT NULL, -- Number of races in this suggestion
  confidence REAL DEFAULT 0.5, -- AI confidence score (0-1)
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by INTEGER, -- athlete_id of reviewer
  FOREIGN KEY (reviewed_by) REFERENCES athletes(id)
);

-- Create index on status for faster queries
CREATE INDEX idx_event_suggestions_status ON event_suggestions(status);

-- Create index on event_name for faster lookups
CREATE INDEX idx_races_event_name ON races(event_name);
