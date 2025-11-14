#!/bin/bash

# Simple data export using wrangler d1 export
# This exports the entire database and we'll process it separately

echo "🚀 Exporting training data from D1 database..."

# Create data directory
mkdir -p data

echo "📊 Exporting races table..."
npx wrangler d1 execute strava-club-db --remote --command "SELECT r.id, r.strava_activity_id, r.name as activity_name, r.distance, r.elapsed_time, r.moving_time, r.date, r.elevation_gain, r.event_name, LENGTH(r.polyline) as polyline_length FROM races r WHERE r.is_hidden = 0 ORDER BY r.date DESC" > data/races_raw.txt 2>&1

echo "📊 Exporting parkrun results..."
npx wrangler d1 execute strava-club-db --remote --command "SELECT id, athlete_name, event_name, time_seconds, date FROM parkrun_results ORDER BY date DESC LIMIT 1000" > data/parkrun_raw.txt 2>&1

echo "✅ Export complete! Check data/ directory"
echo ""
echo "Next: Process the raw data into CSV format"
