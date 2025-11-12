# Strava Sync System - Quick Reference Card

## One-Line Summary
Loop-based batch pagination keeps Cloudflare Workers alive while syncing Strava activities in chunks of 200 activities per iteration.

---

## The Big Picture

```
┌─────────────────────────────────────────────────────────────┐
│                   Strava Activity Sync System                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  SCHEDULED SYNC (Weekly Monday 2 AM UTC)                     │
│  └─ syncAllAthletes() → processes 20 athletes at a time      │
│     └─ syncAthlete() → fetches activities in 200-chunk       │
│        └─ Loop: fetch batch → insert → check if more        │
│                                                               │
│  MANUAL SYNC (Admin triggered)                               │
│  └─ POST /api/admin/athletes/:id/sync → FULL refresh        │
│     └─ syncAthlete() with sessionId for monitoring          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Constants

| Constant | Value | Why |
|----------|-------|-----|
| Batch size | 200 activities | Strava API page size |
| Pages/iteration | 1 page | Stay under 30s timeout |
| Delay between iterations | 1 second | Rate limiting |
| Delay between athletes | 500 ms | Rate limiting |
| Delay between batches | 60 seconds | Rate limiting |
| Batch size (cron) | 20 athletes | Balance speed vs rate limits |
| Strava API limit | 100/15min, 1000/day | Hard constraints |
| Worker timeout | 30 seconds | Cloudflare limit |

---

## Where Things Happen

### Syncing
- **Main logic**: `/workers/src/queue/sync-queue.ts` - syncAthlete() function
- **Entry point**: `/workers/src/cron/sync.ts` - syncAllAthletes() for cron
- **API calls**: `/workers/src/utils/strava.ts` - fetchAthleteActivities()

### Data
- **Storage**: `/workers/src/utils/db.ts` - insertRace(), getAthleteByStravaId()
- **Schema**: `/database/schema.sql` + `/database/migrations/`
- **Monitoring**: `/workers/src/utils/sync-logger.ts` - logSyncProgress()

### Control
- **Admin endpoints**: `/workers/src/api/admin.ts` - triggerAthleteSync()
- **Router**: `/workers/src/index.ts` - HTTP request routing

---

## Key Functions & What They Do

### syncAthlete(athleteId, env, isInitialSync, fullSync, ctx, continuationTimestamp, sessionId)
**Does**: Main orchestration function - keeps outer loop alive during pagination
**Key logic**:
```typescript
while (true) {
  const result = syncAthleteInternal(...);    // Fetch 1 batch
  if (!result.moreDataAvailable) break;       // Got all data?
  continuationTimestamp = result.oldestTimestamp; // Set for next
  batchNumber++;
}
```

### syncAthleteInternal(athleteId, env, isInitialSync, fullSync, continuationTimestamp)
**Does**: Single batch processing - fetch 200 activities, filter, insert
**Key logic**:
1. Save event names (if full sync, first batch)
2. Delete all races (if full sync, first batch)
3. Ensure valid token
4. Fetch activities from Strava API
5. Filter races (type='Run' AND workout_type=1)
6. Insert/delete in DB
7. Return { moreDataAvailable, oldestTimestamp }

### fetchAthleteActivities(accessToken, after?, before?, perPage=200, maxPages=1)
**Does**: Call Strava API to get activities
**Pagination**:
- Incremental: uses `after` (get activities AFTER timestamp)
- Full: uses `before` (get activities BEFORE timestamp, walk backward)

### ensureValidToken(athlete, env)
**Does**: Check if token expired, refresh if needed
**Key**: 5-minute buffer before actual expiry

### filterRaceActivities(activities)
**Does**: Filter to only race activities
**Rule**: Keep only activities where `type === 'Run'` AND `workout_type === 1`

---

## Database Schema (Sync-Related Only)

### athletes table (tokens, status, last sync)
```sql
- strava_id (UNIQUE) - Strava user ID
- access_token, refresh_token, token_expiry
- last_synced_at - Unix timestamp, used as 'after' for incremental sync
- sync_status - 'idle', 'in_progress', 'completed', 'error'
- sync_error - Error message if failed
- total_activities_count - How many activities processed in last sync
```

### races table (activity data)
```sql
- athlete_id (FK) - Link to athlete
- strava_activity_id (UNIQUE) - Strava activity ID
- name, distance, moving_time, elapsed_time, date
- elevation_gain, average_heartrate, max_heartrate
- event_name - User-assigned (preserved during full syncs)
```

### sync_logs table (monitoring)
```sql
- athlete_id (FK)
- sync_session_id - Unique session ID (sync-${id}-${timestamp})
- log_level - 'info', 'warning', 'error', 'success'
- message - Human-readable message
- metadata - JSON with structured data (batch numbers, counts, etc.)
- created_at - Timestamp
```

---

## API Endpoints for Monitoring/Control

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/api/admin/sync-logs` | GET | Fetch logs for a session (real-time) |
| `/api/admin/athletes` | GET | List all athletes with status |
| `/api/admin/athletes/:id/sync` | POST | Trigger manual sync (FULL refresh) |
| `/api/admin/athletes/:id/sync/stop` | POST | Stop in-progress sync |
| `/api/admin/reset-stuck-syncs` | POST | Reset all stuck 'in_progress' |

