# Batched Sync Architecture for Large Activity Datasets

## Problem Statement

Athletes with thousands of activities (10,000+) can cause sync jobs to:
- Hit Cloudflare Workers CPU time limits (10-50s wall time, ~10ms CPU time per request)
- Consume excessive memory
- Be difficult to cancel or monitor progress
- Fail catastrophically with no recovery point

**Current behavior**: One worker invocation loops continuously until all activities are fetched, which works for small datasets but becomes fragile at scale.

## Proposed Solution: Fully Batched Job Queue

Instead of one long-running worker, break syncs into **discrete, independently-completable batch jobs** that chain together.

### Core Principles

1. **Each batch is a complete unit of work** - fetch, process, store, commit
2. **Each batch spawns the next batch** - self-propagating chain
3. **Progress is persisted** - can resume from any batch
4. **Batches are independently retryable** - failure doesn't lose all progress
5. **Observability built-in** - clear visibility into which batch is running

---

## Architecture Design

### 1. Batch Size Calculation

**Recommended batch size: 1,000 activities**

**Rationale:**
- Strava API: 200 activities per page → 5 API calls per batch
- Processing time: ~2-5s for 1,000 activities (filtering, ML, DB inserts)
- Well under Cloudflare Workers limits (30s+ wall time available)
- Large enough to be efficient, small enough to be safe
- 10,000 activities = 10 batches = manageable and observable

**Adjustable per sync type:**
```typescript
const BATCH_SIZES = {
  INCREMENTAL: 1000,  // New activities only, fast
  FULL_SYNC: 1000,    // All activities, moderate
  INITIAL_SYNC: 500,  // First time, cautious (more ML predictions)
};
```

### 2. Database Schema Changes

#### New: `sync_batches` table
Track each batch as an independent job with its own state.

```sql
CREATE TABLE IF NOT EXISTS sync_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Association
  athlete_id INTEGER NOT NULL,
  sync_session_id TEXT NOT NULL,  -- Links all batches in a sync
  batch_number INTEGER NOT NULL,

  -- Pagination state
  before_timestamp INTEGER,       -- Pagination cursor (where this batch started)
  after_timestamp INTEGER,        -- For incremental syncs

  -- Batch results
  activities_fetched INTEGER DEFAULT 0,
  races_added INTEGER DEFAULT 0,
  races_removed INTEGER DEFAULT 0,

  -- Status tracking
  status TEXT NOT NULL,           -- 'pending', 'processing', 'completed', 'failed'
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,

  -- Metadata
  strava_rate_limit_15min INTEGER,
  strava_rate_limit_daily INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

  FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_batches_session ON sync_batches(sync_session_id, batch_number);
CREATE INDEX idx_sync_batches_athlete_status ON sync_batches(athlete_id, status);
CREATE INDEX idx_sync_batches_pending ON sync_batches(status) WHERE status = 'pending';
```

#### Modify: `athletes` table
Add batch-aware sync tracking.

```sql
-- Add new columns
ALTER TABLE athletes ADD COLUMN current_batch_number INTEGER DEFAULT 0;
ALTER TABLE athletes ADD COLUMN total_batches_expected INTEGER;
ALTER TABLE athletes ADD COLUMN sync_session_id TEXT;  -- Active session ID
```

### 3. Sync Workflow

#### Phase 1: Initiate Sync
```
User triggers sync → Create session → Enqueue first batch
```

1. Generate unique `session_id` (e.g., `sync-{athlete_id}-{timestamp}`)
2. Set athlete status to `in_progress`
3. Store session metadata (full_sync flag, start time)
4. Create first batch record with `status='pending'`, `batch_number=1`
5. Enqueue batch job to Cloudflare Queue (or HTTP request to self)

#### Phase 2: Process Batch
```
Worker receives batch job → Fetch activities → Process → Store → Enqueue next batch OR complete
```

**Batch Processing Steps:**

