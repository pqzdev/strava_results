// Scheduled job to sync race activities from all connected athletes

import { Env } from '../types';
import { getAllAthletes } from '../utils/db';
import { syncAthlete } from '../queue/sync-queue';

/**
 * Main sync function - called by cron trigger
 * Performs incremental sync for all athletes (fetches only new activities since last sync)
 */
export async function syncAllAthletes(env: Env): Promise<void> {
  console.log('Starting scheduled activity sync (incremental)...');

  const syncStartTime = Math.floor(Date.now() / 1000);
  let athletesProcessed = 0;
  let errorsEncountered = 0;

  // Create sync log entry
  const syncLogResult = await env.DB.prepare(
    `INSERT INTO sync_logs (sync_started_at, status)
     VALUES (?, 'running')
     RETURNING id`
  )
    .bind(syncStartTime)
    .first<{ id: number }>();

  const syncLogId = syncLogResult?.id;

  try {
    // Get all connected athletes
    const athletes = await getAllAthletes(env);
    console.log(`Found ${athletes.length} connected athletes`);

    // Process athletes in batches to respect rate limits
    // Strava: 100 requests per 15 minutes, 1000 per day
    const batchSize = 20; // Process 20 athletes at a time
    const delayBetweenBatches = 60000; // 1 minute between batches

    for (let i = 0; i < athletes.length; i += batchSize) {
      const batch = athletes.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} athletes)...`
      );

      // Process each athlete in the batch
      for (const athlete of batch) {
        try {
          athletesProcessed++;

          // Sync athlete incrementally (fullSync = false - default)
          await syncAthlete(athlete.strava_id, env, false, false);

          // Small delay between athletes to avoid rate limit spikes
          await sleep(500);
        } catch (error) {
          console.error(`Error syncing athlete ${athlete.strava_id}:`, error);
          errorsEncountered++;
          // Continue with next athlete
        }
      }

      // Delay between batches (except for the last batch)
      if (i + batchSize < athletes.length) {
        console.log(`Waiting ${delayBetweenBatches / 1000}s before next batch...`);
        await sleep(delayBetweenBatches);
      }
    }

    // Update sync log with completion
    const syncCompletedTime = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE sync_logs
       SET sync_completed_at = ?,
           athletes_processed = ?,
           errors_encountered = ?,
           status = 'completed'
       WHERE id = ?`
    )
      .bind(
        syncCompletedTime,
        athletesProcessed,
        errorsEncountered,
        syncLogId
      )
      .run();

    console.log('Sync completed successfully');
    console.log(
      `Stats: ${athletesProcessed} athletes, ${errorsEncountered} errors`
    );
  } catch (error) {
    console.error('Fatal sync error:', error);

    // Update sync log with failure
    await env.DB.prepare(
      `UPDATE sync_logs
       SET status = 'failed',
           error_message = ?,
           athletes_processed = ?,
           errors_encountered = ?
       WHERE id = ?`
    )
      .bind(
        error instanceof Error ? error.message : 'Unknown error',
        athletesProcessed,
        errorsEncountered + 1,
        syncLogId
      )
      .run();

    throw error;
  }
}

/**
 * Sleep utility for rate limit handling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
