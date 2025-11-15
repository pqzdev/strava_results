#!/bin/bash
# WOOD-6: Refresh ML data from D1 and retrain model with coordinates

set -e  # Exit on error

echo "======================================================================"
echo "WOOD-6: Refreshing ML Data and Retraining Model with Coordinates"
echo "======================================================================"
echo ""

cd /Users/pqz/Code/strava_results

# Step 1: Check how many activities have coordinates
echo "📊 Step 1: Checking raw_response coverage..."
cd workers
npx wrangler d1 execute strava-club-db --remote \
  --command="SELECT COUNT(*) as total, SUM(CASE WHEN raw_response IS NOT NULL THEN 1 ELSE 0 END) as with_raw_response, ROUND(100.0 * SUM(CASE WHEN raw_response IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as percent FROM races;" \
  --json 2>&1 | grep -A5 '"results"'
echo ""

# Step 2: Export fresh data from D1 with raw_response
echo "📥 Step 2: Exporting fresh data from D1..."
npx wrangler d1 execute strava-club-db --remote --command="
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
  CASE WHEN r.event_name = 'parkrun' THEN 1 ELSE 0 END as is_parkrun,
  r.raw_response
FROM races r
ORDER BY r.date DESC;
" --json > ../ml/data/all_races_raw.json

echo "✅ Data exported to ml/data/all_races_raw.json"
echo ""

# Step 3: Process data and extract coordinates
cd ../ml
echo "🔧 Step 3: Processing data and extracting coordinates..."
python3 process_all_data.py
echo ""

# Step 4: Generate features
echo "🎨 Step 4: Generating features..."
python3 feature_engineering.py
echo ""

# Step 5: Train model with coordinates
echo "🤖 Step 5: Training event similarity model with coordinates..."
python3 train_event_similarity_predictor.py
echo ""

# Step 6: Show results
echo "======================================================================"
echo "✨ Training Complete!"
echo "======================================================================"
echo ""
echo "Check these files for results:"
echo "  - ml/models/event_similarity_predictor.pkl"
echo "  - ml/models/event_similarity_metadata.json"
echo ""
echo "Next steps:"
echo "  1. Review model performance in the output above"
echo "  2. Compare with previous results (should be much better with coordinates!)"
echo "  3. Deploy updated model to production"
