// WOOD-8: Batch processor for handling large activity syncs
// Uses HTTP self-invocation (free tier compatible) instead of Cloudflare Queues

import { Env, StravaActivity, RateLimitInfo } from '../types';
import { getAthleteByStravaId } from '../utils/db';
import {
  ensureValidToken,
  fetchAthleteActivities,
  filterRaceActivities,
} from '../utils/strava';
import { logSyncProgress } from '../utils/sync-logger';
import {
  createBatch,
  getBatch,
  updateBatchStatus,
  completeBatch,
  getSessionSummary,
  BATCH_SIZES,
  checkRateLimits,
  BatchResult,
} from '../utils/batch-manager';
import { insertRaceOptimized, processActivitiesBatch } from './batch-activities';

/**
 * WOOD-8: Process a single batch of activities
 * This is the core unit of work - fetch, process, store, spawn next
 */
export async function processSyncBatch(
  athleteId: number,
  sessionId: string,
  batchNumber: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  console.log(`[WOOD-8] Processing batch ${batchNumber} for athlete ${athleteId}, session ${sessionId}`);

  // 1. Load batch record
  const batch = await getBatch(sessionId, batchNumber, env);
  if (!batch) {
    throw new Error(`Batch ${batchNumber} not found for session ${sessionId}`);
  }

  if (batch.status !== 'pending') {
    console.log(`[WOOD-8] Batch ${batchNumber} is ${batch.status}, skipping`);
    return;
  }

  // 2. Get athlete
  const athlete = await env.DB.prepare(
    `SELECT * FROM athletes WHERE id = ?`
  )
    .bind(athleteId)
    .first();

  if (!athlete) {
    throw new Error(`Athlete ${athleteId} not found`);
  }

  // 3. Mark batch as processing
  await updateBatchStatus(batch.id, 'processing', env);

  // Update athlete's current batch
  await env.DB.prepare(
    `UPDATE athletes SET current_batch_number = ? WHERE id = ?`
  )
    .bind(batchNumber, athleteId)
    .run();

  // Log batch start
  await logSyncProgress(env, athleteId, sessionId, 'info',
    `Processing batch ${batchNumber}`,
    { batchNumber, beforeTimestamp: batch.before_timestamp }
  );

  try {
    // 4. Check rate limits
    const rateLimitCheck = await checkRateLimits(env);
    if (!rateLimitCheck.canProceed) {
      console.warn(`[WOOD-8] Rate limit approaching, but proceeding with batch ${batchNumber}`);
      await logSyncProgress(env, athleteId, sessionId, 'warning',
        `Rate limit approaching: 15min=${rateLimitCheck.usage15min}/100, daily=${rateLimitCheck.usageDaily}/1000`,
        { rateLimitCheck }
      );
    }

    // 5. Ensure valid access token
    const athleteWithToken = await getAthleteByStravaId(athlete.strava_id as number, env);
    if (!athleteWithToken) {
      throw new Error(`Athlete ${athlete.strava_id} not found with token`);
    }
    const accessToken = await ensureValidToken(athleteWithToken, env);

    // 6. Determine batch size (use metadata from athlete to determine sync type)
    const isInitialSync = athlete.last_synced_at === null;
    const isFullSync = batch.before_timestamp !== undefined && batch.after_timestamp === undefined;
    const batchSize = isInitialSync
      ? BATCH_SIZES.INITIAL_SYNC
      : isFullSync
      ? BATCH_SIZES.FULL_SYNC
      : BATCH_SIZES.INCREMENTAL;

    console.log(`[WOOD-8] Batch ${batchNumber}: Fetching up to ${batchSize} activities (initial=${isInitialSync}, full=${isFullSync})`);

    // 7. Fetch activities from Strava (1 page = 200 activities max)
    const maxPages = Math.ceil(batchSize / 200);
    const { activities, rateLimits } = await fetchAthleteActivities(
      accessToken,
      batch.after_timestamp,      // For incremental syncs
      batch.before_timestamp,      // For full syncs (pagination)
      200,                          // perPage (max allowed)
      maxPages                      // How many pages for this batch
    );

    console.log(`[WOOD-8] Batch ${batchNumber}: Fetched ${activities.length} total activities`);

    // 8. Filter to Run activities
    const runActivities = activities.filter(a => a.type === 'Run');
    console.log(`[WOOD-8] Batch ${batchNumber}: ${runActivities.length} run activities out of ${activities.length} total`);

    // 9. Filter to races
    const races = filterRaceActivities(runActivities);
    console.log(`[WOOD-8] Batch ${batchNumber}: ${races.length} races out of ${runActivities.length} runs`);

    // 10. Process and store races (batch operations for efficiency)
    const { racesAdded, racesRemoved } = await processActivitiesBatch(
      athleteId,
      races,
      activities,
      env,
      accessToken,
      isFullSync
    );

    console.log(`[WOOD-8] Batch ${batchNumber}: ${racesAdded} races added, ${racesRemoved} removed`);

    // 11. Complete batch with results
    const result: BatchResult = {
      activities_fetched: activities.length,
      races_added: racesAdded,
      races_removed: racesRemoved,
      strava_rate_limit_15min: rateLimits.usage_15min,
      strava_rate_limit_daily: rateLimits.usage_daily,
    };

    await completeBatch(batch.id, result, env);

    // 12. Log batch completion
    await logSyncProgress(env, athleteId, sessionId, 'info',
      `Batch ${batchNumber} complete: ${activities.length} activities, ${racesAdded} races added`,
      { ...result, batchNumber }
    );

    // 13. Determine if more batches are needed
    const hasMore = activities.length === batchSize; // If we got a full batch, there may be more

    if (hasMore) {
      // Calculate next batch cursor (timestamp of oldest activity)
      const oldestActivity = activities[activities.length - 1];
      const nextBeforeTimestamp = Math.floor(new Date(oldestActivity.start_date).getTime() / 1000);

      console.log(`[WOOD-8] Batch ${batchNumber}: More data available. Creating batch ${batchNumber + 1}`);

      // Create next batch
      const nextBatchId = await createBatch({
        athlete_id: athleteId,
        sync_session_id: sessionId,
        batch_number: batchNumber + 1,
        before_timestamp: nextBeforeTimestamp,
        after_timestamp: batch.after_timestamp,
        status: 'pending',
      }, env);

      // Batch created - cron will pick it up automatically
      enqueueBatchViaCron(batchNumber + 1);

      console.log(`[WOOD-8] Batch ${batchNumber}: Created batch ${batchNumber + 1}, cron will process it`);
    } else {
      // All batches complete - finalize sync
      console.log(`[WOOD-8] Batch ${batchNumber}: No more data. Finalizing sync session ${sessionId}`);
      await finalizeSyncSession(athleteId, sessionId, env);
    }

  } catch (error) {
    console.error(`[WOOD-8] Batch ${batchNumber} failed:`, error);

    // Mark batch as failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateBatchStatus(batch.id, 'failed', env, errorMessage);

    // Log error
    await logSyncProgress(env, athleteId, sessionId, 'error',
      `Batch ${batchNumber} failed: ${errorMessage}`,
      { batchNumber, error: errorMessage }
    );

    // Mark athlete sync as error
    await env.DB.prepare(
      `UPDATE athletes SET sync_status = 'error', sync_error = ? WHERE id = ?`
    )
      .bind(errorMessage, athleteId)
      .run();

    throw error;
  }
}

