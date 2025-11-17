-- Clean up parkrun event names using normalization rules
-- This script applies all parkrun event name normalization rules to existing data

-- ========== STEP 1: Show what will be changed ==========

-- Show counts of events that match the mapping table
SELECT
  'Mapped events' as category,
  m.from_name,
  m.to_name,
  COUNT(*) as record_count
FROM parkrun_results r
INNER JOIN parkrun_event_name_mappings m ON r.event_name = m.from_name
GROUP BY m.from_name, m.to_name

UNION ALL

-- Show counts of events with "parkrun " prefix
SELECT
  'parkrun prefix' as category,
  event_name as from_name,
  REPLACE(event_name, 'parkrun ', '') as to_name,
  COUNT(*) as record_count
FROM parkrun_results
WHERE event_name LIKE 'parkrun %'
  AND event_name NOT IN (SELECT from_name FROM parkrun_event_name_mappings)
GROUP BY event_name

UNION ALL

-- Show counts of events with "parkrun de " prefix
SELECT
  'parkrun de prefix' as category,
  event_name as from_name,
  REPLACE(event_name, 'parkrun de ', '') as to_name,
  COUNT(*) as record_count
FROM parkrun_results
WHERE event_name LIKE 'parkrun de %'
  AND event_name NOT IN (SELECT from_name FROM parkrun_event_name_mappings)
GROUP BY event_name

ORDER BY category, from_name;

-- ========== STEP 2: Apply mappings from table ==========

-- Update events using the mapping table
UPDATE parkrun_results
SET event_name = (
  SELECT to_name
  FROM parkrun_event_name_mappings
  WHERE parkrun_event_name_mappings.from_name = parkrun_results.event_name
)
WHERE event_name IN (SELECT from_name FROM parkrun_event_name_mappings);

-- ========== STEP 3: Remove "parkrun " prefix ==========

-- Update events with "parkrun " prefix (that aren't in the mappings table)
UPDATE parkrun_results
SET event_name = REPLACE(event_name, 'parkrun ', '')
WHERE event_name LIKE 'parkrun %'
  AND event_name NOT IN (SELECT from_name FROM parkrun_event_name_mappings);

-- ========== STEP 4: Remove "parkrun de " prefix ==========

-- Update events with "parkrun de " prefix (that aren't in the mappings table)
UPDATE parkrun_results
SET event_name = REPLACE(event_name, 'parkrun de ', '')
WHERE event_name LIKE 'parkrun de %'
  AND event_name NOT IN (SELECT from_name FROM parkrun_event_name_mappings);

-- ========== STEP 5: Verify changes ==========

-- Show sample of updated records
SELECT
  event_name,
  COUNT(*) as count,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM parkrun_results
WHERE event_name IN (
  SELECT to_name FROM parkrun_event_name_mappings
)
OR event_name NOT LIKE 'parkrun %'
AND event_name NOT LIKE 'parkrun de %'
GROUP BY event_name
ORDER BY count DESC
LIMIT 20;

-- Verify no "parkrun " or "parkrun de " prefixes remain (except those in mappings)
SELECT
  COUNT(*) as remaining_parkrun_prefixes
FROM parkrun_results
WHERE (event_name LIKE 'parkrun %' OR event_name LIKE 'parkrun de %')
  AND event_name NOT IN (SELECT from_name FROM parkrun_event_name_mappings);
