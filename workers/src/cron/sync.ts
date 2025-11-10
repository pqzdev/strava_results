// Scheduled job to sync race activities from all connected athletes

import { Env } from '../types';
import {
  getAllAthletes,
  updateLastSyncedAt,
  raceExists,
  insertRace,
} from '../utils/db';
import {
  ensureValidToken,
  fetchAthleteActivities,
  filterRaceActivities,
} from '../utils/strava';

/**
 * Main sync function - called by cron trigger
 */
export async function syncAllAthletes(env: Env): Promise<void> {
  console.log('Starting scheduled activity sync...');

  const syncStartTime = Math.floor(Date.now() / 1000);
  let athletesProcessed = 0;
  let activitiesFetched = 0;
  let newRacesAdded = 0;
  let errorsEncountered = 0;
  let lastRateLimitRemaining = { usage_15min: 0, usage_daily: 0 };

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
    // For 200 athletes, we need to spread requests across multiple 15-min windows
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

          // Set athlete status to in_progress
          await env.DB.prepare(
            `UPDATE athletes SET sync_status = 'in_progress', sync_error = NULL WHERE id = ?`
          )
            .bind(athlete.id)
            .run();

          // Ensure valid access token
          const accessToken = await ensureValidToken(athlete, env);

          // Fetch activities since last sync (or from start of previous year if never synced)
          const afterTimestamp = athlete.last_synced_at
            ? athlete.last_synced_at
            : Math.floor(new Date(`${new Date().getFullYear() - 1}-01-01`).getTime() / 1000);

          const { activities, rateLimits } = await fetchAthleteActivities(
            accessToken,
            afterTimestamp
          );

          activitiesFetched += activities.length;
          lastRateLimitRemaining = {
            usage_15min: rateLimits.usage_15min,
            usage_daily: rateLimits.usage_daily,
          };

          // Filter for race activities
          const races = filterRaceActivities(activities);
          console.log(
            `Athlete ${athlete.strava_id}: ${races.length} races out of ${activities.length} activities`
          );

          // Insert new races
          for (const race of races) {
            const exists = await raceExists(race.id, env);
            if (!exists) {
              await insertRace(athlete.id, race, env);
              newRacesAdded++;
            }
          }

          // Update last synced timestamp and activity count, mark as completed
          await env.DB.prepare(
            `UPDATE athletes
             SET last_synced_at = ?,
                 sync_status = 'completed',
                 total_activities_count = total_activities_count + ?,
                 sync_error = NULL
             WHERE id = ?`
          )
            .bind(Math.floor(Date.now() / 1000), activities.length, athlete.id)
            .run();

          // Check rate limits - if approaching limit, slow down
          if (rateLimits.usage_15min >= 90) {
            console.warn(
              'Approaching 15-minute rate limit, adding extra delay...'
            );
            await sleep(5000); // 5 second delay
          }

          if (rateLimits.usage_daily >= 950) {
            console.error('Approaching daily rate limit, stopping sync early');
            break;
          }
        } catch (error) {
          console.error(`Error syncing athlete ${athlete.strava_id}:`, error);
          errorsEncountered++;

          // Update athlete sync status to error
          await env.DB.prepare(
            `UPDATE athletes SET sync_status = 'error', sync_error = ? WHERE id = ?`
          )
            .bind(error instanceof Error ? error.message : 'Unknown error', athlete.id)
            .run();

          // Continue with next athlete
        }

        // Small delay between athletes to avoid rate limit spikes
        await sleep(500);
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
           activities_fetched = ?,
           new_races_added = ?,
           errors_encountered = ?,
           rate_limit_remaining = ?,
           status = 'completed'
       WHERE id = ?`
    )
      .bind(
        syncCompletedTime,
        athletesProcessed,
        activitiesFetched,
        newRacesAdded,
        errorsEncountered,
        JSON.stringify(lastRateLimitRemaining),
        syncLogId
      )
      .run();

    console.log('Sync completed successfully');
    console.log(
      `Stats: ${athletesProcessed} athletes, ${activitiesFetched} activities, ${newRacesAdded} new races, ${errorsEncountered} errors`
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
