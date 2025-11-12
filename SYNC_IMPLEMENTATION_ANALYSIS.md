# Strava Activity Download/Sync Implementation Analysis

## Executive Summary

The current implementation uses a **Cloudflare Workers-based architecture** with D1 SQLite database for syncing Strava race activities. The system has evolved to handle batch processing with timeout constraints through a loop-based pagination model that keeps the worker alive during data fetching.

### Key Infrastructure Facts
- **Platform**: Cloudflare Workers (serverless)
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: React/TypeScript (Cloudflare Pages)
- **Cron Schedule**: Monday 2 AM UTC (weekly, not daily)
- **Current Scale**: ~200 athletes
- **Queue System**: Custom in-memory batching (no external queue)

---

## 1. Current Download/Sync Implementation

### Entry Points

#### A. Scheduled Cron Job (`/workers/src/cron/sync.ts`)
```
Triggered: Weekly Monday at 2 AM UTC
Function: syncAllAthletes(env)
```

**Process Flow:**
1. Fetches all athletes from database
2. Processes in batches of 20 athletes
3. 1-minute delay between batches (60,000 ms)
4. 500 ms delay between individual athletes
5. Logs results to `sync_logs` table

**Key Code:**
```typescript
const batchSize = 20; // Process 20 athletes at a time
const delayBetweenBatches = 60000; // 1 minute between batches

for (let i = 0; i < athletes.length; i += batchSize) {
  const batch = athletes.slice(i, i + batchSize);
  // Process each athlete in batch
  for (const athlete of batch) {
    await syncAthlete(athlete.strava_id, env, false, false);
    await sleep(500);
  }
  // Delay between batches
  if (i + batchSize < athletes.length) {
    await sleep(delayBetweenBatches);
  }
}
```

#### B. Manual Admin Trigger (`POST /api/admin/athletes/:id/sync`)
- Allows admins to trigger manual sync for specific athlete
- Can be FULL refresh (delete all, re-fetch) or incremental
- Uses `ctx.waitUntil()` to keep worker alive during sync
- Supports session tracking with unique `sessionId`

**Key Code:**
```typescript
ctx.waitUntil(
  (async () => {
    await syncAthlete(athlete.strava_id, env, false, true, ctx, undefined, sessionId);
  })()
);
```

### The `syncAthlete()` Function - Core Sync Logic

**Location**: `/workers/src/queue/sync-queue.ts` (440+ lines)

**Signature:**
```typescript
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false,
  ctx?: ExecutionContext,
  continuationTimestamp?: number,
  sessionId?: string
): Promise<void>
```

**How It Works:**

1. **Outer Loop** - Keeps worker alive during pagination:
   ```typescript
   let batchNumber = 1;
   while (true) {
     const result = await syncAthleteInternal(...);
     if (!result.moreDataAvailable) break;
     currentTimestamp = result.oldestTimestamp;
     batchNumber++;
     await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
   }
   ```

2. **Internal Sync** - Single batch processing:
   ```typescript
   async function syncAthleteInternal(...) {
     // 1. Validate athlete and token
     // 2. For full sync: save event mappings, delete all races
     // 3. Fetch activities from Strava (max 1 page = 200 items)
     // 4. Filter for race activities (workout_type === 1)
     // 5. Insert/remove races in DB
     // 6. Return { moreDataAvailable, oldestTimestamp }
   }
   ```

**Pagination Strategy:**
- **Incremental Sync**: Uses `after` parameter (fetch activities since `last_synced_at`)
- **Full Sync**: Uses backward pagination with `before` parameter
- **Batch Size**: Limited to 1 page (200 activities) per iteration
- **Reason**: Avoid Cloudflare Workers timeout (30 seconds per request)

**Important Details:**
- Token refresh happens before fetching: `ensureValidToken()`
- Activities returned newest first, pagination uses oldest activity timestamp
- For full syncs, saves `event_name` mappings before deletion to preserve user edits
- Supports cancellation via `sync_status` check

### Strava API Integration (`/workers/src/utils/strava.ts`)

**Key Functions:**

