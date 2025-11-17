-- Delete rows with event name "Presint 18"
-- The scraper will re-import them with the correct normalized name "Presint 18, Putrajaya"

-- Check how many records will be deleted
SELECT COUNT(*) as records_to_delete
FROM parkrun_results
WHERE event_name = 'Presint 18';

-- Show sample of records that will be deleted (optional - review before deleting)
SELECT
  athlete_name,
  event_name,
  date,
  time_string,
  data_source
FROM parkrun_results
WHERE event_name = 'Presint 18'
ORDER BY date DESC
LIMIT 10;

-- Delete all records where event_name is just "Presint 18"
DELETE FROM parkrun_results
WHERE event_name = 'Presint 18';

-- Verify deletion
SELECT COUNT(*) as remaining_presint18_records
FROM parkrun_results
WHERE event_name = 'Presint 18';
