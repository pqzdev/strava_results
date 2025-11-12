# Strava Sync Implementation - Complete Codebase Map

This document maps all relevant files related to the Strava activity download/sync system.

## Core Sync Logic Files

### `/workers/src/queue/sync-queue.ts` (440 lines)
**Purpose**: Main sync orchestration for individual athletes
**Key Exports**:
- `syncAthlete()` - Primary function handling both incremental and full syncs
- `syncAthleteInternal()` - Single batch processing
- `handleSyncQueue()` - Message queue consumer (if queue system used)

**Key Concepts**:
- Outer while loop for pagination (keeps worker alive)
- Batch size limited to 200 activities (1 page)
- Full sync: DELETE all races, then re-INSERT
- Incremental sync: Only INSERT new races
- Event name mapping preservation for full syncs
- Sync cancellation support via `sync_status` check

**Entry Parameters**:
```typescript
syncAthlete(
  athleteStravaId: number,      // Who to sync
  env: Env,                      // Cloudflare bindings
  isInitialSync: boolean,        // New athlete flag (not actively used)
  fullSync: boolean,             // DELETE all (true) vs incremental (false)
  ctx?: ExecutionContext,        // For ctx.waitUntil()
  continuationTimestamp?: number,// For pagination continuation
  sessionId?: string             // Unique sync session ID for logging
)
```

---

### `/workers/src/cron/sync.ts` (132 lines)
**Purpose**: Scheduled cron job entry point for syncing all athletes
**Triggered**: Weekly Monday 2 AM UTC (configurable via wrangler.toml)

**Main Function**: `syncAllAthletes(env)`
**Key Steps**:
1. Fetch all athletes from database
2. Process in batches of 20 athletes
3. 1-minute delay between batches (rate limiting)
4. 500ms delay between individual athletes
5. Creates `sync_logs` entry with completion stats
6. Runs event analysis after sync (optional)

**Important Code**:
```typescript
const batchSize = 20;              // Athletes per batch
const delayBetweenBatches = 60000; // 1 minute = 60,000 ms
```

---

### `/workers/src/utils/strava.ts` (309 lines)
**Purpose**: Strava API client library
**Key Functions**:

1. **`exchangeCodeForToken(code, env)`**
   - OAuth code → access/refresh tokens
   - Used during initial auth flow

2. **`refreshAccessToken(refreshToken, env)`**
   - Refresh expired tokens
   - Called by `ensureValidToken()`

3. **`isTokenExpired(tokenExpiry)`**
   - Check if token needs refresh
   - 5-minute buffer built in

4. **`ensureValidToken(athlete, env)`**
   - Validates token, refreshes if needed
   - Updates database with new tokens
   - Called at start of each sync iteration

5. **`fetchAthleteActivities(accessToken, after?, before?, perPage=200, maxPages?)`**
   - Core API call to get activities
   - Supports pagination via `after` (forward) or `before` (backward)
   - Returns activities array + rate limit info
   - Parses X-RateLimit-* headers from response
   - **Important Note**: Don't use both `page` and `before` parameters together

6. **`filterRaceActivities(activities)`**
   - Filters to only race activities
   - Condition: `type === 'Run'` AND `workout_type === 1`

7. **`getAthleteClubs(accessToken)`**
   - Fetch athlete's Strava clubs
   - With pagination support

8. **`buildAuthorizationUrl(env)`**
   - Generate OAuth authorization URL
   - Scope: `read,activity:read_all`

---

### `/workers/src/utils/db.ts` (164 lines)
**Purpose**: Database helper functions
**Key Functions**:

1. **`getAthleteByStravaId(stravaId, env)`**
   - Fetch athlete record by Strava ID
   - Used at start of every sync

2. **`upsertAthlete(stravaId, firstname, lastname, profilePhoto, accessToken, refreshToken, tokenExpiry, env)`**
   - INSERT or UPDATE athlete
   - Used during OAuth callback