1. **fetchAthleteActivities()**
   - Fetches activities with pagination support
   - Parameters: `after`, `before`, `perPage` (max 200), `maxPages`
   - Returns: `{ activities, rateLimits }`
   - Parses rate limit headers from Strava API

   **Pagination Logic:**
   ```typescript
   // When using 'before' for backward pagination, DON'T use 'page' parameter
   if (currentBefore) {
     url.searchParams.set('before', currentBefore.toString());
   } else {
     url.searchParams.set('page', page.toString());
   }
   ```

2. **ensureValidToken()**
   - Checks token expiry (5-minute buffer)
   - Auto-refreshes if needed
   - Updates database with new tokens

3. **filterRaceActivities()**
   - Only keeps activities where `type === 'Run'` AND `workout_type === 1`
   - Filters out casual runs, only race events

---

## 2. Main Reliability Issues & Bottlenecks

### A. Worker Timeout Constraint (30 seconds max)
**Problem**: Cloudflare Workers have a 30-second execution limit
**Current Solution**: Batch pagination (1 page per loop iteration)
**Evidence from commits**:
- `61d5555` - "Fix full sync timeout by enforcing batch limits"
- `32ec49e` - "Fix Strava API backward pagination and reduce batch size"

**Manifestation**:
- Full syncs for athletes with 1000+ activities require 5+ loop iterations
- Each iteration fetches 200 activities, processes them, and checks for more data
- With 1-second delays between iterations, a 1000-activity athlete takes ~5+ seconds

**Current Mitigations**:
```typescript
// Limit ALL syncs to 1 page (200 activities) per batch to avoid timeouts
const maxPagesPerBatch = 1;
```

### B. Strava API Rate Limits
**Limits**:
- 100 requests per 15 minutes
- 1,000 requests per day
- **Per-athlete cost**: ~1 request per sync (1 API call per 200 activities)

**Current Strategy**:
- Batch 20 athletes at a time
- 1-minute delay between batches
- 500 ms delay between individual athletes
- **Calculation**: 20 athletes × 20 batches = 400 requests, well under 1000/day

**Issues**:
- During full sync refresh, a single athlete with large history can hit rate limits
- No adaptive backoff when approaching limits
- Sync schedule is fixed (Monday 2 AM UTC) - if it fails, no automatic retry

### C. Pagination Correctness Issues (Recently Fixed)
**Problem from `32ec49e` commit**:
- Using both `page` parameter AND `before` parameter caused pagination errors
- Strava API doesn't handle this combination correctly

**Solution**:
```typescript
// When using 'before' for backward pagination, DON'T use 'page' parameter
if (currentBefore) {
  url.searchParams.set('before', currentBefore.toString());
} else {
  url.searchParams.set('page', page.toString());
}
```

### D. Stuck Sync State
**Problem**: If worker crashes during sync, athlete remains in `sync_status = 'in_progress'`
**Current Solution**: 
- Admin endpoint `/api/admin/reset-stuck-syncs` to manually reset
- No automatic timeout mechanism
- Database has fields: `sync_status`, `sync_error`, `total_activities_count`

### E. Session-based Logging
**Recent Addition** (commits `1f31dc9`, `2d846f1`):
- Each sync creates `sessionId` for tracking
- Logs written to `sync_logs` table with `athlete_id`, `sync_session_id`, `log_level`, `message`, `metadata`
- Allows real-time monitoring via `/api/admin/sync-logs?session_id=XXX`
- **Cleanup**: Keeps last 7 days only (via `cleanupOldSyncLogs()`)

---

## 3. Infrastructure & Architecture

### Technology Stack
```
┌─────────────────────────────────────────┐
│  Cloudflare Workers (Serverless)       │
│  - Cron: Weekly sync job                │
│  - HTTP: Admin/API endpoints            │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  Cloudflare D1 (SQLite Database)       │
│  - athletes: OAuth tokens, sync status  │
│  - races: Activity data                 │
│  - sync_logs: Monitoring                │
└─────────────────────────────────────────┘
```

### Database Schema Relevant to Sync

