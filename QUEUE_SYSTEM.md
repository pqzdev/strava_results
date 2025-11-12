# Strava Sync Queue System

## Overview

The Strava sync queue system provides **reliable, batched activity downloads** using a D1 database-backed queue. This solves the critical reliability issues caused by Cloudflare Workers' 30-second execution timeout.

## Architecture

### Design Philosophy

Instead of using Cloudflare Queues (not available) or file-based queues (unreliable), we use the **existing D1 SQLite database** as a persistent, ACID-compliant queue.

### Key Components

1. **`sync_queue` Table** - Persistent job storage in D1 database
2. **Queue Processor** - Cron-triggered worker (every 2 minutes)
3. **Job Management API** - REST endpoints for queue operations
4. **Admin UI** - Web interface for queue monitoring and control

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    Job Creation                          │
│  • Weekly cron (Monday 2AM UTC)                          │
│  • Manual trigger from Admin UI                          │
│  • Individual athlete sync requests                      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              sync_queue Table (D1)                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Job 1: athlete_id=1, status=pending, priority=0 │   │
│  │ Job 2: athlete_id=2, status=pending, priority=0 │   │
│  │ Job 3: athlete_id=3, status=processing ...      │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│          Queue Processor (Every 2 minutes)               │
│                                                          │
│  1. Atomically claim next pending job (SQL UPDATE)      │
│  2. Process sync with timeout safety (25 seconds)       │
│  3. Update job status:                                  │
│     • completed: Sync finished successfully             │
│     • failed: Max retries reached                       │
│     • pending: Retry later (increment retry_count)      │
└─────────────────────────────────────────────────────────┘
```

## Database Schema

```sql
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  athlete_id INTEGER NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'full_sync', -- 'full_sync' or 'incremental_sync'
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 0,                  -- Higher = more urgent
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Resumable sync state
  last_processed_before INTEGER,              -- Unix timestamp for pagination
  activities_synced INTEGER DEFAULT 0,
  total_activities_expected INTEGER,
  sync_session_id TEXT,

  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);
```

### Key Indexes

```sql
-- Efficient job claiming (most critical query)
CREATE INDEX idx_sync_queue_claim
  ON sync_queue(status, priority DESC, created_at ASC)
  WHERE status = 'pending';

-- Athlete-specific queries
CREATE INDEX idx_sync_queue_athlete
  ON sync_queue(athlete_id, status, created_at DESC);

-- Monitoring and cleanup
CREATE INDEX idx_sync_queue_completed
  ON sync_queue(completed_at DESC)
  WHERE status IN ('completed', 'failed');
```

## Reliability Features

### 1. **Atomic Job Claiming**

Prevents race conditions when multiple workers try to claim the same job:

```sql
UPDATE sync_queue
SET status = 'processing', started_at = ?
WHERE id = (
  SELECT id FROM sync_queue
  WHERE status = 'pending'
  AND retry_count < max_retries
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
)
RETURNING *
```

### 2. **Automatic Retry**

Failed jobs automatically retry with configurable limits:

- Default: 3 retries
- After max retries: Job marked as `failed`
- Retry logic preserves error messages for debugging

### 3. **Resumable Syncs**

Jobs save progress after each batch:

- `last_processed_before`: Pagination cursor
- `activities_synced`: Count of processed activities
- `sync_session_id`: Links to detailed sync logs

If a job times out, it can resume from where it left off.

### 4. **Timeout Safety**

Workers process for max 25 seconds (5-second buffer before 30s timeout):

- Jobs batch activities in 200-activity chunks
- 1-second delay between batches for rate limiting
- Automatic continuation if more data available

### 5. **Observable**

Built-in monitoring via SQL queries:

```sql
-- Queue statistics (last 24 hours)
SELECT
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_24h,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_24h
FROM sync_queue
WHERE created_at > ?
```

## API Endpoints

### Get Queue Statistics

```http
GET /api/queue/stats
```

**Response:**
```json
{
  "pending": 5,
  "processing": 1,
  "completed_24h": 150,
  "failed_24h": 2,
  "total_queued": 158
}
```

### Queue All Athletes

```http
POST /api/queue/all
Content-Type: application/json

{
  "jobType": "full_sync",  // or "incremental_sync"
  "priority": 0
}
```

**Response:**
```json
{
  "message": "Queued 200 athletes",
  "jobIds": [1, 2, 3, ...]
}
```

### Queue Specific Athlete

```http
POST /api/queue/athletes/:athleteId
Content-Type: application/json

