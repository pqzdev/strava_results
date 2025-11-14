#!/bin/bash

# Export ALL race training data (including hidden parkruns)
# This gives us both parkrun and non-parkrun examples for ML training

set -e

echo "🚀 Exporting ALL race training data (including parkruns)..."

# Create data directory
mkdir -p data

# Export ALL races (both visible and hidden)
echo "📊 Querying races table (including hidden)..."
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
  r.is_hidden,
  CASE WHEN r.polyline IS NOT NULL THEN 1 ELSE 0 END as has_polyline,
  LENGTH(r.polyline) as polyline_length,
  r.source,
  CASE
    WHEN r.event_name LIKE '%parkrun%' OR r.event_name = 'parkrun' THEN 1
    ELSE 0
  END as is_parkrun
FROM races r
ORDER BY r.date DESC
" > data/all_races_raw.json

echo "✅ Exported to data/all_races_raw.json"
echo ""
echo "📊 Summary:"
TOTAL=$(cat data/all_races_raw.json | grep -o '"id"' | wc -l)
echo "   Total races (all): $TOTAL"
echo ""
echo "Next step: Process with Python to see parkrun vs non-parkrun breakdown"