**athletes table:**
```sql
CREATE TABLE athletes (
  id INTEGER PRIMARY KEY,
  strava_id INTEGER UNIQUE,
  access_token, refresh_token, token_expiry,
  last_synced_at INTEGER,           -- Last successful fetch timestamp
  sync_status TEXT,                  -- 'idle', 'in_progress', 'completed', 'error'
  sync_error TEXT,                   -- Error message if sync failed
  total_activities_count INTEGER,    -- Total activities processed in last sync
  created_at, updated_at
);
```

**races table:**
```sql
CREATE TABLE races (
  id INTEGER PRIMARY KEY,
  athlete_id INTEGER FOREIGN KEY,
  strava_activity_id INTEGER UNIQUE,
  name, distance, elapsed_time, moving_time,
  date, elevation_gain,
  average_heartrate, max_heartrate,
  event_name,                        -- User-assigned event name
  created_at
);
```

**sync_logs table** (for monitoring):
```sql
CREATE TABLE sync_logs (
  id INTEGER PRIMARY KEY,
  athlete_id INTEGER,
  sync_session_id TEXT,
  log_level TEXT,                    -- 'info', 'warning', 'error', 'success'
  message TEXT,
  metadata TEXT,                     -- JSON string
  created_at INTEGER
);
```

**Index Strategy**:
- `idx_races_athlete_id` - Fast lookup by athlete
- `idx_races_date` - Fast sorting/filtering by date
- `idx_races_distance` - Distance range queries
- `idx_sync_logs_athlete_session` - Session tracking

