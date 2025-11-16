// WOOD-8: Batch management utilities for handling large activity syncs
import { Env } from '../types';

export interface SyncBatch {
  id: number;
  athlete_id: number;
  sync_session_id: string;
  batch_number: number;
  before_timestamp?: number;
  after_timestamp?: number;
  activities_fetched: number;
  races_added: number;
  races_removed: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  started_at?: number;
  completed_at?: number;
  error_message?: string;
  strava_rate_limit_15min?: number;
  strava_rate_limit_daily?: number;
  created_at: number;
}

export interface CreateBatchParams {
  athlete_id: number;
  sync_session_id: string;
  batch_number: number;
  before_timestamp?: number;
  after_timestamp?: number;
  status: 'pending' | 'processing';
}

export interface BatchResult {
  activities_fetched: number;
  races_added: number;
  races_removed: number;
  strava_rate_limit_15min: number;
  strava_rate_limit_daily: number;
}

/**
 * WOOD-8: Batch size configuration
 * Reduced to stay within Cloudflare Workers' 50 subrequest limit
 * Each activity can require multiple subrequests (DB queries, ML predictions, etc.)
 */
export const BATCH_SIZES = {
  INCREMENTAL: 50,   // New activities only, ~2-3 subrequests per activity
  FULL_SYNC: 50,     // All activities, ~2-3 subrequests per activity
  INITIAL_SYNC: 25,  // First time, more ML predictions (~4-5 subrequests per activity)
};

/**
 * WOOD-8: Create a new batch record
 */
export async function createBatch(
  params: CreateBatchParams,
  env: Env
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB.prepare(
    `INSERT INTO sync_batches (
      athlete_id, sync_session_id, batch_number,
      before_timestamp, after_timestamp, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id`
  )
    .bind(
      params.athlete_id,
      params.sync_session_id,
      params.batch_number,
      params.before_timestamp || null,
      params.after_timestamp || null,
      params.status,
      now
    )
    .first<{ id: number }>();

  if (!result) {
    throw new Error('Failed to create batch record');
  }

  console.log(`[WOOD-8] Created batch ${params.batch_number} for session ${params.sync_session_id} (ID: ${result.id})`);
  return result.id;
}

/**
 * WOOD-8: Get a batch by session ID and batch number
 */
export async function getBatch(
  sessionId: string,
  batchNumber: number,
  env: Env
): Promise<SyncBatch | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM sync_batches
     WHERE sync_session_id = ? AND batch_number = ?`
  )
    .bind(sessionId, batchNumber)
    .first<SyncBatch>();

  return result || null;
}

/**
 * WOOD-8: Get a batch by ID
 */
export async function getBatchById(
  batchId: number,
  env: Env
): Promise<SyncBatch | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM sync_batches WHERE id = ?`
  )
    .bind(batchId)
    .first<SyncBatch>();

  return result || null;
}

/**
 * WOOD-8: Update batch status
 */
export async function updateBatchStatus(
  batchId: number,
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled',
  env: Env,
  errorMessage?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  let query: string;
  let bindings: any[];

  if (status === 'processing') {
    query = `UPDATE sync_batches SET status = ?, started_at = ? WHERE id = ?`;
    bindings = [status, now, batchId];
  } else if (status === 'completed') {
    query = `UPDATE sync_batches SET status = ?, completed_at = ? WHERE id = ?`;
    bindings = [status, now, batchId];
  } else if (status === 'failed' || status === 'cancelled') {
    query = `UPDATE sync_batches SET status = ?, error_message = ?, completed_at = ? WHERE id = ?`;
    bindings = [status, errorMessage || null, now, batchId];
  } else {
    query = `UPDATE sync_batches SET status = ? WHERE id = ?`;
    bindings = [status, batchId];
  }

  await env.DB.prepare(query).bind(...bindings).run();

  console.log(`[WOOD-8] Updated batch ${batchId} to status: ${status}`);
}

/**
 * WOOD-8: Complete a batch with results
 */
export async function completeBatch(
  batchId: number,
  result: BatchResult,
  env: Env
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `UPDATE sync_batches
     SET status = 'completed',
         activities_fetched = ?,
         races_added = ?,
         races_removed = ?,
         strava_rate_limit_15min = ?,
         strava_rate_limit_daily = ?,
         completed_at = ?
     WHERE id = ?`
  )
    .bind(
      result.activities_fetched,
      result.races_added,
      result.races_removed,
      result.strava_rate_limit_15min,
      result.strava_rate_limit_daily,
      now,
      batchId
    )
    .run();

  console.log(`[WOOD-8] Completed batch ${batchId}: ${result.activities_fetched} activities, ${result.races_added} races added`);
}

/**
 * WOOD-8: Get all batches for a sync session
 * Limits to most recent batches to reduce row reads
 */
