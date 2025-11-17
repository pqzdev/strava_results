-- Normalize "Presint 18" event name to "Presint 18, Putrajaya"
-- This ensures consistency across all parkrun results

-- Check how many records need updating
SELECT COUNT(*) as records_to_update
FROM parkrun_results
WHERE event_name = 'Presint 18';

-- Update all records where event_name is just "Presint 18"
UPDATE parkrun_results
SET event_name = 'Presint 18, Putrajaya'
WHERE event_name = 'Presint 18';

-- Verify the update
SELECT COUNT(*) as records_with_normalized_name
FROM parkrun_results
WHERE event_name = 'Presint 18, Putrajaya';

-- Show sample of updated records
SELECT
  athlete_name,
  event_name,
  date,
  time_string,
  data_source
FROM parkrun_results
WHERE event_name = 'Presint 18, Putrajaya'
ORDER BY date DESC
LIMIT 10;
