-- Add is_hidden column to races table to allow users to hide activities
ALTER TABLE races ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_races_is_hidden ON races(is_hidden);
