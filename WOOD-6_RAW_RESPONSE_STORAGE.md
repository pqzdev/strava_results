# WOOD-6: Store Full Strava API Response

This document describes the implementation of storing full Strava API responses for future feature extraction.

## Overview

Instead of extracting only specific fields from Strava API responses, we now store the entire JSON response in a `raw_response` column. This allows us to extract additional features in the future without re-fetching from Strava.

## Changes Made

### 1. Database Migration

**File:** [database/migrations/0022_add_raw_response_column.sql](database/migrations/0022_add_raw_response_column.sql)

```sql
ALTER TABLE races ADD COLUMN raw_response TEXT;
```

Run this migration:
```bash
# Apply to production database
wrangler d1 execute DB --file=database/migrations/0022_add_raw_response_column.sql
```

### 2. Updated Sync Code

**Files Modified:**
- [workers/src/utils/db.ts](workers/src/utils/db.ts#L181-L214) - Updated `fetchDetailedActivity()` to return `rawResponse`
- [workers/src/utils/db.ts](workers/src/utils/db.ts#L231-L326) - Updated `insertRace()` to store `rawResponse`
- [workers/src/queue/sync-queue.ts](workers/src/queue/sync-queue.ts#L98-L180) - Updated `insertRaceOptimized()` to store `rawResponse`

**What's stored:**
- Full JSON response from `GET /api/v3/activities/:id`
- Includes fields like `start_latlng`, `end_latlng`, `segment_efforts`, `laps`, `splits_metric`, etc.
- See [Strava API Documentation](https://developers.strava.com/docs/reference/#api-models-DetailedActivity) for all available fields

### 3. Backfill Script

**File:** [workers/src/api/raw-response-backfill.ts](workers/src/api/raw-response-backfill.ts)

**Endpoint:** `POST /api/backfill/raw-responses`

**Usage:**
```bash
# Backfill 100 activities at a time (default)
curl -X POST https://your-worker.workers.dev/api/backfill/raw-responses

# Backfill custom amount (max 500 per request)
curl -X POST https://your-worker.workers.dev/api/backfill/raw-responses \
  -H "Content-Type: application/json" \
  -d '{"limit": 200}'
```

**Response:**
```json
{
  "success": true,
  "progress": {
    "total": 117,
    "processed": 117,
    "updated": 115,
    "failed": 2,
    "errors": ["Error processing race 123: ..."]
  },
  "message": "Backfilled 115 races out of 117"
}
```

**Rate Limits:**
- Strava allows ~100 requests per 15 minutes
- Script has 10ms delay between requests
- Run multiple times if you have > 500 activities

## Deployment Steps

1. **Apply Database Migration**
   ```bash
   wrangler d1 execute DB --file=database/migrations/0022_add_raw_response_column.sql
   ```

2. **Deploy Updated Worker**
   ```bash
   cd workers
   npm run deploy
   ```

3. **Run Backfill** (for existing races)
   ```bash
   # Start backfilling (processes 100 at a time)
   curl -X POST https://strava-club-results.your-domain.workers.dev/api/backfill/raw-responses

   # Keep running until all are backfilled
   # Check progress by looking at the response
   ```

4. **Verify**
   ```bash
   # Count races with raw_response
   wrangler d1 execute DB --command="SELECT COUNT(*) FROM races WHERE raw_response IS NOT NULL;"

   # Check a sample
   wrangler d1 execute DB --command="SELECT strava_activity_id, json_extract(raw_response, '$.start_latlng') as start_coords FROM races WHERE raw_response IS NOT NULL LIMIT 5;"
   ```

## Using Raw Response Data

### Extracting Coordinates

```sql
-- Get start coordinates
SELECT
  strava_activity_id,
  json_extract(raw_response, '$.start_latlng[0]') as start_lat,
  json_extract(raw_response, '$.start_latlng[1]') as start_lng,
  json_extract(raw_response, '$.end_latlng[0]') as end_lat,
  json_extract(raw_response, '$.end_latlng[1]') as end_lng
FROM races
WHERE raw_response IS NOT NULL;
```

### Extracting Other Fields

```sql
-- Get segment efforts
SELECT
  strava_activity_id,
  json_extract(raw_response, '$.segment_efforts') as segments
FROM races
WHERE raw_response IS NOT NULL;

-- Get splits
SELECT
  strava_activity_id,
  json_extract(raw_response, '$.splits_metric') as splits
FROM races
WHERE raw_response IS NOT NULL;
```

## ML Feature Extraction

The raw response can now be used in the ML pipeline for feature extraction.

**Example:** Extract coordinates for event similarity matching (see [ml/train_event_similarity_predictor.py](ml/train_event_similarity_predictor.py))

```python
# In feature extraction script
import json

def extract_coordinates_from_raw_response(raw_response_str):
    """Extract start/end coordinates from raw Strava response"""
    if not raw_response_str:
        return None, None, None, None

    data = json.loads(raw_response_str)

    start_latlng = data.get('start_latlng')
    end_latlng = data.get('end_latlng')

    if start_latlng and len(start_latlng) == 2:
        start_lat, start_lng = start_latlng
    else:
        start_lat, start_lng = None, None

    if end_latlng and len(end_latlng) == 2:
        end_lat, end_lng = end_latlng
    else:
        end_lat, end_lng = None, None

    return start_lat, start_lng, end_lat, end_lng
```

## Benefits

✅ **Future-proof**: Can extract any field without re-fetching
✅ **No API rate limits**: One-time fetch during sync
✅ **Historical data**: Full activity details preserved
✅ **ML features**: Can extract coordinates, segments, splits, etc.
✅ **Debugging**: Can inspect exact Strava response

## Next Steps

1. ✅ Apply migration
2. ✅ Deploy updated worker
3. ⏳ Run backfill for existing races
4. ⏳ Update ML feature extraction to use `start_latlng`/`end_latlng`
5. ⏳ Re-train event similarity model with coordinates
6. ⏳ Evaluate improvement in accuracy

## Notes

- New activities synced after deployment will automatically have `raw_response` populated
- Backfill only needed for existing activities (should be ~100-200 races)
- The `raw_response` field is optional - code handles NULL gracefully
- Storage cost is minimal (~10KB per activity as JSON text)
