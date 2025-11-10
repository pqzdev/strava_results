-- Add manual_distance column to races table
-- Allows athletes to manually set/correct race distance in meters
-- NULL means use the distance from Strava activity

ALTER TABLE races ADD COLUMN manual_distance INTEGER; -- distance in meters, NULL if not manually set
