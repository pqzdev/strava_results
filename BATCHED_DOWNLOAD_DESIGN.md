# Strava Batched Download System - Design Overview

This document outlines the current batched download implementation and recommendations for improvement.

## Current Batched Download Architecture

### Overview
The system uses a **loop-based batch pagination model** to work within Cloudflare Workers' 30-second timeout limit.

### How It Works

```
Request → Cloudflare Worker (30s timeout limit)
  ↓
syncAthlete(athleteId, fullSync=true)
  ↓
┌─ OUTER WHILE LOOP (Keeps worker alive)
│  ├─ Iteration 1:
│  │  ├─ syncAthleteInternal(batch=1)
│  │  │  ├─ Fetch 200 activities from Strava API
│  │  │  ├─ Filter races (workout_type=1)
│  │  │  ├─ Insert into DB
│  │  │  └─ Return { moreDataAvailable: true, oldestTimestamp: 123456789 }
│  │  ├─ Sleep 1 second (prevent rate limits)
│  │  └─ Continue to next iteration
│  │
│  ├─ Iteration 2:
│  │  ├─ syncAthleteInternal(batch=2, before=123456789)
│  │  ├─ Fetch next 200 activities
│  │  └─ Return { moreDataAvailable: true, oldestTimestamp: 123456700 }
│  │
│  ├─ ... [Iterations 3-N until moreDataAvailable = false]
│  │
│  └─ Iteration N:
│     ├─ Fetch final batch (< 200 activities)
│     └─ Return { moreDataAvailable: false }
│
└─ Exit loop, set status='completed', log success

Total time: N iterations × 2 seconds ≈ 2N seconds (well under 30s limit)
```

### Batch Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Activities per page | 200 | Max allowed by Strava API |
| Pages per iteration | 1 | Prevent timeout (30s limit) |
| Delay between iterations | 1000 ms | Let DB stabilize |
| Rate limit buffer | 5-minute | Token refresh threshold |

### Pagination Direction

**For Incremental Sync** (fetch only new activities):
```typescript
// Parameters: after=1730000000 (last_synced_at)
GET /athlete/activities?after=1730000000&per_page=200&page=1

Returns activities NEWEST first in reverse chronological order
```

**For Full Sync** (re-fetch all activities):
```typescript
// Iteration 1: No parameters (fetch from most recent)
GET /athlete/activities?per_page=200&page=1

// Iteration 2+: Use 'before' parameter with oldest activity from previous page
GET /athlete/activities?before=1720000000&per_page=200
// (NOTE: DO NOT use 'page' parameter with 'before')

Pagination walks backward in time (oldest → newest activity)
```

---

## Key Design Decisions

### 1. Why Batch Size of 1 Page (200 activities)?
- **Problem**: Cloudflare Workers timeout after 30 seconds
- **Solution**: Process 200 activities per iteration, not all in one request
- **Trade-off**: Athletes with 1000+ activities need multiple iterations
- **Benefits**: Guarantees we finish before timeout, predictable timing

### 2. Why Not Use Traditional Queue (Redis/RabbitMQ)?
- **Cost**: External queues require paid tier
- **Complexity**: Cloudflare Workers primarily use D1 + Workers
- **Sufficient**: Current approach works for <500 athletes
- **Future**: Consider if scaling beyond 1000 athletes

### 3. Why Full Sync Deletes All Races First?
```
Current approach (DELETE then INSERT):
- Guarantees consistency
- Handles race un-marking
- Preserves event_name mappings
- Cost: Extra DELETE, then INSERT

Alternative (UPSERT):
- Faster for large histories
- More complex logic (track changes)
- Risk: Orphaned races if deleted in Strava

Chosen: Full DELETE because correctness > speed
```

### 4. Why No Automatic Retry?
- **Current**: Manual reset via admin endpoint
- **Risk**: Failed syncs get stuck in `in_progress`
- **Monitoring**: Session logs show exactly where it failed
- **Future**: Add automatic timeout + retry mechanism

---

## Bottleneck Analysis

### A. Strava API Rate Limits (Soft Constraint)
```
Hard Limits:
- 100 requests per 15 minutes
- 1,000 requests per day

Current Weekly Sync:
- 200 athletes × 1 request/athlete × 1 week = 200 requests/week
- Much safer: 200 << 1,000/day

Full Refresh for All Athletes:
- 200 athletes with ~2,000 activities each
- 200 athletes × 10 pages × 1 request/page = 2,000 requests
- EXCEEDS 1,000/day limit!

Solution: Stagger full refreshes (do 20 athletes/week, not all at once)
```