{
  "jobType": "full_sync",
  "priority": 10  // Higher priority = processed first
}
```

**Response:**
```json
{
  "message": "Queued athlete 42",
  "jobId": 123
}
```

### Clean Up Old Jobs

```http
POST /api/queue/cleanup
```

Deletes completed/failed jobs older than 7 days.

**Response:**
```json
{
  "message": "Cleaned up 150 old jobs",
  "deleted": 150
}
```

## Cron Schedules

### 1. Weekly Queue Creation (Monday 2AM UTC)

```toml
crons = ["0 2 * * 1"]
```

**Purpose:** Queue all connected athletes for full sync

**Actions:**
- Creates `full_sync` jobs for all athletes with valid tokens
- Cleans up old completed/failed jobs (>7 days)

### 2. Queue Processor (Every 2 Minutes)

```toml
crons = ["*/2 * * * *"]
```

**Purpose:** Process next pending job from queue

**Actions:**
- Atomically claims highest-priority pending job
- Processes sync with timeout safety
- Updates job status (completed/failed/retry)

## Admin UI

Located at `/admin`, the queue management section shows:

### Queue Statistics (Auto-refreshes every 30s)

- ⏳ **Pending Jobs** - Waiting to be processed
- ⚙️ **Processing** - Currently being synced
- ✅ **Completed (24h)** - Successfully finished jobs
- ❌ **Failed (24h)** - Jobs that failed after max retries

### Manual Controls

- **Queue All Athletes** - Trigger full sync for all connected athletes (priority: 0)
- **Individual "Queue" button** - Queue specific athlete for sync (priority: 10)
  - Higher priority = processed before weekly batch syncs
  - Displayed as 🚀 Queue button in athlete row
  - Shows confirmation with job ID when queued

## Implementation Files

```
workers/src/
├── queue/
│   ├── queue-processor.ts     # Queue processing logic
│   └── sync-queue.ts           # Existing sync implementation
├── index.ts                    # Updated with queue cron & API endpoints
database/migrations/
└── 0009_add_sync_queue.sql     # Queue table schema
frontend/src/pages/
└── Admin.tsx                   # Queue management UI
```

## Migration Path

### From Loop-Based Sync to Queue-Based Sync

The queue system has **fully replaced** the old sync system:

1. **Weekly cron** - Queues all athletes for sync (priority: 0)
2. **Queue processor** - Processes jobs one by one every 2 minutes
3. **Existing `syncAthlete()` function** - Remains unchanged, called by queue processor
4. **Admin UI** - All syncs now use the queue system:
   - "Queue All Athletes" button → Batch queue (priority: 0)
   - Individual "Queue" buttons → High priority queue (priority: 10)

### Benefits of Full Migration

✅ **All syncs** get automatic retry and timeout protection
✅ **Manual syncs** have higher priority (processed first)
✅ **Consistent behavior** across all sync triggers
✅ **Full observability** via queue stats

## Performance Characteristics

### Throughput

- **Jobs processed:** 1 every 2 minutes = 30 per hour = 720 per day
- **Activities per job:** ~200-2000 (varies by athlete)
- **Sufficient for:** 200 athletes with weekly full sync

### Rate Limits (Strava API)

- **Current usage:** ~200 requests per week (well under limits)
- **Strava limits:**
  - 100 requests per 15 minutes
  - 1000 requests per day

With 200 athletes × 1 request each = 200 requests/week

**Safe margin:** 5x under daily limit, 50x under 15-min limit

### Latency

- **Job pickup delay:** 0-2 minutes (cron frequency)
- **Single athlete sync:** 1-10 minutes (depends on activity count)
- **Full sync (200 athletes):** 6-7 hours (200 jobs × 2 min/job)

## Monitoring

### Check Queue Status

```bash
# From CloudFlare dashboard > D1
SELECT status, COUNT(*) as count
FROM sync_queue
WHERE created_at > strftime('%s', 'now', '-24 hours') * 1000
GROUP BY status;
```

### Find Failed Jobs

```bash
SELECT id, athlete_id, error_message, retry_count
FROM sync_queue
WHERE status = 'failed'
ORDER BY completed_at DESC
LIMIT 10;
```

### Monitor Processing Time

```bash
SELECT
  id,
  athlete_id,
  (completed_at - started_at) / 1000 as duration_seconds
FROM sync_queue
WHERE status = 'completed'
  AND completed_at > strftime('%s', 'now', '-24 hours') * 1000
ORDER BY duration_seconds DESC
LIMIT 10;
```

## Troubleshooting

### Jobs Stuck in "processing"

**Symptom:** Jobs remain in `processing` status for >10 minutes

**Cause:** Worker crashed or timed out without updating status

**Fix:**
```sql
-- Reset stuck jobs (processing > 10 minutes)
UPDATE sync_queue
SET status = 'pending',
    started_at = NULL,
    retry_count = retry_count + 1
WHERE status = 'processing'
  AND started_at < strftime('%s', 'now', '-10 minutes') * 1000;
```

### Queue Not Processing

**Symptom:** Pending jobs remain pending

**Check:**
1. Cron trigger is enabled: `wrangler deployments list`
2. Worker logs: `wrangler tail` during cron execution
3. D1 database connectivity

**Fix:** Redeploy worker with `wrangler deploy`

### High Failure Rate

**Symptom:** Many jobs in `failed` status

**Check:**
1. Error messages: `SELECT error_message FROM sync_queue WHERE status = 'failed'`
2. Strava API rate limits
3. Token expiration issues

**Fix:** Address root cause (usually auth tokens or API limits)

## Future Improvements

### Short-term
- Add priority queue for urgent syncs (already supported in schema)
- Implement incremental sync jobs
- Add webhook notifications for job completion

### Medium-term
- Batch database writes for better throughput
- Add job cancellation support
- Implement job priority escalation (old jobs get higher priority)

### Long-term
- Migrate to Cloudflare Durable Objects for better consistency
- Add distributed queue processing (multiple workers)
- Implement circuit breaker for Strava API failures

## Comparison with Alternatives

### vs. Cloudflare Queues
- ✅ No additional cost (D1 already used)
- ✅ Simpler debugging (SQL queries)
- ❌ Slightly higher latency (2-min polling vs instant)

### vs. File-based Queue
- ✅ ACID transactions (atomic operations)
- ✅ No race conditions
- ✅ Built-in persistence

### vs. Loop-based Processing
- ✅ No 30-second timeout issues
- ✅ Automatic retry on failure
- ✅ Observable progress
- ✅ Resumable syncs

## Summary

The D1-based queue system provides:

✅ **Reliability** - ACID transactions, automatic retry
✅ **Scalability** - Handles 200+ athletes easily
✅ **Observability** - Real-time stats and monitoring
✅ **Simplicity** - No new infrastructure required
✅ **Cost-effective** - Uses existing D1 database

Perfect for batched Strava activity downloads with Cloudflare Workers' constraints!