---

## Flow Diagrams

### Happy Path: One Athlete's Sync

```
syncAthlete(id=123)
  │
  ├─ LOOP Iteration 1:
  │  ├─ syncAthleteInternal(batch=1)
  │  │  ├─ Strava API: GET /athlete/activities?per_page=200
  │  │  ├─ Response: 200 activities
  │  │  ├─ Filter: 45 are races
  │  │  ├─ INSERT 45 races into DB
  │  │  └─ Return { moreDataAvailable: true, oldestTimestamp: 123456 }
  │  └─ Sleep 1 second
  │
  ├─ LOOP Iteration 2:
  │  ├─ syncAthleteInternal(batch=2, before=123456)
  │  │  ├─ Strava API: GET /athlete/activities?before=123456
  │  │  ├─ Response: 150 activities
  │  │  ├─ Filter: 30 are races
  │  │  ├─ INSERT 30 races
  │  │  └─ Return { moreDataAvailable: false } (150 < 200)
  │  └─ Sleep 1 second
  │
  └─ EXIT LOOP, status='completed'
```

### When Things Go Wrong

```
Athlete stuck in 'in_progress' for hours?
├─ Check logs: wrangler tail
├─ Check sync_logs: SELECT * FROM sync_logs WHERE sync_session_id=?
├─ If worker crashed: Reset via POST /api/admin/reset-stuck-syncs
└─ If still broken: Contact admin, check Strava API status

Rate limit exceeded?
├─ Current: 200 requests/week << 1000/day ✓
├─ Risk: Full refresh all athletes could exceed
├─ Solution: Stagger full refreshes across weeks
└─ Example: Refresh 20 athletes/week instead of all at once

Worker timeout?
├─ Current design: ~10 seconds per athlete ✓
├─ Risk: If Strava API slow + DB slow
├─ Symptom: Status stays 'in_progress', no more logs
├─ Check: sync_logs should show final batch attempted
└─ Solution: Consider batch size reduction or Cloudflare Queues
```

---

## What Gets Logged (Observability)

### Console Logs (via `wrangler tail`)
```
Fetching batch 1 for athlete 12345
Fetched 200 activities from Strava API
Found 45 races out of 200 activities
Batch 1 complete. More data available, continuing with next batch...
Fetching batch 2 for athlete 12345
...
```

### Database Logs (sync_logs table)
```
{
  athlete_id: 123,
  sync_session_id: "sync-123-1730010000",
  log_level: "info",
  message: "Fetching batch 1",
  metadata: { "batchNumber": 1, "currentTimestamp": null },
  created_at: 1730010001
}
```

### Status Fields (athletes table)
```
sync_status: 'in_progress'  ← Currently syncing
sync_error: NULL            ← No error yet
total_activities_count: 245 ← Activities processed
last_synced_at: 1730010000  ← Last successful sync time
```

---

## Rate Limiting Strategy

### How It Works
```
Cron triggers at 2 AM Monday
  ↓
For each batch of 20 athletes:
  ├─ Athlete 1: syncAthlete() takes 2-5 seconds
  ├─ Wait 500ms
  ├─ Athlete 2: syncAthlete() takes 2-5 seconds
  ├─ Wait 500ms
  ├─ ... (repeat 20 times)
  └─ Total batch: ~60-120 seconds
  
  Wait 60 seconds before next batch of 20
  
Result: 200 athletes × 1 request = 200 requests/week ✓
```

