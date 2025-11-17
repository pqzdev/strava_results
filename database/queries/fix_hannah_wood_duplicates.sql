-- Fix duplicates for Hannah WOOD (and any similar cases)
-- Strategy:
-- 1. Update club records to add parkrun_athlete_id from individual records
-- 2. Update club records to add event_number from individual records
-- 3. Delete individual records that are now duplicates

-- Step 1: Update club records with parkrun_athlete_id and event_number from individual records
UPDATE parkrun_results AS club
SET
  parkrun_athlete_id = (
    SELECT individual.parkrun_athlete_id
    FROM parkrun_results AS individual
    WHERE individual.athlete_name = club.athlete_name
      AND individual.event_name = club.event_name
      AND individual.date = club.date
      AND individual.data_source = 'individual'
      AND individual.parkrun_athlete_id IS NOT NULL
    LIMIT 1
  ),
  event_number = (
    SELECT individual.event_number
    FROM parkrun_results AS individual
    WHERE individual.athlete_name = club.athlete_name
      AND individual.event_name = club.event_name
      AND individual.date = club.date
      AND individual.data_source = 'individual'
      AND individual.event_number > 0
    LIMIT 1
  )
WHERE club.data_source = 'club'
  AND club.parkrun_athlete_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM parkrun_results AS individual
    WHERE individual.athlete_name = club.athlete_name
      AND individual.event_name = club.event_name
      AND individual.date = club.date
      AND individual.data_source = 'individual'
  );

-- Step 2: Delete individual records that are now duplicates of club records
DELETE FROM parkrun_results
WHERE id IN (
  SELECT individual.id
  FROM parkrun_results AS individual
  INNER JOIN parkrun_results AS club
    ON club.athlete_name = individual.athlete_name
    AND club.event_name = individual.event_name
    AND club.date = individual.date
    AND club.data_source = 'club'
  WHERE individual.data_source = 'individual'
);

-- Verify: Check remaining Hannah WOOD records
SELECT
  id,
  parkrun_athlete_id,
  event_name,
  event_number,
  date,
  data_source,
  position,
  time_string
FROM parkrun_results
WHERE athlete_name = 'Hannah WOOD'
ORDER BY date DESC
LIMIT 10;

-- Verify: Check for any remaining duplicates
SELECT
  event_name,
  date,
  COUNT(*) as count
FROM parkrun_results
WHERE athlete_name = 'Hannah WOOD'
GROUP BY event_name, date
HAVING COUNT(*) > 1;