3. **`getAllAthletes(env)`**
   - Fetch all athletes for cron job
   - Used by `syncAllAthletes()`

4. **`updateLastSyncedAt(athleteId, env)`**
   - Update timestamp of last successful sync
   - Used for incremental sync pagination

5. **`raceExists(stravaActivityId, env)`**
   - Check if activity already in database
   - Returns boolean

6. **`insertRace(athleteId, activity, env)`**
   - Insert single race activity
   - Called for each race found during sync
   - **Performance Note**: Single INSERT per race (not batched)

7. **`deleteAthleteData(stravaId, env)`**
   - GDPR deletion endpoint
   - Cascades to delete all races

---

### `/workers/src/utils/sync-logger.ts` (78 lines)
**Purpose**: Session-based logging for real-time sync monitoring
**Key Functions**:

1. **`logSyncProgress(env, athleteId, sessionId, level, message, metadata?)`**
   - Write log entry to `sync_logs` table
   - Called frequently during sync
   - Metadata is JSON-stringified for structured logging

2. **`getSyncLogs(env, sessionId, limit=100)`**
   - Fetch all logs for a session
   - Supports pagination
   - Used by admin endpoint to display real-time progress

3. **`cleanupOldSyncLogs(env)`**
   - Delete logs older than 7 days
   - Should be called periodically (not currently automated)

**Log Levels**: `'info'`, `'warning'`, `'error'`, `'success'`
**Session ID Format**: `sync-${athleteId}-${Date.now()}`

---

## API & Admin Endpoints

### `/workers/src/api/admin.ts` (453 lines)
**Purpose**: Admin endpoints for manual sync control and monitoring
**Key Functions**:

1. **`getAdminAthletes(request, env)`**
   - GET /api/admin/athletes
   - Returns all athletes with: sync_status, sync_error, race_count, total_activities_count
   - Requires admin authentication

2. **`updateAthlete(request, env, athleteId)`**
   - PATCH /api/admin/athletes/:id
   - Update: is_admin, is_hidden, is_blocked
   - Requires admin authentication

3. **`deleteAthlete(request, env, athleteId)`**
   - DELETE /api/admin/athletes/:id
   - Cascades to delete all races
   - Requires admin authentication

4. **`triggerAthleteSync(request, env, ctx, athleteId)`**
   - POST /api/admin/athletes/:id/sync
   - Trigger manual sync for one athlete (FULL refresh)
   - Uses `ctx.waitUntil()` to keep worker alive
   - Returns session ID for monitoring
   - Supports sync cancellation if one in progress

5. **`stopAthleteSync(request, env, athleteId)`**
   - POST /api/admin/athletes/:id/sync/stop
   - Stop in-progress sync
   - Sets status back to 'completed'

6. **`resetStuckSyncs(request, env)`**
   - POST /api/admin/reset-stuck-syncs
   - Reset all athletes in 'in_progress' state
   - Useful after worker crashes

7. **`getAdminSyncLogs(request, env)`**
   - GET /api/admin/sync-logs?session_id=XXX
   - Fetch logs for a specific sync session
   - Enables real-time monitoring

---

### `/workers/src/index.ts` (212 lines)
**Purpose**: Main worker entry point and HTTP router
**Key Handlers**:

1. **`fetch(request, env, ctx)`** - HTTP request handler
   - Routes all HTTP requests
   - CORS headers handling
   - Error responses

2. **`scheduled(event, env)`** - Cron trigger handler
   - Called by scheduled cron
   - Calls `syncAllAthletes(env)`
   - Wrapped in try-catch to log errors

**Routing Examples**:
```
GET  /auth/authorize              → handleAuthorize()
GET  /auth/callback               → handleCallback()
DELETE /auth/disconnect           → handleDisconnect()
GET  /api/races                   → getRaces()
GET  /api/stats                   → getStats()
GET  /api/athletes                → getAthletes()
POST /api/admin/athletes/:id/sync → triggerAthleteSync()
POST /api/sync                    → syncAllAthletes()
```

---