### API Entry Points

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync` | POST | Manual full system sync (testing) |
| `/api/admin/athletes/:id/sync` | POST | Trigger sync for one athlete (full refresh) |
| `/api/admin/athletes/:id/sync/stop` | POST | Stop in-progress sync |
| `/api/admin/reset-stuck-syncs` | POST | Reset all stuck `in_progress` statuses |
| `/api/admin/sync-logs` | GET | Fetch logs for a session (real-time monitoring) |
| `/api/admin/athletes` | GET | List all athletes with sync status |

---

## 4. Existing Queue/Background Job Mechanisms

### Current Implementation: NOT a Traditional Queue

**What Exists**:
1. **In-memory batching loop**: `syncAthlete()` while loop keeps worker alive
2. **Session tracking**: `sessionId` for real-time monitoring
3. **Logging infrastructure**: `sync_logs` table with `logSyncProgress()` utility

**What Doesn't Exist**:
- No external queue service (Redis, RabbitMQ, Cloudflare Queues)
- No automatic retry mechanism (manual reset only)
- No dead-letter queue for failed tasks
- No message acknowledgment pattern

### File References
- **Queue/sync logic**: `/workers/src/queue/sync-queue.ts`
- **Logger utility**: `/workers/src/utils/sync-logger.ts`
- **Database helpers**: `/workers/src/utils/db.ts`

**sync-logger.ts exports:**
```typescript
logSyncProgress()        // Write log entry
getSyncLogs()           // Fetch logs for a session
cleanupOldSyncLogs()    // Remove logs >7 days old
```

---

## 5. The syncAthlete Function - Detailed Breakdown

### Function Signature & Parameters
```typescript
export async function syncAthlete(
  athleteStravaId: number,    // Strava ID to sync
  env: Env,                   // Cloudflare bindings (DB, secrets)
  isInitialSync: boolean,     // True = new athlete (not used currently)
  fullSync: boolean,          // True = delete all + re-fetch, False = incremental
  ctx?: ExecutionContext,     // Optional: allows ctx.waitUntil() for background
  continuationTimestamp?: number,  // For pagination: fetch before this timestamp
  sessionId?: string          // For logging: track this sync session
): Promise<void>
```

### Execution Flow Diagram

```
┌─ syncAthlete() [OUTER LOOP - Keeps Worker Alive]
│  │
│  ├─ While loop iteration
│  │  │
│  │  ├─ syncAthleteInternal() [INNER - Single Batch]
│  │  │  │
│  │  │  ├─ Validate athlete exists
│  │  │  ├─ For FULL sync (first batch):
│  │  │  │  ├─ Save event_name mappings
│  │  │  │  └─ DELETE FROM races WHERE athlete_id = ?
│  │  │  │
│  │  │  ├─ Set status = 'in_progress'
│  │  │  ├─ Check if sync was cancelled
│  │  │  │
│  │  │  ├─ ensureValidToken()
│  │  │  │  ├─ Check expiry
│  │  │  │  └─ Refresh if needed + update DB
│  │  │  │
│  │  │  ├─ Determine pagination:
│  │  │  │  ├─ FULL/continuation: beforeTimestamp = continuationTimestamp
│  │  │  │  └─ INCREMENTAL: afterTimestamp = last_synced_at
│  │  │  │
│  │  │  ├─ fetchAthleteActivities()
│  │  │  │  ├─ GET /athlete/activities with params
│  │  │  │  ├─ Parse rate limit headers
│  │  │  │  └─ Return { activities[], rateLimits }
│  │  │  │
│  │  │  ├─ filterRaceActivities()
│  │  │  │  └─ Keep only: type='Run' AND workout_type=1
│  │  │  │
│  │  │  ├─ For FULL sync: insert all races + restore event_names
│  │  │  ├─ For INCREMENTAL: 
│  │  │  │  ├─ Remove races no longer marked as races
│  │  │  │  └─ Insert new races
│  │  │  │
│  │  │  ├─ Calculate moreDataAvailable = (activities.length === 200)
│  │  │  ├─ Update athlete: last_synced_at, sync_status, total_activities_count
│  │  │  └─ Return { moreDataAvailable, oldestTimestamp }
│  │  │
│  │  ├─ If moreDataAvailable:
│  │  │  ├─ currentTimestamp = result.oldestTimestamp
│  │  │  ├─ batchNumber++
│  │  │  ├─ Sleep 1 second
│  │  │  └─ LOOP back to while
│  │  └─ Else:
│  │     ├─ Set status = 'completed'
│  │     ├─ Log success
│  │     └─ BREAK
│  │
│  └─ Catch errors:
│     ├─ Set status = 'error'
│     ├─ Store error message
│     └─ Re-throw
```

### Key Decision Points

1. **Batch Size Limit**: Hardcoded to 1 page (200 activities)
   - Reason: Avoid 30-second Worker timeout
   - Compromise: Multiple loop iterations for large activity histories

2. **Full Sync Strategy**: Delete all races first
   - Reason: Ensures consistency (e.g., if athlete un-marks a race)
   - Preservation: Event name mappings saved before deletion
   - Cost: Extra work, but guarantees clean state

3. **Pagination Direction**:
   - INCREMENTAL: Forward using `after` (fetch new activities)
   - FULL: Backward using `before` (oldest activities first)
   - Reason: Cloudflare API prefers backward pagination for stability

4. **Cancellation Mechanism**:
   ```typescript
   const isSyncCancelled = async (): Promise<boolean> => {
     const status = await env.DB.prepare(
       `SELECT sync_status FROM athletes WHERE id = ?`
     ).bind(athlete.id).first();
     return status?.sync_status !== 'in_progress';
   };
   // Check before fetching and before inserting
   ```

---

## 6. Rate Limiting & Timeout Issues

### Strava API Rate Limits (Hard Limits)
- **100 requests per 15 minutes**
- **1,000 requests per day**

### Current Approach
```
Cron runs weekly (Monday 2 AM UTC)
  ↓
20 athletes per batch
  ↓
500ms delay between athletes (20 athletes = 10 seconds per batch)
  ↓
60-second delay between batches
  ↓
