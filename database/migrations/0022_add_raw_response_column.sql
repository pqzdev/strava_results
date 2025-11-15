-- Migration: Add raw_response column to races table (WOOD-6)
-- This stores the full Strava API response for each activity
-- Enables future feature extraction without re-fetching from Strava API

ALTER TABLE races ADD COLUMN raw_response TEXT; -- Full JSON response from Strava API, NULL if not available

-- Note: Existing rows will have NULL raw_response
-- Use backfill script to populate from Strava API
