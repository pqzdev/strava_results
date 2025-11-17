-- Migration: Add tracking for athletes who have left the parkrun club
-- Detects when an athlete's personal parkrun history shows runs after their last club run

-- Add columns to parkrun_athletes table to track club membership status
ALTER TABLE parkrun_athletes ADD COLUMN has_left_club INTEGER DEFAULT 0 CHECK(has_left_club IN (0, 1));
ALTER TABLE parkrun_athletes ADD COLUMN last_club_run_date TEXT; -- Last run in consolidated club results
ALTER TABLE parkrun_athletes ADD COLUMN last_individual_run_date TEXT; -- Last run from personal page
ALTER TABLE parkrun_athletes ADD COLUMN left_club_detected_at INTEGER; -- When we detected they left

-- Create index for querying athletes who have left
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_left ON parkrun_athletes(has_left_club);
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_left_date ON parkrun_athletes(left_club_detected_at);

-- Add comment explaining the logic
-- An athlete is considered to have left if:
-- 1. They have runs on their personal page (data_source='individual')
-- 2. Their most recent individual run is > 2 weeks after their most recent club run
-- 3. They are automatically hidden when detected
