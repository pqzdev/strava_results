-- Diagnostic query for Hannah WOOD duplicates

-- 1. Show all Hannah WOOD records to see the pattern
SELECT
    id,
    athlete_name,
    parkrun_athlete_id,
    event_name,
    date,
    data_source,
    position,
    time_string
FROM parkrun_results
WHERE athlete_name = 'Hannah WOOD'
ORDER BY date DESC, id;

-- 2. Show duplicates for Hannah WOOD (same parkrun_athlete_id + event_name + date)
SELECT
    parkrun_athlete_id,
    event_name,
    date,
    data_source,
    COUNT(*) as duplicate_count,
    GROUP_CONCAT(id) as duplicate_ids
FROM parkrun_results
WHERE athlete_name = 'Hannah WOOD'
  AND parkrun_athlete_id IS NOT NULL
GROUP BY parkrun_athlete_id, event_name, date
HAVING COUNT(*) > 1
ORDER BY date DESC;

-- 3. Check if parkrun_athlete_id is NULL for any Hannah WOOD records
SELECT COUNT(*) as null_athlete_id_count
FROM parkrun_results
WHERE athlete_name = 'Hannah WOOD'
  AND parkrun_athlete_id IS NULL;

-- 4. Show data_source breakdown for Hannah WOOD
SELECT
    data_source,
    COUNT(*) as count
FROM parkrun_results
WHERE athlete_name = 'Hannah WOOD'
GROUP BY data_source;
