// WOOD-8: Phase 1 - Discovery Processor
// Fast race discovery without fetching activity details
// Processes large batches (1000 activities) efficiently

import { Env, StravaActivity } from '../types';
import { getAthleteByStravaId } from '../utils/db';
import { ensureValidToken, fetchAthleteActivities, filterRaceActivities } from '../utils/strava';
import { logSyncProgress } from '../utils/sync-logger';
import { getBatch, completeBatch, BatchResult } from '../utils/batch-manager';

/**
 * Process a discovery batch
 * Fetches activity lists and stores races WITHOUT details (no polylines/descriptions)
 */
export async function processDiscoveryBatch(
  athleteId: number,
  sessionId: string,
  batchNumber: number,
  env: Env
): Promise<void> {
  console.log(`[Discovery] Processing batch ${batchNumber} for athlete ${athleteId}, session ${sessionId}`);

  // 1. Get batch record
  const batch = await getBatch(sessionId, batchNumber, env);
  if (!batch || batch.status !== 'pending') {
    console.log(`[Discovery] Batch ${batchNumber} not found or not pending, skipping`);
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

    // 4. Fetch activities from Strava
    // For discovery, we fetch 1000 activities per batch (5 API pages of 200 each)
    const { activities, rateLimits } = await fetchAthleteActivities(
      accessToken,
      batch.after_timestamp,
      batch.before_timestamp,
      200,  // perPage (max allowed by Strava)
      5     // maxPages (1000 activities)
    );

    console.log(`[Discovery] Batch ${batchNumber}: Fetched ${activities.length} activities`);
    await logSyncProgress(env, athleteId, sessionId, 'info',
      `Discovery batch ${batchNumber}: Fetched ${activities.length} activities`,
      { batchNumber, activitiesCount: activities.length }
    );

    // 5. Filter to races
    const races = filterRaceActivities(activities.filter(a => a.type === 'Run'));
    console.log(`[Discovery] Batch ${batchNumber}: Found ${races.length} races`);

    // 6. Store races WITHOUT details
    let racesAdded = 0;
    let racesUpdated = 0;

    for (const race of races) {
      const exists = await env.DB.prepare(
        `SELECT id, needs_enrichment FROM races WHERE strava_activity_id = ?`
      )
        .bind(race.id)
        .first<{ id: number; needs_enrichment: number }>();

      if (exists) {
        // Race already exists, just mark it for enrichment if needed
        if (exists.needs_enrichment === 0) {
          await env.DB.prepare(
            `UPDATE races SET needs_enrichment = 1 WHERE id = ?`
          )
            .bind(exists.id)
            .run();
          racesUpdated++;
        }
      } else {
        // New race - insert with minimal data
        await insertRaceMinimal(athleteId, race, env);
        racesAdded++;
      }
    }

    console.log(`[Discovery] Batch ${batchNumber}: ${racesAdded} new races, ${racesUpdated} updated`);

    // 7. Determine if we need another discovery batch
    // We got a full batch (1000 activities), so there might be more
    const hasMore = activities.length >= 1000;

    // 8. Complete batch
    const result: BatchResult = {
      activities_fetched: activities.length,
      races_added: racesAdded,
      races_removed: 0, // Discovery doesn't remove races
      strava_rate_limit_15min: rateLimits.usage_15min,
      strava_rate_limit_daily: rateLimits.usage_daily,
    };

    await completeBatch(batch.id, result, env);

    await logSyncProgress(env, athleteId, sessionId, 'info',
      `Discovery batch ${batchNumber} complete: ${racesAdded} new races`,
      { ...result, batchNumber, hasMore }
    );

    // 9. Create next discovery batch if needed
    if (hasMore && activities.length > 0) {
      // Calculate timestamp of oldest activity in this batch
      const oldestActivity = activities[activities.length - 1];
      const nextBeforeTimestamp = Math.floor(new Date(oldestActivity.start_date).getTime() / 1000);

      await env.DB.prepare(
        `INSERT INTO sync_batches (
          athlete_id, sync_session_id, batch_number, before_timestamp,
          after_timestamp, status, batch_type
        ) VALUES (?, ?, ?, ?, ?, 'pending', 'discovery')`
      )
        .bind(
          athleteId,
          sessionId,
          batchNumber + 1,
          nextBeforeTimestamp,
          batch.after_timestamp || null
        )
        .run();

      console.log(`[Discovery] Created next batch ${batchNumber + 1} with before=${nextBeforeTimestamp}`);
    } else {
      // Discovery complete! Start enrichment phase
      console.log(`[Discovery] Session ${sessionId} complete, starting enrichment`);
      await startEnrichmentPhase(athleteId, sessionId, env);
    }

  } catch (error) {
    console.error(`[Discovery] Batch ${batchNumber} failed:`, error);

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
      `Discovery batch ${batchNumber} failed: ${error}`,
      { batchNumber, error: String(error) }
    );

    // Update athlete sync status
    await env.DB.prepare(
      `UPDATE athletes SET sync_status = 'error', sync_error = ? WHERE id = ?`
    )
      .bind(error instanceof Error ? error.message : String(error), athleteId)
      .run();

    throw error;
  }
}

