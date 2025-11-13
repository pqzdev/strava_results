-- Migration: Add athlete_strava_id to manual_submissions
-- Store the real Strava athlete ID extracted from the activity page

ALTER TABLE manual_submissions ADD COLUMN athlete_strava_id INTEGER;