Cost: ~1 API call per athlete per week = ~200 requests/week
```

**Rate Limit Safety**: ✅ Well within limits
- 200 requests/week << 1,000/day
- 100/15min: Single batch of 20 athletes (1 call each) = 20 requests in 20 seconds

### Worker Timeout Issues (30 seconds per request)

**Problem**: A single athlete with 1000+ activities needs 5+ loop iterations
- Each iteration: 1 second API call + 1 second delay = 2 seconds minimum
- 5 iterations = 10+ seconds total (safe from 30s limit)

**Risk**: If API calls slow down or DB queries block:
- Iteration time could exceed 30 seconds
- Worker would be killed mid-sync

**Current Mitigations**:
1. Batch size limited to 200 activities
2. 1-second delays between iterations (predictable timing)
3. No DB writes during API calls (writes after data arrives)

**Monitoring**: `sync_logs` table shows which batches completed

---

## 7. Database Fields for Sync Tracking

### Athletes Table Fields
| Field | Type | Purpose |
|-------|------|---------|
| `last_synced_at` | INTEGER (Unix timestamp) | Used as `after` parameter for incremental syncs |
| `sync_status` | TEXT | 'idle', 'in_progress', 'completed', 'error' |
| `sync_error` | TEXT | Error message if status = 'error' |
| `total_activities_count` | INTEGER | Total activities processed in last sync |
| `token_expiry` | INTEGER | Token expiry timestamp (for refresh check) |
| `is_admin` | INTEGER (0/1) | For permission checks |
| `is_hidden` | INTEGER (0/1) | Hide from dashboard |
| `is_blocked` | INTEGER (0/1) | Block from syncing |

### Sync Logs Table Fields
| Field | Type | Purpose |
|-------|------|---------|
| `athlete_id` | INTEGER FK | Link to athlete |
| `sync_session_id` | TEXT | Unique session identifier (`sync-${athleteId}-${Date.now()}`) |
| `log_level` | TEXT | 'info', 'warning', 'error', 'success' |
| `message` | TEXT | Human-readable log message |
| `metadata` | TEXT (JSON) | Additional structured data (batch number, counts, etc.) |
| `created_at` | INTEGER | Timestamp |

---

## Summary of Key Findings

### What Works Well
1. ✅ Strava OAuth flow is solid and secure
2. ✅ Rate limiting strategy is conservative and safe
3. ✅ Token refresh is automatic and handles expiry correctly
4. ✅ Pagination logic is now correct (backward pagination fixed)
5. ✅ Session-based logging enables real-time monitoring
6. ✅ Database schema is normalized and indexed appropriately

### Known Limitations
1. ⚠️ **No traditional queue**: Manual `ctx.waitUntil()` instead of proper queue service
2. ⚠️ **No automatic retry**: Failed syncs must be manually reset
3. ⚠️ **Worker timeout risk**: If iterations exceed 30 seconds, worker dies
4. ⚠️ **Fixed schedule**: Weekly Monday 2 AM UTC - not flexible
5. ⚠️ **No dead-letter queue**: Failed operations are lost
6. ⚠️ **Incremental only**: Once full sync fails, manual reset needed
7. ⚠️ **Limited observability**: Only basic console.log + sync_logs table

### Recent Improvements
- Added comprehensive session-based logging (commit `1f31dc9`)
- Fixed backward pagination (commit `32ec49e`)
- Added real-time sync monitoring UI (commit `70819b8`)
- Added manual sync control endpoints (admin API)
- Added sync cancellation capability

---

## Files You Should Know About

### Core Sync Logic
- `/workers/src/queue/sync-queue.ts` (440 lines) - Main `syncAthlete()` function
- `/workers/src/cron/sync.ts` (132 lines) - Scheduled sync entry point
- `/workers/src/utils/strava.ts` (309 lines) - Strava API client

### Database & Logging
- `/workers/src/utils/db.ts` (164 lines) - DB helpers (upsert, insert, delete)
- `/workers/src/utils/sync-logger.ts` (78 lines) - Session-based logging
- `/database/schema.sql` - Full schema with comments
- `/database/migrations/` - 9 migrations including sync_logs table

### Admin/Manual Controls
- `/workers/src/api/admin.ts` (453 lines) - Admin endpoints for manual sync/status
- `/workers/src/index.ts` (212 lines) - Router with all endpoints

### Frontend Monitoring
- `/frontend/src/pages/SyncMonitor.tsx` - Real-time sync status display