## Database Schema & Migrations

### `/database/schema.sql`
**Main file**: Complete database schema with all tables and indexes
**Tables**:
- `athletes` - OAuth tokens, sync status, last sync timestamp
- `races` - Activity data, filters for race-only activities
- `sync_logs` - Monitoring and logging
- `parkrun_results` - Related but separate system
- `parkrun_athletes` - Related but separate system

**Key Sync-Related Columns**:
- athletes: `last_synced_at`, `sync_status`, `sync_error`, `total_activities_count`
- races: `athlete_id`, `strava_activity_id`, `event_name`, `date`
- sync_logs: `athlete_id`, `sync_session_id`, `log_level`, `message`, `metadata`

**Indexes**:
```sql
idx_athletes_strava_id          -- Fast athlete lookup
idx_races_athlete_id             -- Fast race lookup by athlete
idx_races_date                   -- Fast sorting by date
idx_races_strava_activity_id     -- Prevent duplicates
idx_sync_logs_athlete_session    -- Fast log retrieval
```

---

### `/database/migrations/`
**Migration Files** (9 total):
- `0000_initial_schema.sql` - Athletes, races tables
- `0001_add_race_edits_table.sql` - Track race modifications
- `0002_add_manual_time.sql` - User-editable race time
- `0003_add_manual_distance.sql` - User-editable distance
- `0004_add_admin_fields.sql` - is_admin, is_hidden, is_blocked columns
- `0005_add_parkrun_tables.sql` - Parkrun-specific tables
- `0006_add_parkrun_gender_position.sql` - Parkrun metrics
- `0007_add_event_names.sql` - Event name assignments
- `0008_add_sync_logs.sql` - Session-based logging for real-time monitoring

**Important**: Run migrations on deploy via Cloudflare D1

---

## Configuration Files

### `/wrangler.workers.toml`
**Cloudflare Workers configuration**
```toml
name = "strava-club-workers"
main = "workers/src/index.ts"
compatibility_date = "2024-11-10"

[build]
command = "cd workers && npm run build"

[[d1_databases]]
binding = "DB"
database_name = "strava-club-db"
migrations_dir = "database/migrations"

[triggers]
crons = ["0 2 * * 1"]  # Monday 2 AM UTC
```

**Key Bindings**:
- `DB` - D1 Database
- `AI` - Cloudflare AI (for event analysis)

---

## Frontend Monitoring Components

### `/frontend/src/pages/SyncMonitor.tsx`
**Purpose**: Real-time sync monitoring dashboard
**Features**:
- Displays sync status for each athlete
- Shows live logs from sync_logs table
- Allows manual sync trigger
- Shows error messages if sync failed
- Fetches from `/api/admin/sync-logs?session_id=XXX`

---

## Types & Interfaces

### `/workers/src/types.ts` (100 lines)
**Key Type Definitions**:

```typescript
interface Env {
  DB: D1Database;
  AI: Ai;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REDIRECT_URI: string;
  STRAVA_CLUB_ID: string;
}

interface Athlete {
  id: number;
  strava_id: number;
  firstname: string;
  lastname: string;
  access_token: string;
  refresh_token: string;
  token_expiry: number;
  last_synced_at?: number;
  sync_status?: string;
  sync_error?: string;
  total_activities_count?: number;
  is_admin?: number;
  is_hidden?: number;
  is_blocked?: number;
}

interface StravaActivity {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  type: string;                  // e.g., 'Run'
  workout_type?: number;         // 1 = Race, null/0 = casual
  start_date: string;
  start_date_local: string;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

interface RateLimitInfo {
  limit_15min: number;
  usage_15min: number;
  limit_daily: number;
  usage_daily: number;
}
```

---

## Related Files (Non-Sync But Important)

### Authentication
- `/workers/src/auth/oauth.ts` - OAuth flow handlers
  - `handleAuthorize()` - Redirect to Strava
  - `handleCallback()` - Process OAuth code
  - `handleDisconnect()` - GDPR deletion

