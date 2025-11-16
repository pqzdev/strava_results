// WOOD-8: Phase 2 - Enrichment Processor
// Fetches polylines and descriptions for races
// Processes small batches (15 races) to stay under subrequest limit

import { Env } from '../types';
import { getAthleteByStravaId, fetchDetailedActivity } from '../utils/db';
import { ensureValidToken } from '../utils/strava';
import { logSyncProgress } from '../utils/sync-logger';
import { getBatch, completeBatch, BatchResult } from '../utils/batch-manager';

/**
 * Process an enrichment batch
 * Fetches polylines and descriptions for races that need it
 */
export async function processEnrichmentBatch(
  athleteId: number,
  sessionId: string,
  batchNumber: number,
  env: Env
): Promise<void> {
  console.log(`[Enrichment] Processing batch ${batchNumber} for athlete ${athleteId}, session ${sessionId}`);

  // 1. Get batch record
  const batch = await getBatch(sessionId, batchNumber, env);
  if (!batch || batch.status !== 'pending') {
    console.log(`[Enrichment] Batch ${batchNumber} not found or not pending, skipping`);
    return;
  }

  // 2. Mark batch as processing
  await env.DB.prepare(
    `UPDATE sync_batches SET status = 'processing', started_at = ? WHERE id = ?`
  )
    .bind(Math.floor(Date.now() / 1000), batch.id)
    .run();

  try {
    // 3. Get athlete and access token
    const athlete = await env.DB.prepare(`SELECT * FROM athletes WHERE id = ?`)
      .bind(athleteId)
      .first();

    if (!athlete) {
      throw new Error(`Athlete ${athleteId} not found`);
    }

    const athleteWithToken = await getAthleteByStravaId(athlete.strava_id as number, env);
    if (!athleteWithToken) {
      throw new Error(`Athlete ${athlete.strava_id} not found with token`);
    }
    const accessToken = await ensureValidToken(athleteWithToken, env);

    // 4. Get races that need enrichment (15 per batch)
    const races = await env.DB.prepare(
      `SELECT id, strava_activity_id, name, polyline
       FROM races
       WHERE athlete_id = ? AND needs_enrichment = 1
       ORDER BY date DESC
       LIMIT 15`
    )
      .bind(athleteId)
      .all<{
        id: number;
        strava_activity_id: number;
        name: string;
        polyline: string | null;
      }>();

    if (!races.results || races.results.length === 0) {
      console.log(`[Enrichment] Batch ${batchNumber}: No races to enrich`);

      // Mark batch as complete
      await completeBatch(batch.id, {
        activities_fetched: 0,
        races_added: 0,
        races_removed: 0,
        strava_rate_limit_15min: 0,
        strava_rate_limit_daily: 0,
      }, env);

      // Check if enrichment is complete
      await checkEnrichmentComplete(athleteId, sessionId, env);
      return;
    }

    console.log(`[Enrichment] Batch ${batchNumber}: Enriching ${races.results.length} races`);

    // 5. Enrich each race
    let enriched = 0;
    let failed = 0;

    for (const race of races.results) {
      try {
        // Only fetch details if we don't have a polyline
        if (!race.polyline) {
          const details = await fetchDetailedActivity(race.strava_activity_id, accessToken);

          await env.DB.prepare(
            `UPDATE races
             SET polyline = ?, description = ?, raw_response = ?,
                 needs_enrichment = 0
             WHERE id = ?`
          )
            .bind(
              details.polyline || null,
              details.description || null,
              details.rawResponse || null,
              race.id
            )
            .run();

          enriched++;
          console.log(`[Enrichment] Enriched race ${race.strava_activity_id}: ${race.name}`);
        } else {
          // Already has polyline, just mark as enriched
          await env.DB.prepare(
            `UPDATE races SET needs_enrichment = 0 WHERE id = ?`
          )
            .bind(race.id)
            .run();

          enriched++;
        }

        // Small delay between fetches to be nice to Strava API
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[Enrichment] Failed to enrich race ${race.strava_activity_id}:`, error);
        failed++;

        // Mark as failed but don't block other races
        await env.DB.prepare(
          `UPDATE races SET needs_enrichment = -1 WHERE id = ?`
        )
          .bind(race.id)
          .run();
      }
    }

    console.log(`[Enrichment] Batch ${batchNumber}: ${enriched} enriched, ${failed} failed`);

    // 6. Complete batch
    const result: BatchResult = {
      activities_fetched: races.results.length,
      races_added: enriched,
      races_removed: 0,
      strava_rate_limit_15min: 0, // We don't track rate limits for enrichment
      strava_rate_limit_daily: 0,
    };

    await completeBatch(batch.id, result, env);

    await logSyncProgress(env, athleteId, sessionId, 'info',
      `Enrichment batch ${batchNumber} complete: ${enriched} enriched, ${failed} failed`,
      { ...result, batchNumber, enriched, failed }
    );

    // 7. Check if enrichment is complete
    await checkEnrichmentComplete(athleteId, sessionId, env);

  } catch (error) {
    console.error(`[Enrichment] Batch ${batchNumber} failed:`, error);

    await env.DB.prepare(
      `UPDATE sync_batches
       SET status = 'failed', error_message = ?, completed_at = ?
       WHERE id = ?`
    )
      .bind(
        error instanceof Error ? error.message : String(error),
        Math.floor(Date.now() / 1000),
        batch.id
      )
      .run();

    await logSyncProgress(env, athleteId, sessionId, 'error',
      `Enrichment batch ${batchNumber} failed: ${error}`,
      { batchNumber, error: String(error) }
    );

    throw error;
  }
}

/**
 * Check if enrichment phase is complete
 */
async function checkEnrichmentComplete(
  athleteId: number,
  sessionId: string,
  env: Env
): Promise<void> {
  // Check if any races still need enrichment
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM races
     WHERE athlete_id = ? AND needs_enrichment = 1`
  )
    .bind(athleteId)
    .first<{ count: number }>();

  const pendingCount = remaining?.count || 0;

  // Check if any batches are still pending
  const pendingBatches = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sync_batches
     WHERE sync_session_id = ? AND status = 'pending'`
  )
    .bind(sessionId)
    .first<{ count: number }>();

  const pendingBatchCount = pendingBatches?.count || 0;

  if (pendingCount === 0 && pendingBatchCount === 0) {
    // Enrichment complete!
    console.log(`[Enrichment] Session ${sessionId} complete for athlete ${athleteId}`);

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
      `Sync complete: ${totalRaces?.count || 0} races, ${failedRaces?.count || 0} enrichment failures`,
      {
        totalRaces: totalRaces?.count || 0,
        failedEnrichments: failedRaces?.count || 0,
      }
    );
  } else {
    console.log(`[Enrichment] Session ${sessionId}: ${pendingCount} races still need enrichment, ${pendingBatchCount} batches pending`);
  }
}
