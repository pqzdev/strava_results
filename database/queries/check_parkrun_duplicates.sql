-- Check for duplicate parkrun results
-- Duplicates are defined as: same parkrun_athlete_id + event_name + date
-- Run this to see if there are actual duplicates

SELECT
    parkrun_athlete_id,
    athlete_name,
    event_name,
    date,
    data_source,
    COUNT(*) as duplicate_count,
    GROUP_CONCAT(id) as duplicate_ids
FROM parkrun_results
WHERE parkrun_athlete_id IS NOT NULL
GROUP BY parkrun_athlete_id, event_name, date
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, parkrun_athlete_id, date;
