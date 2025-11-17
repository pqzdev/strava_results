-- Create parkrun event name mappings table
-- This table stores standardized event name mappings to ensure consistency

CREATE TABLE IF NOT EXISTS parkrun_event_name_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name TEXT NOT NULL UNIQUE,
  to_name TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  notes TEXT
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_parkrun_event_mappings_from_name
ON parkrun_event_name_mappings(from_name);

-- Insert initial mappings
INSERT INTO parkrun_event_name_mappings (from_name, to_name, notes) VALUES
  ('Albert Melbourne', 'Albert, Melbourne', 'Add proper location formatting'),
  ('Bushy Park', 'Bushy', 'Standardize name'),
  ('Kingsway', 'Kingsway, Gloucester', 'Add location for clarity'),
  ('Presint 18', 'Presint 18, Putrajaya', 'Add location for clarity')
ON CONFLICT(from_name) DO UPDATE SET
  to_name = excluded.to_name,
  notes = excluded.notes;