### B. Cloudflare Worker Timeout (Hard Constraint)
```
Current Design:
- 1 athlete with 1,000 activities = 5 iterations
- 5 iterations × 2 seconds = ~10 seconds
- Well under 30-second limit ✅

Edge Case - What Could Go Wrong:
- Slow API (Strava taking 5 seconds per request)
- Slow DB (large batches of inserts)
- Combination: 5s API + 5s DB + 1s delay = 11s per iteration × 5 = 55s ❌

Mitigation: Monitor actual execution time via logs
```

### C. Database Write Throughput
```
Current:
- Single INSERT per race (N queries per athlete)
- Batch insert would be faster but more complex
- D1 has soft limits but no issues at current scale

Example: 200 activities × 200 athletes = 40,000 inserts
- Single: ~1ms per query = 40 seconds total
- Batch: N batch inserts = <1 second total

Recommendation: Add batch INSERT for full syncs (5-10 races per INSERT)
```

---

## Current Implementation Details

### syncAthlete() Function Flow

```typescript
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false,      // ← Controls delete behavior
  ctx?: ExecutionContext,         // ← For ctx.waitUntil()
  continuationTimestamp?: number, // ← For pagination
  sessionId?: string              // ← For logging
): Promise<void>
```

**Parameters Explained:**
- `fullSync=true`: DELETE all races, then re-fetch from scratch
  - Use when: Rebuilding after corruption, or manual "refresh"
  - Cost: Extra DELETE operation + all inserts
  
- `fullSync=false`: Only INSERT new races, don't delete old ones
  - Use when: Normal incremental sync (weekly cron)
  - Cost: Just INSERT new ones

- `sessionId`: Each sync gets unique ID for logging
  - Format: `sync-${athleteId}-${Date.now()}`
  - Used to fetch real-time logs during sync

### Database State During Sync

```
athletes table:
┌─────────┬──────────────┬─────────────────┬────────────┐
│ strava_id │ sync_status  │ last_synced_at  │ sync_error │
├─────────┼──────────────┼─────────────────┼────────────┤
│ 12345   │ in_progress  │ 1730000000      │ NULL       │ ← Syncing
│ 67890   │ completed    │ 1730010000      │ NULL       │ ← Done
│ 11111   │ error        │ 1730000000      │ "Timeout"  │ ← Failed
└─────────┴──────────────┴─────────────────┴────────────┘

races table:
Gets new rows inserted/deleted based on sync results

sync_logs table (for monitoring):
├─ athlete_id: 12345
├─ sync_session_id: sync-12345-1730010000
├─ messages:
│  ├─ "Sync started" (info)
│  ├─ "Fetching batch 1" (info)
│  ├─ "Fetched 200 activities from Strava API" (info)
│  ├─ "Found 45 races out of 200 activities" (info)
│  ├─ "Batch 1 complete: 45 races added. More data available" (info)
│  ├─ "Fetching batch 2" (info)
│  ├─ "Fetched 150 activities..." (info)
│  ├─ "Found 30 races out of 150 activities" (info)
│  └─ "Sync completed successfully after 2 batches" (success)
└─ All messages stored with timestamps for analysis
```

---

## Monitoring & Observability

### What Gets Logged

1. **Console Logs** (visible via `wrangler tail`)
   - Batch start/end
   - Activities fetched per batch
   - Races found
   - Any errors

2. **Database Logs** (sync_logs table)
   - Structured JSON metadata
   - Batch numbers, counts
   - Rate limit info
   - User-friendly messages

3. **Status Tracking** (athletes table)
   - `sync_status`: Current state
   - `sync_error`: Error message
   - `total_activities_count`: How many processed
   - `last_synced_at`: Last successful timestamp

### Admin Endpoints for Monitoring

```
GET /api/admin/sync-logs?session_id=sync-123-1730000000
→ Returns all logs for this sync session (real-time)

GET /api/admin/athletes
→ Returns all athletes with: sync_status, sync_error, total_activities_count

POST /api/admin/athletes/:id/sync/stop
→ Stop in-progress sync (sets status back to completed)

POST /api/admin/reset-stuck-syncs
→ Reset all athletes stuck in 'in_progress'
```

---

## Common Issues & Solutions