```typescript
async function processSyncBatch(
  athleteId: number,
  sessionId: string,
  batchNumber: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {

  // 1. Load batch record
  const batch = await getBatch(sessionId, batchNumber, env);
  if (!batch || batch.status !== 'pending') {
    throw new Error(`Batch ${batchNumber} not found or not pending`);
  }

  // 2. Mark batch as processing
  await updateBatchStatus(batch.id, 'processing', env);

  try {
    // 3. Fetch activities from Strava
    const { activities, rateLimits, hasMore } = await fetchBatch(
      athleteId,
      batch.before_timestamp,
      batch.after_timestamp,
      BATCH_SIZE,
      env
    );

    // 4. Process activities (filter, ML predictions, etc.)
    const races = await processActivities(activities, athleteId, env);

    // 5. Store to database (batch insert for efficiency)
    const { added, removed } = await storeRaces(races, athleteId, env);

    // 6. Update batch record with results
    await completeBatch(batch.id, {
      activities_fetched: activities.length,
      races_added: added,
      races_removed: removed,
      strava_rate_limit_15min: rateLimits.usage_15min,
      strava_rate_limit_daily: rateLimits.usage_daily,
    }, env);

    // 7. Check if more batches needed
    if (hasMore) {
      // Calculate next batch cursor
      const nextBeforeTimestamp = getOldestActivityTimestamp(activities);

      // Create next batch record
      await createBatch({
        athlete_id: athleteId,
        sync_session_id: sessionId,
        batch_number: batchNumber + 1,
        before_timestamp: nextBeforeTimestamp,
        after_timestamp: batch.after_timestamp,
        status: 'pending',
      }, env);

      // Enqueue next batch (option A: queue, option B: HTTP request)
      await enqueueBatch(athleteId, sessionId, batchNumber + 1, env, ctx);

      console.log(`Batch ${batchNumber} complete. Enqueued batch ${batchNumber + 1}`);
    } else {
      // All batches complete - finalize sync
      await finalizeSyncSession(athleteId, sessionId, env);
      console.log(`All batches complete for session ${sessionId}`);
    }

  } catch (error) {
    // Mark batch as failed
    await updateBatchStatus(batch.id, 'failed', env, error.message);

    // Mark athlete sync as error
    await updateAthleteSync(athleteId, 'error', error.message, env);

    throw error;
  }
}
```

#### Phase 3: Finalize Sync
```
Last batch completes → Update athlete status → Log final summary
```

```typescript
async function finalizeSyncSession(
  athleteId: number,
  sessionId: string,
  env: Env
): Promise<void> {

  // Calculate totals across all batches
  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) as total_batches,
      SUM(activities_fetched) as total_activities,
      SUM(races_added) as total_races_added,
      SUM(races_removed) as total_races_removed,
      MAX(completed_at) as last_batch_completed_at
    FROM sync_batches
    WHERE sync_session_id = ? AND status = 'completed'
  `).bind(sessionId).first();

  // Update athlete record
  await env.DB.prepare(`
    UPDATE athletes
    SET sync_status = 'completed',
        sync_error = NULL,
        last_synced_at = ?,
        current_batch_number = 0,
        sync_session_id = NULL
    WHERE id = ?
  `).bind(totals.last_batch_completed_at, athleteId).run();

  // Log final summary
  await logSyncProgress(env, athleteId, sessionId, 'success',
    `Sync completed: ${totals.total_batches} batches, ${totals.total_activities} activities, ${totals.total_races_added} races added`,
    { ...totals }
  );
}
```

### 4. Batch Orchestration: Two Approaches

#### **Option A: Cloudflare Queue (Recommended)**

Use Cloudflare's built-in durable queue.

**Pros:**
- Automatic retry logic
- Rate limiting built-in
- Guaranteed delivery
- No HTTP overhead
- Better observability

**Cons:**
- Requires queue setup
- Slightly more complex initial setup

```typescript
// Enqueue batch
await env.SYNC_QUEUE.send({
  athleteId,
  sessionId,
  batchNumber,
  timestamp: Date.now()
});

