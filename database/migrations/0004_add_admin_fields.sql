-- Add admin and management fields to athletes table
ALTER TABLE athletes ADD COLUMN is_admin INTEGER DEFAULT 0; -- 0 = false, 1 = true (SQLite doesn't have boolean)
ALTER TABLE athletes ADD COLUMN is_hidden INTEGER DEFAULT 0; -- Hide from public results
ALTER TABLE athletes ADD COLUMN is_blocked INTEGER DEFAULT 0; -- Prevent registration
ALTER TABLE athletes ADD COLUMN sync_status TEXT DEFAULT 'pending'; -- pending, in_progress, completed, error
ALTER TABLE athletes ADD COLUMN sync_error TEXT; -- Error message if sync failed
ALTER TABLE athletes ADD COLUMN total_activities_count INTEGER DEFAULT 0; -- Total activities fetched (not just races)

-- Set initial admin (athlete ID 151622)
UPDATE athletes SET is_admin = 1 WHERE strava_id = 151622;
