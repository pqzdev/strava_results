-- Add performance indexes for frequently queried columns
-- These indexes will significantly reduce row reads for common queries

-- Parkrun results table indexes
CREATE INDEX IF NOT EXISTS idx_parkrun_results_athlete_name ON parkrun_results(athlete_name);
CREATE INDEX IF NOT EXISTS idx_parkrun_results_date ON parkrun_results(date);
CREATE INDEX IF NOT EXISTS idx_parkrun_results_event_name ON parkrun_results(event_name);
CREATE INDEX IF NOT EXISTS idx_parkrun_results_athlete_date ON parkrun_results(athlete_name, date);

-- Parkrun athletes table index
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_name ON parkrun_athletes(athlete_name);

-- Races table indexes
CREATE INDEX IF NOT EXISTS idx_races_athlete_id ON races(athlete_id);
CREATE INDEX IF NOT EXISTS idx_races_strava_activity_id ON races(strava_activity_id);
CREATE INDEX IF NOT EXISTS idx_races_event_name ON races(event_name);
CREATE INDEX IF NOT EXISTS idx_races_date ON races(date);

-- Sync batches index for batch progress lookups
CREATE INDEX IF NOT EXISTS idx_sync_batches_session_id ON sync_batches(sync_session_id);

-- Activity event mappings index
CREATE INDEX IF NOT EXISTS idx_activity_event_mappings_activity ON activity_event_mappings(strava_activity_id, athlete_id);
