-- Migration: Add is_hidden column to activity_event_mappings
-- This ensures manual visibility changes persist across full syncs

ALTER TABLE activity_event_mappings ADD COLUMN is_hidden INTEGER;
-- NULL means not manually set, 0/1 means user explicitly set it

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_activity_event_mappings_hidden
ON activity_event_mappings(is_hidden) WHERE is_hidden IS NOT NULL;