### Other API Endpoints
- `/workers/src/api/races.ts` - Dashboard race listing, filtering
- `/workers/src/api/events.ts` - Event suggestion system
- `/workers/src/api/parkrun.ts` - Parkrun-specific endpoints
- `/workers/src/api/parkrun-import.ts` - CSV import for parkrun

### Utilities
- `/workers/src/utils/eventAnalysis.ts` - AI-based event name suggestion
- `/frontend/src/pages/Dashboard.tsx` - Frontend dashboard
- `/frontend/src/components/RaceCard.tsx` - Individual race display

---

## Deployment Configuration

### GitHub Actions
- `.github/workflows/deploy-workers.yml` - Deploy Workers
- `.github/workflows/deploy-pages.yml` - Deploy Pages

**Process**:
1. Push to main
2. GitHub Actions triggers
3. `npm install` + `wrangler deploy`
4. Workers live at production URL

---

## Call Flow Diagram

```
Weekly Cron Trigger (Monday 2 AM UTC)
    ↓
workers/src/index.ts :: scheduled()
    ↓
workers/src/cron/sync.ts :: syncAllAthletes()
    ├─ getAllAthletes() [db.ts]
    ├─ For each athlete (20 at a time):
    │  ├─ syncAthlete() [sync-queue.ts]
    │  │  ├─ While loop (pagination):
    │  │  │  ├─ syncAthleteInternal()
    │  │  │  │  ├─ ensureValidToken() [strava.ts]
    │  │  │  │  ├─ fetchAthleteActivities() [strava.ts]
    │  │  │  │  ├─ filterRaceActivities() [strava.ts]
    │  │  │  │  ├─ insertRace() [db.ts]
    │  │  │  │  └─ logSyncProgress() [sync-logger.ts]
    │  │  │  └─ Check moreDataAvailable, continue if true
    │  │  └─ Update sync_status to 'completed'
    │  └─ Sleep 500ms
    └─ analyzeEvents() [eventAnalysis.ts]

Manual Sync Trigger (Admin)
    ↓
workers/src/index.ts :: fetch() → POST /api/admin/athletes/:id/sync
    ↓
workers/src/api/admin.ts :: triggerAthleteSync()
    ├─ ctx.waitUntil(async () => {
    │  └─ syncAthlete(id, env, false, true, ctx, undefined, sessionId)
    │     └─ [Same as above, but with sessionId for logging]
    └─ Return success + sessionId
```

---

## Quick Reference: Which File to Edit

| Task | File to Edit |
|------|--------------|
| Change batch size | `sync-queue.ts` line 225 (`maxPagesPerBatch = 1`) |
| Change cron schedule | `wrangler.workers.toml` line 24 (`crons = [...]`) |
| Change delay between athletes | `cron/sync.ts` line 38 (`delayBetweenBatches`) |
| Add new logging | Call `logSyncProgress()` in sync-queue.ts |
| Add admin endpoint | Add route to `index.ts` + handler in `api/admin.ts` |
| Fix race filtering | Edit `filterRaceActivities()` in `utils/strava.ts` |
| Handle new Strava fields | Update `StravaActivity` type in `types.ts` + DB schema |
| Change database schema | Add migration to `database/migrations/` |
| Update rate limiting | Modify sync delays in `cron/sync.ts` |

---

## Key Constants to Know

| Constant | Value | Meaning |
|----------|-------|---------|
| Batch size | 200 | Max activities per API call (Strava limit) |
| Pages per iteration | 1 | Prevent timeout (stay under 30s) |
| Delay between iterations | 1000 ms | Rate limiting |
| Delay between athletes | 500 ms | Rate limiting |
| Delay between batches | 60000 ms | 1 minute (rate limiting) |
| Batch size (cron) | 20 | Athletes per batch |
| Strava rate limit | 100/15min, 1000/day | Hard limits |
| Worker timeout | 30 seconds | Cloudflare limit |
| Token buffer | 300 seconds | 5 minutes before expiry |

