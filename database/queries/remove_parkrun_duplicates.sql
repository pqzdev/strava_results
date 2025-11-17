-- Remove duplicate parkrun results, keeping only the most recent one
-- Duplicates are defined as: same parkrun_athlete_id + event_name + date
-- This keeps the row with the highest ID (most recently inserted)

DELETE FROM parkrun_results
WHERE parkrun_athlete_id IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id)
    FROM parkrun_results
    WHERE parkrun_athlete_id IS NOT NULL
    GROUP BY parkrun_athlete_id, event_name, date
);

-- Check results
SELECT COUNT(*) as remaining_results FROM parkrun_results;

-- Verify no duplicates remain
SELECT
    parkrun_athlete_id,
    athlete_name,
    event_name,
    date,
    COUNT(*) as count
FROM parkrun_results
WHERE parkrun_athlete_id IS NOT NULL
GROUP BY parkrun_athlete_id, event_name, date
HAVING COUNT(*) > 1;
