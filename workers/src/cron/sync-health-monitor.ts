// Proactive health monitoring for batched syncs
// Detects and fixes stalled enrichment sessions

import { Env } from '../types';
import { logSyncProgress } from '../utils/sync-logger';
import { createBatch } from '../utils/batch-manager';

/**
 * Health check for batched sync sessions
 * Runs periodically to detect and fix stalled enrichment syncs
 */
export async function healthCheckBatchedSyncs(env: Env): Promise<void> {
  console.log('[Health Monitor] Checking batched sync health...');

  try {
    // Find all in-progress enrichment sessions
    const inProgressSyncs = await env.DB.prepare(`
      SELECT DISTINCT
        a.id as athlete_id,
        a.sync_session_id,
        a.firstname,
        a.lastname
      FROM athletes a
      WHERE a.sync_status = 'in_progress'
        AND a.sync_session_id IS NOT NULL
        AND a.sync_session_id LIKE 'enrich_%'
    `).all<{
      athlete_id: number;
      sync_session_id: string;
      firstname: string;
      lastname: string;
    }>();

    if (!inProgressSyncs.results || inProgressSyncs.results.length === 0) {
      console.log('[Health Monitor] No in-progress enrichment syncs found');
      return;
    }

    console.log(`[Health Monitor] Found ${inProgressSyncs.results.length} in-progress enrichment sync(s)`);

    // Check each sync session
    for (const sync of inProgressSyncs.results) {
      await checkEnrichmentSession(
        sync.athlete_id,
        sync.sync_session_id,
        `${sync.firstname} ${sync.lastname}`,
        env
      );
    }

  } catch (error) {
    console.error('[Health Monitor] Error during health check:', error);
  }
}

/**
 * Check a single enrichment session for issues
 */
async function checkEnrichmentSession(
  athleteId: number,
  sessionId: string,
  athleteName: string,
  env: Env
): Promise<void> {
  console.log(`[Health Monitor] Checking session ${sessionId} for ${athleteName}`);

  // Check if there are races still needing enrichment
  const racesNeedingEnrichment = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM races
     WHERE athlete_id = ? AND needs_enrichment = 1`
  )
    .bind(athleteId)
    .first<{ count: number }>();

  const pendingRaces = racesNeedingEnrichment?.count || 0;

  // Check if there are pending batches
  const pendingBatches = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sync_batches
     WHERE sync_session_id = ? AND status = 'pending'`
  )
    .bind(sessionId)
    .first<{ count: number }>();

  const pendingBatchCount = pendingBatches?.count || 0;

  // Check total batches
  const allBatches = await env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       MAX(completed_at) as last_completed
     FROM sync_batches
     WHERE sync_session_id = ?`
  )
    .bind(sessionId)
    .first<{ total: number; completed: number; last_completed: number | null }>();

  console.log(`[Health Monitor] ${athleteName}: ${pendingRaces} races need enrichment, ${pendingBatchCount} batches pending, ${allBatches?.completed}/${allBatches?.total} batches completed`);

  // CASE 1: Races need enrichment but no pending batches - CREATE BATCHES
  if (pendingRaces > 0 && pendingBatchCount === 0) {
    console.log(`[Health Monitor] STALLED SYNC DETECTED: ${athleteName} has ${pendingRaces} races but no pending batches`);

    // Find the highest batch number
    const maxBatch = await env.DB.prepare(
      `SELECT MAX(batch_number) as max_batch FROM sync_batches
       WHERE sync_session_id = ?`
    )
      .bind(sessionId)
      .first<{ max_batch: number | null }>();

    const nextBatchNumber = (maxBatch?.max_batch || 0) + 1;
    const batchSize = 15;
    const batchesNeeded = Math.ceil(pendingRaces / batchSize);

    console.log(`[Health Monitor] Creating ${batchesNeeded} new batch(es) starting from batch ${nextBatchNumber}`);

    // Create new batches
    for (let i = 0; i < batchesNeeded; i++) {
      await env.DB.prepare(
        `INSERT INTO sync_batches (
          athlete_id, sync_session_id, batch_number, status, batch_type
        ) VALUES (?, ?, ?, 'pending', 'enrichment')`
      )
        .bind(athleteId, sessionId, nextBatchNumber + i)
        .run();

      console.log(`[Health Monitor] Created batch ${nextBatchNumber + i} for ${athleteName}`);
    }

    await logSyncProgress(env, athleteId, sessionId, 'warning',
      `Health monitor created ${batchesNeeded} missing batch(es) to process ${pendingRaces} races`,
      { pendingRaces, batchesNeeded, nextBatchNumber, auto_fixed: true }
    );
  }
  // CASE 2: No races need enrichment and no pending batches - COMPLETE SYNC
  else if (pendingRaces === 0 && pendingBatchCount === 0) {
    console.log(`[Health Monitor] Session ${sessionId} for ${athleteName} is complete but not marked as such`);

    // Get final counts
    const totalRaces = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM races WHERE athlete_id = ?`
    )
      .bind(athleteId)
      .first<{ count: number }>();

    const failedRaces = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM races
       WHERE athlete_id = ? AND needs_enrichment = -1`
    )
      .bind(athleteId)
      .first<{ count: number }>();

    // Mark sync as complete
    await env.DB.prepare(
      `UPDATE athletes
       SET sync_status = 'completed', sync_error = NULL,
           last_synced_at = ?, sync_session_id = NULL,
           current_batch_number = 0, total_batches_expected = NULL
       WHERE id = ?`
    )
      .bind(Math.floor(Date.now() / 1000), athleteId)
      .run();

    await logSyncProgress(env, athleteId, sessionId, 'success',
      `Health monitor completed sync: ${totalRaces?.count || 0} races, ${failedRaces?.count || 0} enrichment failures`,
      {
        totalRaces: totalRaces?.count || 0,
        failedEnrichments: failedRaces?.count || 0,
        auto_completed: true
      }
    );

    console.log(`[Health Monitor] Marked session ${sessionId} as completed for ${athleteName}`);
  }
  // CASE 3: Everything looks normal
  else {
    console.log(`[Health Monitor] Session ${sessionId} for ${athleteName} is healthy`);
  }
}