/**
 * WOOD-8: Finalize sync session after all batches complete
 */
export async function finalizeSyncSession(
  athleteId: number,
  sessionId: string,
  env: Env
): Promise<void> {
  console.log(`[WOOD-8] Finalizing sync session ${sessionId} for athlete ${athleteId}`);

  // Get session summary
  const summary = await getSessionSummary(sessionId, env);

  // Get final race count
  const raceCount = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM races WHERE athlete_id = ?`
  )
    .bind(athleteId)
    .first<{ count: number }>();

  // Update athlete record - keep sync_session_id for historical reference
  await env.DB.prepare(
    `UPDATE athletes
     SET sync_status = 'completed',
         sync_error = NULL,
         last_synced_at = ?,
         current_batch_number = 0,
         total_batches_expected = NULL,
         total_activities_count = ?
     WHERE id = ?`
  )
    .bind(
      Math.floor(Date.now() / 1000),
      summary.total_activities,
      athleteId
    )
    .run();

  // Log final summary
  await logSyncProgress(env, athleteId, sessionId, 'success',
    `Sync completed: ${summary.total_batches} batches, ${summary.total_activities} activities, ${raceCount?.count || 0} total races`,
    {
      totalBatches: summary.total_batches,
      totalActivities: summary.total_activities,
      totalRacesAdded: summary.total_races_added,
      totalRacesRemoved: summary.total_races_removed,
      finalRaceCount: raceCount?.count || 0,
    }
  );

  console.log(`[WOOD-8] Sync session ${sessionId} finalized: ${summary.total_batches} batches, ${summary.total_activities} activities`);
}

/**
 * WOOD-8: Enqueue next batch (cron-based)
 * The cron runs every minute and picks up pending batches automatically.
 * This function just logs - the batch creation is enough.
 */
function enqueueBatchViaCron(
  batchNumber: number
): void {
  console.log(`[WOOD-8] Batch ${batchNumber} created and marked as pending. Cron will process it within 1 minute.`);
}

/**
 * WOOD-8: Initiate a new batched sync for an athlete
 */
export async function initiateBatchedSync(
  athleteId: number,
  fullSync: boolean,
  env: Env,
  ctx: ExecutionContext
): Promise<string> {
  const athlete = await env.DB.prepare(
    `SELECT * FROM athletes WHERE id = ?`
  )
    .bind(athleteId)
    .first();

  if (!athlete) {
    throw new Error(`Athlete ${athleteId} not found`);
  }

  // Generate unique session ID
  const sessionId = `sync-${athleteId}-${Date.now()}`;

  console.log(`[WOOD-8] Initiating ${fullSync ? 'FULL' : 'incremental'} batched sync for athlete ${athleteId} (session: ${sessionId})`);

  // Set athlete status
  await env.DB.prepare(
    `UPDATE athletes
     SET sync_status = 'in_progress',
         sync_error = NULL,
         sync_session_id = ?,
         current_batch_number = 0
     WHERE id = ?`
  )
    .bind(sessionId, athleteId)
    .run();

  // Log sync start
  await logSyncProgress(env, athleteId, sessionId, 'info',
    `${fullSync ? 'Full' : 'Incremental'} batched sync initiated`,
    { fullSync, athleteId }
  );

  // For full syncs, handle event name preservation
  if (fullSync && athlete.last_synced_at !== null) {
    console.log(`[WOOD-8] Full sync: Preserving event name mappings before deletion`);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
       SELECT strava_activity_id, athlete_id, event_name, is_hidden, strftime('%s', 'now')
       FROM races
       WHERE athlete_id = ? AND (event_name IS NOT NULL OR is_hidden = 1)`
    )
      .bind(athleteId)
      .run();

    // Delete existing races
    const deleteResult = await env.DB.prepare(
      `DELETE FROM races WHERE athlete_id = ?`
    )
      .bind(athleteId)
      .run();

    console.log(`[WOOD-8] Deleted ${deleteResult.meta.changes} existing races`);

    // Reset last_synced_at
    await env.DB.prepare(
      `UPDATE athletes SET last_synced_at = NULL WHERE id = ?`
    )
      .bind(athleteId)
      .run();
  }

  // Create first batch
  const firstBatchId = await createBatch({
    athlete_id: athleteId,
    sync_session_id: sessionId,
    batch_number: 1,
    before_timestamp: fullSync ? undefined : undefined, // Full sync starts from now, incremental uses after_timestamp
    after_timestamp: fullSync ? undefined : (athlete.last_synced_at as number | undefined),
    status: 'pending',
  }, env);

  console.log(`[WOOD-8] Created first batch (ID: ${firstBatchId}) for session ${sessionId}`);

  // First batch created - cron will pick it up automatically
  enqueueBatchViaCron(1);

  return sessionId;
}
