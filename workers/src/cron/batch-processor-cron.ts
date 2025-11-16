// WOOD-8: Cron-based batch processor (Two-Phase)
// Runs every minute to check for and process pending batches
// Supports both discovery and enrichment batches

import { Env } from '../types';
import { processDiscoveryBatch } from '../queue/discovery-processor';
import { processEnrichmentBatch } from '../queue/enrichment-processor';

/**
 * WOOD-8: Two-phase batch processor cron job
 * Processes both discovery and enrichment batches
 */
export async function processPendingBatches(env: Env, ctx: ExecutionContext): Promise<void> {
  console.log('[WOOD-8 Cron] Checking for pending batches...');

  try {
    // Get all pending batches, ordered by creation time (FIFO)
    const pendingBatches = await env.DB.prepare(
      `SELECT
        sb.id,
        sb.athlete_id,
        sb.sync_session_id,
        sb.batch_number,
        sb.batch_type,
        a.strava_id,
        a.firstname,
        a.lastname
       FROM sync_batches sb
       JOIN athletes a ON sb.athlete_id = a.id
       WHERE sb.status = 'pending'
       ORDER BY sb.created_at ASC
       LIMIT 5`  // Process up to 5 batches per cron run
    ).all<{
      id: number;
      athlete_id: number;
      sync_session_id: string;
      batch_number: number;
      batch_type: string;
      strava_id: number;
      firstname: string;
      lastname: string;
    }>();

    if (!pendingBatches.results || pendingBatches.results.length === 0) {
      console.log('[WOOD-8 Cron] No pending batches found');
      return;
    }

    console.log(`[WOOD-8 Cron] Found ${pendingBatches.results.length} pending batch(es)`);

    // Process batches sequentially to avoid overwhelming Strava API
    for (const batch of pendingBatches.results) {
      const batchType = batch.batch_type || 'discovery';
      console.log(`[WOOD-8 Cron] Processing ${batchType} batch ${batch.batch_number} for ${batch.firstname} ${batch.lastname} (${batch.strava_id})`);

      try {
        // Route to appropriate processor based on batch type
        if (batchType === 'enrichment') {
          ctx.waitUntil(
            processEnrichmentBatch(
              batch.athlete_id,
              batch.sync_session_id,
              batch.batch_number,
              env
            )
          );
        } else {
          // Default to discovery
          ctx.waitUntil(
            processDiscoveryBatch(
              batch.athlete_id,
              batch.sync_session_id,
              batch.batch_number,
              env
            )
          );
        }

        console.log(`[WOOD-8 Cron] Started processing batch ${batch.batch_number} for session ${batch.sync_session_id}`);

        // Small delay between batches to spread API load
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`[WOOD-8 Cron] Error processing batch ${batch.batch_number}:`, error);
        // Continue with next batch even if this one fails
      }
    }

  } catch (error) {
    console.error('[WOOD-8 Cron] Fatal error in batch processor:', error);
  }
}

/**
 * WOOD-8: Get batch processing statistics
 * Useful for monitoring and debugging
 */
export async function getBatchStats(env: Env): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  activeSessions: number;
}> {
  const stats = await env.DB.prepare(
    `SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      COUNT(DISTINCT CASE WHEN status IN ('pending', 'processing') THEN sync_session_id END) as active_sessions
     FROM sync_batches
     WHERE created_at > ?`  // Only look at batches from last 24 hours
  )
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .first<{
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      active_sessions: number;
    }>();

  return {
    pending: stats?.pending || 0,
    processing: stats?.processing || 0,
    completed: stats?.completed || 0,
    failed: stats?.failed || 0,
    activeSessions: stats?.active_sessions || 0,
  };
}

/**
 * WOOD-8: Clean up old batch records (keep last 7 days)
 * Run this less frequently (e.g., daily)
 */
export async function cleanupOldBatches(env: Env): Promise<void> {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);

  const result = await env.DB.prepare(
    `DELETE FROM sync_batches WHERE created_at < ? AND status IN ('completed', 'failed', 'cancelled')`
  )
    .bind(sevenDaysAgo)
    .run();

  const deletedCount = result.meta.changes || 0;
  console.log(`[WOOD-8] Cleaned up ${deletedCount} old batch records`);
}
