-- Add description column to races table to store Strava activity descriptions
ALTER TABLE races ADD COLUMN description TEXT;

-- Create index for searching by description
CREATE INDEX IF NOT EXISTS idx_races_description ON races(description);
