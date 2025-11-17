-- Migration: Add unique constraint for parkrun_athlete_id duplicate prevention
-- This adds a partial unique index that prevents duplicates when parkrun_athlete_id is available
-- The existing UNIQUE(athlete_name, event_name, event_number, date) remains as fallback

-- Add unique index for records with parkrun_athlete_id
-- This enforces: one result per athlete ID + event + date
CREATE UNIQUE INDEX IF NOT EXISTS idx_parkrun_unique_athlete_id_event_date
ON parkrun_results(parkrun_athlete_id, event_name, date)
WHERE parkrun_athlete_id IS NOT NULL;
