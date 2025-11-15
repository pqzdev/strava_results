#!/bin/bash
# WOOD-6: Run backfill in batches until no more progress

API_URL="https://strava-club-workers.pedroqueiroz.workers.dev/api/backfill/raw-responses"
BATCH_SIZE=200
MAX_ATTEMPTS=10

echo "Starting backfill process..."

for attempt in $(seq 1 $MAX_ATTEMPTS); do
    echo ""
    echo "===== Attempt $attempt/$MAX_ATTEMPTS ====="
    echo "Calling API (batch size: $BATCH_SIZE)..."

    # Run backfill with progress indicator
    response=$(curl -X POST "$API_URL" -H "Content-Type: application/json" -d "{\"limit\": $BATCH_SIZE}" 2>&1)

    # Extract stats
    updated=$(echo "$response" | python3 -c "import sys, json; print(json.load(sys.stdin)['progress']['updated'])")
    total=$(echo "$response" | python3 -c "import sys, json; print(json.load(sys.stdin)['progress']['total'])")
    failed=$(echo "$response" | python3 -c "import sys, json; print(json.load(sys.stdin)['progress']['failed'])")

    echo "Processed: $total, Updated: $updated, Failed: $failed"

    # Check remaining
    remaining=$(npx wrangler d1 execute strava-club-db --remote --command="SELECT COUNT(*) as remaining FROM races WHERE raw_response IS NULL;" --json 2>&1 | grep -oP '(?<="remaining":)\d+')
    echo "Remaining: $remaining"

    # Stop if no progress
    if [ "$updated" -eq 0 ]; then
        echo "No more progress, stopping..."
        break
    fi

    # Sleep to respect rate limits (15 minutes = 900 seconds, we can do 300 requests)
    # With batch size 200, wait ~60 seconds between batches
    if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
        echo "Waiting 60 seconds before next batch..."
        sleep 60
    fi
done

echo ""
echo "===== Backfill Complete ====="
npx wrangler d1 execute strava-club-db --remote --command="SELECT COUNT(*) as total, SUM(CASE WHEN raw_response IS NOT NULL THEN 1 ELSE 0 END) as with_raw_response, ROUND(100.0 * SUM(CASE WHEN raw_response IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as percent FROM races;" --json 2>&1 | grep -A5 "results"