export async function getSessionBatches(
  sessionId: string,
  env: Env,
  limit: number = 100
): Promise<SyncBatch[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM sync_batches
     WHERE sync_session_id = ?
     ORDER BY batch_number DESC
     LIMIT ?`
  )
    .bind(sessionId, limit)
    .all<SyncBatch>();

  // Reverse to get chronological order (oldest to newest)
  return (result.results || []).reverse();
}

/**
 * WOOD-8: Get sync session summary
 */
export async function getSessionSummary(
  sessionId: string,
  env: Env
): Promise<{
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  total_activities: number;
  total_races_added: number;
  total_races_removed: number;
  current_batch?: number;
  estimated_progress: number;
}> {
  const result = await env.DB.prepare(
    `SELECT
      COUNT(*) as total_batches,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_batches,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_batches,
      SUM(CASE WHEN status = 'completed' THEN activities_fetched ELSE 0 END) as total_activities,
      SUM(CASE WHEN status = 'completed' THEN races_added ELSE 0 END) as total_races_added,
      SUM(CASE WHEN status = 'completed' THEN races_removed ELSE 0 END) as total_races_removed
     FROM sync_batches
     WHERE sync_session_id = ?`
  )
    .bind(sessionId)
    .first<{
      total_batches: number;
      completed_batches: number;
      failed_batches: number;
      total_activities: number;
      total_races_added: number;
      total_races_removed: number;
    }>();

  // Find current processing batch
  const currentBatch = await env.DB.prepare(
    `SELECT batch_number FROM sync_batches
     WHERE sync_session_id = ? AND status = 'processing'
     ORDER BY batch_number ASC
     LIMIT 1`
  )
    .bind(sessionId)
    .first<{ batch_number: number }>();

  const totalBatches = result?.total_batches || 0;
  const completedBatches = result?.completed_batches || 0;

  return {
    total_batches: totalBatches,
    completed_batches: completedBatches,
    failed_batches: result?.failed_batches || 0,
    total_activities: result?.total_activities || 0,
    total_races_added: result?.total_races_added || 0,
    total_races_removed: result?.total_races_removed || 0,
    current_batch: currentBatch?.batch_number,
    estimated_progress: totalBatches > 0 ? completedBatches / totalBatches : 0,
  };
}

/**
 * WOOD-8: Cancel all pending batches for a session
 */
export async function cancelSession(
  sessionId: string,
  env: Env
): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE sync_batches
     SET status = 'cancelled',
         error_message = 'Cancelled by user',
         completed_at = ?
     WHERE sync_session_id = ? AND status IN ('pending', 'processing')`
  )
    .bind(Math.floor(Date.now() / 1000), sessionId)
    .run();

  const cancelledCount = result.meta.changes || 0;
  console.log(`[WOOD-8] Cancelled ${cancelledCount} batches for session ${sessionId}`);

  return cancelledCount;
}

/**
 * WOOD-8: Check if there are more batches to process
 */
export async function hasMoreBatches(
  sessionId: string,
  env: Env
): Promise<boolean> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sync_batches
     WHERE sync_session_id = ? AND status = 'pending'`
  )
    .bind(sessionId)
    .first<{ count: number }>();

  return (result?.count || 0) > 0;
}

/**
 * WOOD-8: Get next pending batch
 */
export async function getNextPendingBatch(
  sessionId: string,
  env: Env
): Promise<SyncBatch | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM sync_batches
     WHERE sync_session_id = ? AND status = 'pending'
     ORDER BY batch_number ASC
     LIMIT 1`
  )
    .bind(sessionId)
    .first<SyncBatch>();

  return result || null;
}

/**
 * WOOD-8: Check Strava rate limits from recent batches
 */
export async function checkRateLimits(env: Env): Promise<{
  canProceed: boolean;
  usage15min: number;
  usageDaily: number;
}> {
  // Get latest rate limit data from batches completed in last 15 minutes
  const fifteenMinutesAgo = Math.floor(Date.now() / 1000) - 900;

  const recent = await env.DB.prepare(
    `SELECT strava_rate_limit_15min, strava_rate_limit_daily
     FROM sync_batches
     WHERE completed_at > ? AND strava_rate_limit_15min IS NOT NULL
     ORDER BY completed_at DESC
     LIMIT 1`
  )
    .bind(fifteenMinutesAgo)
    .first<{ strava_rate_limit_15min: number; strava_rate_limit_daily: number }>();

  const usage15min = recent?.strava_rate_limit_15min || 0;
  const usageDaily = recent?.strava_rate_limit_daily || 0;

  // Strava limits: 100 per 15min, 1000 per day
  // Leave some buffer (95 and 950)
  const canProceed = usage15min < 95 && usageDaily < 950;

  if (!canProceed) {
    console.warn(`[WOOD-8] Rate limit protection: 15min=${usage15min}/100, daily=${usageDaily}/1000`);
  }

  return { canProceed, usage15min, usageDaily };
}
