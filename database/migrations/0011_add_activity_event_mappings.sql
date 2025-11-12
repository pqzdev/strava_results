-- Migration: Add persistent activity event name mappings table
-- This stores event names separately so they persist across full syncs and activity deletions

CREATE TABLE IF NOT EXISTS activity_event_mappings (
    strava_activity_id INTEGER NOT NULL,
    athlete_id INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (strava_activity_id, athlete_id),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_activity_event_mappings_athlete
ON activity_event_mappings(athlete_id);

-- Migrate existing event names from races table to the new mapping table
INSERT OR IGNORE INTO activity_event_mappings (strava_activity_id, athlete_id, event_name)
SELECT strava_activity_id, athlete_id, event_name
FROM races
WHERE event_name IS NOT NULL;