### Issue 1: Athlete stuck in "in_progress" for hours
**Cause**: Worker crashed or hit timeout
**Solution**:
```bash
# Check recent logs
wrangler tail

# If stuck, reset:
curl -X POST https://api.example.com/api/admin/reset-stuck-syncs \
  -H "Content-Type: application/json" \
  -d '{"admin_strava_id": 123}'

# Or check logs for what went wrong:
curl 'https://api.example.com/api/admin/sync-logs?session_id=sync-456-1730000000'
```

### Issue 2: Only got 50 activities instead of expected 500
**Cause**: Hit page limit, sync didn't complete all iterations
**Solution**: Check if worker timeout occurred
```typescript
// The while loop will keep running until:
// 1. activities.length < 200 (got partial page, done)
// 2. activities.length === 200 but moreDataAvailable = false (shouldn't happen)
// 3. Worker timeout (would crash, status remains 'in_progress')
```

### Issue 3: Rate limit exceeded
**Cause**: Too many athletes syncing at once, or full refresh used
**Solution**:
```typescript
// If full refresh needed for many athletes:
// Instead of:
await syncAthlete(id, env, false, true)  // full=true for all

// Do staggered approach:
// - Week 1: Full refresh athletes 1-20
// - Week 2: Full refresh athletes 21-40
// - etc.
```

---

## Future Improvements (Recommendations)

### Short-term (Quick Wins)
1. **Batch INSERT for full syncs**
   - Instead of: 200 individual INSERT statements
   - Use: 20 batch INSERTs with 10 races each
   - Benefit: 10x faster DB writes

2. **Automatic retry on timeout**
   - Add automatic timeout check (28 seconds)
   - If timeout approaching, save progress + mark for retry
   - Next cron run picks up where it left off

3. **Configurable batch sizes**
   - Make 200 activities per batch configurable
   - Smaller = more iterations, safer from timeout
   - Larger = fewer iterations, faster (if not timing out)

### Medium-term (Architectural)
1. **Use Cloudflare Queues instead of manual batching**
   - Replace: While loop + sessionId tracking
   - With: Durable, idempotent queue messages
   - Benefit: Automatic retries, dead-letter queue

2. **Add priority queue**
   - Athletes with active syncs = higher priority
   - Rarely-active athletes = lower priority
   - Benefit: Faster feedback for active users

3. **Webhook support** (requires Strava paid tier)
   - Real-time sync as activities happen
   - Reduces API call load dramatically
   - Benefit: Always up-to-date data

### Long-term (Scale)
1. **Multi-region workers**
   - Spread syncs across multiple regions
   - Parallel processing for different athletes
   - Benefit: Handle 1000+ athletes easily

2. **Redis cache layer**
   - Cache popular race data
   - Reduce DB queries for dashboard
   - Benefit: Faster frontend response times

---

## Testing the Batched Download

### Unit Test: Single Athlete Sync
```typescript
// Test with mock Strava API returning 500 activities
// Should result in 3 iterations:
// Iteration 1: 200 activities
// Iteration 2: 200 activities
// Iteration 3: 100 activities → moreDataAvailable = false
```

### Integration Test: Batch Processing
```typescript
// Sync 20 athletes, each with 1000+ activities
// Verify:
// - All athletes complete successfully
// - No rate limit exceeded
// - Total time < 30 seconds per athlete
// - Correct race counts in DB
```

### Load Test: Rate Limiting
```typescript
// Simulate 50 concurrent sync requests
// Verify:
// - None exceed Strava API limits
// - None timeout on Worker
// - All complete within expected time
```

---

## Summary Table

| Aspect | Current | Bottleneck | Recommendation |
|--------|---------|-----------|-----------------|
| Batch Size | 1 page (200) | Too small? | Monitor actual times, consider 2-3 pages |
| Delay Between Batches | 1 second | Could reduce | 500ms is usually safe |
| Concurrency | Sequential | Slow | Use Cloudflare Queues for parallel |
| Retry Logic | Manual | Unreliable | Add automatic retry after timeout |
| Database Writes | Single INSERT | Slow (full sync) | Use batch INSERT for 5-10 per query |
| Rate Limiting | Fixed schedule | Not flexible | Adaptive scheduling based on failures |
| Monitoring | Session logs | Limited | Add metrics/alerts for failures |
| Scale Limit | ~500 athletes | Hard | Would need queue service |

