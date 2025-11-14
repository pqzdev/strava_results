#!/bin/bash

# Export race training data from D1 database
# Focus on event name prediction using existing race data

set -e

echo "🚀 Exporting race training data..."

# Create data directory
mkdir -p data

# Export races to JSON (wrangler handles large outputs better with --json to file)
echo "📊 Querying races table..."
npx wrangler d1 execute strava-club-db --remote --json --command "
SELECT
  r.id,
  r.strava_activity_id,
  r.name as activity_name,
  r.distance,
  r.elapsed_time,
  r.moving_time,
  r.date,
  r.elevation_gain,
  r.average_heartrate,
  r.max_heartrate,
  COALESCE(r.manual_time, r.moving_time) as final_time,
  COALESCE(r.manual_distance, r.distance) as final_distance,
  r.event_name,
  CASE WHEN r.polyline IS NOT NULL THEN 1 ELSE 0 END as has_polyline,
  LENGTH(r.polyline) as polyline_length,
  r.source
FROM races r
WHERE r.is_hidden = 0
ORDER BY r.date DESC
" > data/races_raw.json

echo "✅ Exported to data/races_raw.json"
echo ""
echo "📊 Summary:"
COUNT=$(cat data/races_raw.json | grep -o '"id"' | wc -l)
echo "   Total races: $COUNT"
echo ""
echo "Next step: Convert JSON to CSV for Python processing"