// Queue consumer
export default {
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    for (const message of batch.messages) {
      try {
        await processSyncBatch(
          message.body.athleteId,
          message.body.sessionId,
          message.body.batchNumber,
          env,
          ctx
        );
        message.ack();
      } catch (error) {
        console.error('Batch failed:', error);
        message.retry(); // Auto-retry with exponential backoff
      }
    }
  }
}
```

#### **Option B: HTTP Self-Invocation**

Worker calls itself via HTTP to trigger next batch.

**Pros:**
- Simpler setup
- No queue configuration needed
- Works immediately

**Cons:**
- Manual retry logic needed
- HTTP overhead
- Less robust

```typescript
// Enqueue batch via HTTP
ctx.waitUntil(
  fetch(`https://your-worker.workers.dev/internal/process-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': env.INTERNAL_SECRET  // Prevent external calls
    },
    body: JSON.stringify({
      athleteId,
      sessionId,
      batchNumber: batchNumber + 1
    })
  })
);
```

**Recommendation:** Use **Option A (Queue)** for production reliability.

### 5. Progress Monitoring & UI

#### Admin Dashboard Enhancements

```typescript
// API endpoint: GET /api/admin/sync/:sessionId/progress
async function getSyncProgress(sessionId: string, env: Env) {
  const batches = await env.DB.prepare(`
    SELECT
      batch_number,
      status,
      activities_fetched,
      races_added,
      started_at,
      completed_at,
      error_message
    FROM sync_batches
    WHERE sync_session_id = ?
    ORDER BY batch_number ASC
  `).bind(sessionId).all();

  const summary = {
    total_batches: batches.results.length,
    completed_batches: batches.results.filter(b => b.status === 'completed').length,
    current_batch: batches.results.find(b => b.status === 'processing')?.batch_number,
    total_activities: batches.results.reduce((sum, b) => sum + b.activities_fetched, 0),
    total_races: batches.results.reduce((sum, b) => sum + b.races_added, 0),
    estimated_progress: batches.results.filter(b => b.status === 'completed').length / batches.results.length
  };

  return { batches: batches.results, summary };
}
```

#### UI Components

```typescript
// Progress bar showing batch completion
<ProgressBar
  current={completedBatches}
  total={totalBatches}
  label={`Batch ${currentBatch} of ${totalBatches}`}
/>

// Batch list with status indicators
<BatchList>
  {batches.map(batch => (
    <BatchItem
      number={batch.batch_number}
      status={batch.status}  // pending | processing | completed | failed
      activities={batch.activities_fetched}
      races={batch.races_added}
    />
  ))}
</BatchList>
```

### 6. Cancellation Support

With batched architecture, cancellation is simple and immediate.

```typescript
async function cancelSync(athleteId: number, sessionId: string, env: Env) {
  // 1. Mark all pending batches as cancelled
  await env.DB.prepare(`
    UPDATE sync_batches
    SET status = 'cancelled',
        error_message = 'Cancelled by user'
    WHERE sync_session_id = ? AND status IN ('pending', 'processing')
  `).bind(sessionId).run();

  // 2. Update athlete status
  await env.DB.prepare(`
    UPDATE athletes
    SET sync_status = 'completed',
        sync_error = 'Cancelled by user',
        current_batch_number = 0,
        sync_session_id = NULL
    WHERE id = ?
  `).bind(athleteId).run();

  // Queue will naturally skip cancelled batches
  // Currently processing batch will complete but won't spawn next batch
}
```

**Key insight**: Since each batch checks its status before processing, cancelled batches in the queue are simply ignored.

### 7. Error Handling & Recovery

#### Automatic Retry (via Queue)

```typescript
// Queue configuration in wrangler.toml
[[queues.consumers]]
queue = "sync-queue"
max_retries = 3
dead_letter_queue = "sync-dlq"
max_concurrency = 10
```

#### Manual Retry (via Admin UI)

```typescript
async function retryFailedBatch(batchId: number, env: Env, ctx: ExecutionContext) {
  const batch = await getBatchById(batchId, env);

  // Reset batch status
  await env.DB.prepare(`
    UPDATE sync_batches
    SET status = 'pending',
        error_message = NULL,
        started_at = NULL
    WHERE id = ?
  `).bind(batchId).run();

  // Re-enqueue
  await enqueueBatch(
    batch.athlete_id,
    batch.sync_session_id,
    batch.batch_number,
    env,
    ctx
  );
}
```

#### Resume from Checkpoint

If sync fails at batch 5 of 10:
```typescript
async function resumeSync(athleteId: number, sessionId: string, env: Env, ctx: ExecutionContext) {
  // Find last completed batch
  const lastCompleted = await env.DB.prepare(`
    SELECT batch_number, before_timestamp
    FROM sync_batches
    WHERE sync_session_id = ? AND status = 'completed'
    ORDER BY batch_number DESC
    LIMIT 1
  `).bind(sessionId).first();

  // Create next batch
  const nextBatchNumber = (lastCompleted?.batch_number || 0) + 1;
  await createBatch({
    athlete_id: athleteId,
    sync_session_id: sessionId,
    batch_number: nextBatchNumber,
    before_timestamp: lastCompleted?.before_timestamp,
    status: 'pending',
  }, env);

  // Enqueue to continue
  await enqueueBatch(athleteId, sessionId, nextBatchNumber, env, ctx);
}
```

### 8. Performance Optimizations

#### Batch Insert for Races

Instead of inserting races one-by-one, use batch inserts:

```typescript
async function batchInsertRaces(races: Race[], env: Env) {
  // Group into batches of 100 for DB efficiency
  const DB_BATCH_SIZE = 100;

  for (let i = 0; i < races.length; i += DB_BATCH_SIZE) {
    const batch = races.slice(i, i + DB_BATCH_SIZE);

    // Build multi-row insert
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const values = batch.flatMap(r => [
      r.athlete_id, r.strava_activity_id, r.name, r.distance,
      r.elapsed_time, r.moving_time, r.date, r.elevation_gain,
      r.average_heartrate, r.max_heartrate, r.polyline,
      r.event_name, r.is_hidden, Math.floor(Date.now() / 1000)
    ]);

    await env.DB.prepare(`
      INSERT OR REPLACE INTO races (
        athlete_id, strava_activity_id, name, distance, elapsed_time,
        moving_time, date, elevation_gain, average_heartrate, max_heartrate,
        polyline, event_name, is_hidden, created_at
      ) VALUES ${placeholders}
    `).bind(...values).run();
  }
}
```

#### Parallel ML Predictions

Process multiple activities in parallel:

```typescript
async function processParkrunDetection(activities: StravaActivity[]): Promise<Map<number, boolean>> {
  const results = new Map();

  // Process in chunks of 50 for parallelism
  const PARALLEL_BATCH = 50;

  for (let i = 0; i < activities.length; i += PARALLEL_BATCH) {
    const chunk = activities.slice(i, i + PARALLEL_BATCH);

    const predictions = await Promise.all(
      chunk.map(async (activity) => ({
        id: activity.id,
        isParkrun: await isParkrunActivity(activity)
      }))
    );

    predictions.forEach(p => results.set(p.id, p.isParkrun));
  }

  return results;
}
```

### 9. Rate Limit Management

Track Strava rate limits per batch to prevent hitting limits:

```typescript
async function checkRateLimits(env: Env): Promise<boolean> {
  // Get latest rate limit data from recent batches
  const recent = await env.DB.prepare(`
    SELECT strava_rate_limit_15min, strava_rate_limit_daily
    FROM sync_batches
    WHERE completed_at > ?
    ORDER BY completed_at DESC
    LIMIT 1
  `).bind(Math.floor(Date.now() / 1000) - 900).first(); // Last 15 min

  // Strava limits: 100 per 15min, 1000 per day
  if (recent.strava_rate_limit_15min >= 95) {
    console.warn('Approaching 15-minute rate limit');
    return false;
  }

  if (recent.strava_rate_limit_daily >= 950) {
    console.warn('Approaching daily rate limit');
    return false;
  }

  return true;
}

// Add delay between batches if needed
async function enqueueBatchWithRateLimit(
  athleteId: number,
  sessionId: string,
  batchNumber: number,
  env: Env,
  ctx: ExecutionContext
) {
  const canProceed = await checkRateLimits(env);

  if (!canProceed) {
    // Delay next batch by 15 minutes
    console.log(`Rate limit protection: delaying batch ${batchNumber} by 15 minutes`);

    // Option A: Schedule for later (requires Durable Objects or external scheduler)
    // Option B: Use queue delay (if supported)
    // Option C: Store as pending and use cron to check
  }

  await env.SYNC_QUEUE.send({
    athleteId,
    sessionId,
    batchNumber
  });
}
```

---

## Implementation Roadmap

### Phase 1: Database Migration (1-2 hours)
- [ ] Create `sync_batches` table
- [ ] Add batch tracking columns to `athletes`
- [ ] Create indexes
- [ ] Test migrations locally

### Phase 2: Core Batch Logic (4-6 hours)
- [ ] Implement `processSyncBatch()` function
- [ ] Implement `createBatch()` and batch management functions
- [ ] Implement batch-to-batch chaining logic
- [ ] Add finalization logic

### Phase 3: Queue Integration (2-3 hours)
- [ ] Set up Cloudflare Queue in `wrangler.toml`
- [ ] Implement queue consumer
- [ ] Add queue retry configuration
- [ ] Test queue behavior

### Phase 4: Admin UI Updates (3-4 hours)
- [ ] Create batch progress API endpoint
- [ ] Build batch list UI component
- [ ] Add progress bar to sync monitor
- [ ] Implement cancellation UI

### Phase 5: Migration & Testing (2-3 hours)
- [ ] Migrate existing `syncAthlete()` to use batched approach
- [ ] Test with small athlete (~100 activities)
- [ ] Test with medium athlete (~1,000 activities)
- [ ] Test with large athlete (~10,000 activities)
- [ ] Test cancellation
- [ ] Test failure recovery

### Phase 6: Deployment (1 hour)
- [ ] Deploy to staging
- [ ] Trigger test syncs
- [ ] Monitor performance
- [ ] Deploy to production

**Total estimated time: 13-19 hours**

---

## Benefits Summary

| Aspect | Current | Batched |
|--------|---------|---------|
| **Max activities** | ~2,000 safely | Unlimited |
| **Worker timeout risk** | High for large datasets | None (each batch is independent) |
| **Progress visibility** | Limited | Real-time batch progress |
| **Cancellation** | Complex | Simple and immediate |
| **Error recovery** | Start over | Resume from last batch |
| **Observability** | Basic logs | Detailed batch tracking |
| **Rate limit mgmt** | Reactive | Proactive with delays |
| **Memory usage** | Grows with dataset | Constant (1,000 activities max) |

---

## Alternative Considerations

### Smaller Batch Size (500 activities)
**Pros:** Even safer for Workers limits, more granular progress
**Cons:** More batches = more overhead, more queue messages

### Larger Batch Size (2,000 activities)
**Pros:** Fewer batches, faster for large datasets
**Cons:** Higher risk of timeout, less granular progress

### Dynamic Batch Sizing
Adjust batch size based on:
- Athlete's total activity count (estimate from first batch)
- Current rate limit usage
- Time of day (avoid peak hours)

```typescript
function calculateBatchSize(estimatedTotal: number, rateLimits: RateLimitInfo): number {
  if (estimatedTotal < 1000) return 500;  // Small athlete, smaller batches
  if (estimatedTotal > 10000) return 1500; // Large athlete, larger batches

  // Adjust based on rate limits
  if (rateLimits.usage_15min > 80) return 500;  // Approaching limit, slow down

  return 1000; // Default
}
```

---

## Conclusion

The fully batched approach transforms the sync architecture from a **fragile long-running process** into a **robust, observable, resumable pipeline**. This enables:

1. ✅ Support for athletes with unlimited activities
2. ✅ Real-time progress visibility
3. ✅ Graceful cancellation
4. ✅ Automatic recovery from failures
5. ✅ Better rate limit management
6. ✅ Improved observability and debugging

**Recommended next step:** Start with Phase 1 (database migration) and test locally before proceeding to implementation.