### Safety Margins
- **15-minute limit**: 100/15min - we use ~3 per 15 min (safe)
- **Daily limit**: 1000/day - we use ~200/week (safe)
- **Worker timeout**: 30 seconds - we use ~10-15 per athlete (safe)

### When Things Get Risky
- Full refresh all 200 athletes: ~2000+ requests (EXCEEDS LIMIT)
- Solution: Stagger over 10 weeks (200 athletes/week)

---

## Common Fixes

### "Athlete still shows 'in_progress' after 12 hours"
```bash
# Check what happened:
SELECT * FROM sync_logs 
WHERE athlete_id = 123 
ORDER BY created_at DESC 
LIMIT 20;

# If worker crashed (status never changed to completed/error):
# Reset it:
curl -X POST https://api.example.com/api/admin/reset-stuck-syncs \
  -H "Content-Type: application/json" \
  -d '{"admin_strava_id": YOUR_ADMIN_ID}'
```

### "Only got 50 activities instead of 500"
```
Likely causes:
1. Sync didn't complete all iterations
2. Check sync_logs for errors
3. Worker may have timed out (status still 'in_progress')
4. Check Strava API status page

Next steps:
1. Manually stop sync: POST /api/admin/athletes/:id/sync/stop
2. Reset: POST /api/admin/reset-stuck-syncs
3. Trigger manual full refresh: POST /api/admin/athletes/:id/sync
```

### "Performance is slow on full refresh"
```
Current bottleneck: Single INSERT per race

Example: 200 activities × 200 athletes = 40,000 inserts
- Current: ~1ms per query = 40 seconds
- Batch INSERT: 20 batch inserts per athlete = <1 second

Improvement: Modify insertRace() to batch insert in groups of 5-10
```

---

## Checklist: Before Deploying Changes

- [ ] Modified sync logic in sync-queue.ts? → Test with mock data
- [ ] Changed batch size? → Verify doesn't exceed 30s timeout
- [ ] Added database schema? → Create migration file, not inline
- [ ] Changed cron schedule? → Update wrangler.toml
- [ ] Modified rate limiting? → Verify stays under 1000/day
- [ ] New API endpoint? → Add to index.ts router + admin.ts handler
- [ ] Changed database query? → Test with production-like data size
- [ ] All changes tested? → Run against staging first

---

## Key Insights

1. **Why batch pagination?** 
   - Cloudflare Workers timeout after 30 seconds
   - One API call = 2 seconds, one batch insert = 3 seconds
   - Splitting into 200-activity chunks = predictable timing

2. **Why full sync deletes all?**
   - Consistency: if athlete un-marked a race, we need to remove it
   - Event names saved beforehand to preserve user edits

3. **Why no traditional queue?**
   - Cloudflare Queues cost extra
   - Current loop-based approach works for <500 athletes
   - Simple, no external dependencies

4. **Why these rate limits?**
   - 500ms between athletes: prevents Strava API spikes
   - 1-second between batches: lets DB stabilize
   - 60-second between cron batches: big buffer for API recovery

---

## Next Steps for You

1. **Read files in order:**
   1. ANALYSIS_SUMMARY.txt (this summary)
   2. SYNC_IMPLEMENTATION_ANALYSIS.md (complete details)
   3. BATCHED_DOWNLOAD_DESIGN.md (improvements)
   4. CODEBASE_MAP.md (file reference)

2. **To modify the system:**
   - Batch size: `/workers/src/queue/sync-queue.ts` line 225
   - Delays: `/workers/src/cron/sync.ts` line 38
   - Cron time: `/wrangler.workers.toml` line 24
   - Database: Add migration file in `/database/migrations/`

3. **To improve it:**
   - Add batch INSERT (DB optimization)
   - Add automatic retry on timeout
   - Consider Cloudflare Queues (if scaling beyond 500 athletes)

---

**File Locations:**
- Analysis: `/home/user/strava_results/SYNC_IMPLEMENTATION_ANALYSIS.md`
- Design: `/home/user/strava_results/BATCHED_DOWNLOAD_DESIGN.md`
- Map: `/home/user/strava_results/CODEBASE_MAP.md`
- Summary: `/home/user/strava_results/ANALYSIS_SUMMARY.txt`

**Last Updated:** November 12, 2025
