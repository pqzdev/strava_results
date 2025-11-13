-- Migration: Add athlete profile photo to manual submissions
-- Store the athlete's profile photo URL from Strava so it can be displayed without needing an athlete record

ALTER TABLE manual_submissions ADD COLUMN athlete_profile_photo TEXT;
