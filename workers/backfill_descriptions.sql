-- Backfill script to check which activities have descriptions
-- Run this to see how many activities are missing descriptions:

SELECT
  COUNT(*) as total_activities,
  COUNT(description) as activities_with_description,
  COUNT(*) - COUNT(description) as activities_without_description
FROM races;

-- To populate descriptions, you need to re-sync activities from Strava
-- The sync process will fetch the description field automatically

-- Optional: Clear description column to test (DO NOT RUN IN PRODUCTION)
-- UPDATE races SET description = NULL;