/**
 * Insert race with minimal data (no polyline, description, or raw_response)
 * Marks race as needing enrichment
 */
async function insertRaceMinimal(
  athleteId: number,
  activity: StravaActivity,
  env: Env
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Use summary polyline if available (no detail fetch!)
  const polyline = activity.map?.summary_polyline || null;

  // Simple parkrun detection (rules-based, no ML)
  const isParkrun = detectParkrun(activity);
  const eventName = isParkrun ? 'parkrun' : null;
  const isHidden = isParkrun ? 1 : 0;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO races (
      athlete_id, strava_activity_id, name, distance, elapsed_time,
      moving_time, date, elevation_gain, average_heartrate, max_heartrate,
      polyline, event_name, is_hidden, needs_enrichment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(
      athleteId,
      activity.id,
      activity.name,
      activity.distance,
      activity.elapsed_time,
      activity.moving_time,
      activity.start_date_local,
      activity.total_elevation_gain,
      activity.average_heartrate || null,
      activity.max_heartrate || null,
      polyline,
      eventName,
      isHidden,
      now
    )
    .run();
}

/**
 * Simple parkrun detection (rules-based)
 */
function detectParkrun(activity: StravaActivity): boolean {
  const nameLower = activity.name.toLowerCase();
  const hasKeyword = nameLower.includes('parkrun') ||
                     nameLower.includes('park run') ||
                     nameLower.includes('parkie') ||
                     nameLower.includes('parky');

  const isCorrectDistance = activity.distance >= 4500 && activity.distance <= 5500;

  return hasKeyword || isCorrectDistance;
}

/**
 * Start enrichment phase after discovery completes
 */
async function startEnrichmentPhase(
  athleteId: number,
  discoverySessionId: string,
  env: Env
): Promise<void> {
  console.log(`[Discovery] Starting enrichment phase for athlete ${athleteId}`);

  // Find all races that need enrichment
  const racesNeedingEnrichment = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM races
     WHERE athlete_id = ? AND needs_enrichment = 1`
  )
    .bind(athleteId)
    .first<{ count: number }>();

  const totalRaces = racesNeedingEnrichment?.count || 0;
  console.log(`[Discovery] ${totalRaces} races need enrichment`);

  if (totalRaces === 0) {
    // No races to enrich, mark sync as complete - keep sync_session_id for historical reference
    await env.DB.prepare(
      `UPDATE athletes
       SET sync_status = 'completed', sync_error = NULL,
           last_synced_at = ?
       WHERE id = ?`
    )
      .bind(Math.floor(Date.now() / 1000), athleteId)
      .run();

    await logSyncProgress(env, athleteId, discoverySessionId, 'success',
      `Sync complete: 0 races to enrich`,
      { totalRaces: 0 }
    );
    return;
  }

  // Create enrichment session
  const enrichmentSessionId = `enrich_${Date.now()}_${athleteId}`;

  // Create enrichment batches (15 races per batch)
  const batchSize = 15;
  const totalBatches = Math.ceil(totalRaces / batchSize);

  for (let i = 0; i < totalBatches; i++) {
    await env.DB.prepare(
      `INSERT INTO sync_batches (
        athlete_id, sync_session_id, batch_number, status, batch_type
      ) VALUES (?, ?, ?, 'pending', 'enrichment')`
    )
      .bind(athleteId, enrichmentSessionId, i + 1)
      .run();
  }

  // Update athlete to enrichment status (still 'in_progress' but with enrichment session)
  await env.DB.prepare(
    `UPDATE athletes
     SET sync_status = 'in_progress', sync_session_id = ?,
         current_batch_number = 0, total_batches_expected = ?
     WHERE id = ?`
  )
    .bind(enrichmentSessionId, totalBatches, athleteId)
    .run();

  await logSyncProgress(env, athleteId, enrichmentSessionId, 'info',
    `Starting enrichment: ${totalRaces} races in ${totalBatches} batches`,
    { totalRaces, totalBatches, batchSize }
  );

  console.log(`[Discovery] Created ${totalBatches} enrichment batches for session ${enrichmentSessionId}`);
}
