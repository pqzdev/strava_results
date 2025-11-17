-- Delete rows with incorrect event names
-- The scraper will re-import them with the correct normalized names
-- "Presint 18" -> "Presint 18, Putrajaya"
-- "Albert Melbourne" -> "Albert, Melbourne"

-- Check how many records will be deleted
SELECT
  event_name,
  COUNT(*) as records_to_delete
FROM parkrun_results
WHERE event_name IN ('Presint 18', 'Albert Melbourne')
GROUP BY event_name;

-- Show sample of records that will be deleted (optional - review before deleting)
SELECT
  athlete_name,
  event_name,
  date,
  time_string,
  data_source
FROM parkrun_results
WHERE event_name IN ('Presint 18', 'Albert Melbourne')
ORDER BY event_name, date DESC
LIMIT 20;

-- Delete all records with incorrect event names
DELETE FROM parkrun_results
WHERE event_name IN ('Presint 18', 'Albert Melbourne');

-- Verify deletion
SELECT
  event_name,
  COUNT(*) as remaining_records
FROM parkrun_results
WHERE event_name IN ('Presint 18', 'Albert Melbourne')
GROUP BY event_name;
