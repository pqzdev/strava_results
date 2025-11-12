// Queue consumer for athlete sync requests

import { Env } from '../types';
import {
  getAthleteByStravaId,
  updateLastSyncedAt,
  raceExists,
  insertRace,
} from '../utils/db';
import {
  ensureValidToken,
  fetchAthleteActivities,
  filterRaceActivities,
} from '../utils/strava';

interface SyncMessage {
  athleteStravaId: number;
  isInitialSync: boolean;
}

/**
 * Sync a single athlete's activities
 * @param athleteStravaId - Strava ID of the athlete to sync
 * @param env - Cloudflare environment
 * @param isInitialSync - Whether this is the initial sync for a new athlete
 * @param fullSync - If true, deletes all existing data and fetches ALL activities from the beginning
 * @param ctx - Execution context for scheduling follow-up syncs
 * @param continuationTimestamp - For paginated syncs, the timestamp to continue from
 */
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false,
  ctx?: ExecutionContext,
  continuationTimestamp?: number
): Promise<void> {
  console.log(`Starting sync for athlete ${athleteStravaId} (initial: ${isInitialSync}, full: ${fullSync}, continuation: ${continuationTimestamp || 'none'})`);

  try {
    let currentTimestamp = continuationTimestamp;
    let batchNumber = 1;

    // Loop until all data is fetched
    while (true) {
      console.log(`Fetching batch ${batchNumber} for athlete ${athleteStravaId}${currentTimestamp ? ` (before: ${currentTimestamp})` : ''}`);

      const result = await syncAthleteInternal(athleteStravaId, env, isInitialSync, fullSync, currentTimestamp);

      if (!result.moreDataAvailable) {
        console.log(`All data fetched for athlete ${athleteStravaId} after ${batchNumber} batch(es)`);
        break;
      }

      // More data available, continue with next batch
      console.log(`Batch ${batchNumber} complete. More data available, continuing with next batch...`);
      currentTimestamp = result.oldestTimestamp;
      batchNumber++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error(`Error syncing athlete ${athleteStravaId}:`, error);

    // Update athlete sync status to error
    const athlete = await getAthleteByStravaId(athleteStravaId, env);
    if (athlete) {
      await env.DB.prepare(
        `UPDATE athletes SET sync_status = 'error', sync_error = ? WHERE id = ?`
      )
        .bind(error instanceof Error ? error.message : 'Unknown error', athlete.id)
        .run();
    }

    throw error; // Re-throw to let queue handle retry
  }
}

/**
 * Internal sync implementation
 * @returns Object with moreDataAvailable flag and oldestTimestamp for pagination
 */
async function syncAthleteInternal(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean,
  fullSync: boolean,
  continuationTimestamp?: number
): Promise<{ moreDataAvailable: boolean; oldestTimestamp?: number }> {
  try {
    // Get athlete from database
    const athlete = await getAthleteByStravaId(athleteStravaId, env);
    if (!athlete) {
      console.error(`Athlete ${athleteStravaId} not found in database`);
      throw new Error(`Athlete ${athleteStravaId} not found in database`);
    }

    // Helper function to check if sync was cancelled
    const isSyncCancelled = async (): Promise<boolean> => {
      const status = await env.DB.prepare(
        `SELECT sync_status FROM athletes WHERE id = ?`
      )
        .bind(athlete.id)
        .first<{ sync_status: string }>();
      return status?.sync_status !== 'in_progress';
    };

    // For full sync, preserve event_name mappings before deletion
    // Store mapping of strava_activity_id -> event_name
    // Only do this on the FIRST batch of a full sync (not on continuation batches)
    let eventNameMappings = new Map<number, string>();

    if (fullSync && !continuationTimestamp && athlete.last_synced_at !== null) {
      console.log(`Full sync (first batch) - saving event name mappings before deletion`);

      // Save all existing event_name assignments
      const existingMappings = await env.DB.prepare(
        `SELECT strava_activity_id, event_name FROM races WHERE athlete_id = ? AND event_name IS NOT NULL`
      )
        .bind(athlete.id)
        .all<{ strava_activity_id: number; event_name: string }>();

      if (existingMappings.results) {
        for (const mapping of existingMappings.results) {
          eventNameMappings.set(mapping.strava_activity_id, mapping.event_name);
        }
        console.log(`Saved ${eventNameMappings.size} event name mappings`);
      }

      console.log(`Full sync (first batch) - deleting all existing races for athlete ${athleteStravaId}`);
      const deleteResult = await env.DB.prepare(
        `DELETE FROM races WHERE athlete_id = ?`
      )
        .bind(athlete.id)
        .run();
      console.log(`Deleted ${deleteResult.meta.changes} existing races`);

      // Reset last_synced_at so we fetch from the beginning
      await env.DB.prepare(
        `UPDATE athletes SET last_synced_at = NULL WHERE id = ?`
      )
        .bind(athlete.id)
        .run();
    }

    // Set athlete status to in_progress (only if not already set by caller)
    // This ensures status is tracked even if called directly
    const currentStatus = await env.DB.prepare(
      `SELECT sync_status FROM athletes WHERE id = ?`
    )
      .bind(athlete.id)
      .first<{ sync_status: string }>();

    if (currentStatus?.sync_status !== 'in_progress') {
      await env.DB.prepare(
        `UPDATE athletes SET sync_status = 'in_progress', sync_error = NULL WHERE id = ?`
      )
        .bind(athlete.id)
        .run();
    }

    // Check if sync was cancelled before we start
    if (await isSyncCancelled()) {
      console.log(`Sync cancelled for athlete ${athleteStravaId} before fetching activities`);
      return { moreDataAvailable: false };
    }

    // Ensure valid access token
    const accessToken = await ensureValidToken(athlete, env);

    // Determine pagination parameters
    // For full syncs:
    //   - First batch: no after/before (fetch from beginning)
    //   - Subsequent batches: use continuationTimestamp as 'before' to paginate backwards
    // For incremental syncs: use last_synced_at as 'after'
    let afterTimestamp: number | undefined;
    let beforeTimestamp: number | undefined;

    if (fullSync || continuationTimestamp) {
      // For full sync pagination, use 'before' to go backwards in time
      beforeTimestamp = continuationTimestamp;
      afterTimestamp = undefined;
    } else {
      // For incremental sync, use 'after' to get new activities
      afterTimestamp = athlete.last_synced_at;
      beforeTimestamp = undefined;
    }

    console.log(`Fetching activities (fullSync: ${fullSync}, after: ${afterTimestamp || 'none'}, before: ${beforeTimestamp || 'none'})`);

    // For full syncs, fetch ALL activities without page limit
    // For incremental syncs, limit to 5 pages (1000 activities) per batch to avoid timeouts
    const maxPagesPerBatch = fullSync ? undefined : 5;

    const { activities } = await fetchAthleteActivities(
      accessToken,
      afterTimestamp,
      beforeTimestamp,
      200,                  // perPage (max allowed by Strava)
      maxPagesPerBatch      // maxPages per batch (undefined = no limit)
    );

    console.log(`Fetched ${activities.length} total activities for athlete ${athlete.strava_id}`);

    // Check if sync was cancelled after fetching activities
    if (await isSyncCancelled()) {
      console.log(`Sync cancelled for athlete ${athleteStravaId} after fetching activities`);
      return { moreDataAvailable: false };
    }

    // Calculate the oldest activity timestamp for pagination
    // Activities are returned newest first, so the last activity is the oldest
    let oldestActivityTimestamp: number | undefined;
    if (activities.length > 0) {
      const oldestActivity = activities[activities.length - 1];
      // Convert ISO date string to Unix timestamp
      oldestActivityTimestamp = Math.floor(new Date(oldestActivity.start_date).getTime() / 1000);
      console.log(`Oldest activity in batch: ${oldestActivity.name} (${oldestActivity.start_date}, timestamp: ${oldestActivityTimestamp})`);
    }

    // Filter for race activities
    const races = filterRaceActivities(activities);
    console.log(
      `Athlete ${athlete.strava_id}: Found ${races.length} races out of ${activities.length} activities`
    );

    // Debug logging to understand what's being found
    if (activities.length > 0 && races.length === 0) {
      console.log(`No races found. Sample activities:`, JSON.stringify(activities.slice(0, 3).map(a => ({
        name: a.name,
        type: a.type,
        workout_type: a.workout_type,
        date: a.start_date_local
      }))));
    } else if (races.length > 0) {
      console.log(`Found races:`, JSON.stringify(races.map(r => ({
        id: r.id,
        name: r.name,
        workout_type: r.workout_type,
        date: r.start_date_local
      }))));
    }

    let racesRemoved = 0;
    let newRacesAdded = 0;

    // For full syncs, we already deleted all races, so just insert everything
    if (fullSync) {
      console.log(`Full sync - attempting to insert ${races.length} races`);
      for (const race of races) {
        try {
          await insertRace(athlete.id, race, env);
          newRacesAdded++;

          // Restore event_name mapping if it existed before deletion
          const savedEventName = eventNameMappings.get(race.id);
          if (savedEventName) {
            await env.DB.prepare(
              `UPDATE races SET event_name = ? WHERE strava_activity_id = ? AND athlete_id = ?`
            )
              .bind(savedEventName, race.id, athlete.id)
              .run();
            console.log(`Restored event name "${savedEventName}" for race ${race.id}`);
          }

          console.log(`Inserted race: ${race.name} (ID: ${race.id})`);
        } catch (error) {
          console.error(`Failed to insert race ${race.id}:`, error);
        }
      }
      console.log(`Restored ${eventNameMappings.size} event name mappings after full sync`);
    } else {
      // For incremental syncs, handle race additions and removals intelligently
      // Get all activity IDs that are currently races from the sync
      const raceActivityIds = new Set(races.map(r => r.id));

      // Get all activity IDs from fetched activities
      const fetchedActivityIds = new Set(activities.map(a => a.id));

      // Get all existing races from database
      const existingRaces = await env.DB.prepare(
        `SELECT strava_activity_id FROM races WHERE athlete_id = ?`
      )
        .bind(athlete.id)
        .all<{ strava_activity_id: number }>();

      // Check each existing race to see if it should be removed
      for (const existingRace of existingRaces.results || []) {
        const activityId = existingRace.strava_activity_id;

        // If this activity was in the sync window but is no longer a race, remove it
        if (fetchedActivityIds.has(activityId) && !raceActivityIds.has(activityId)) {
          await env.DB.prepare(
            `DELETE FROM races WHERE strava_activity_id = ? AND athlete_id = ?`
          )
            .bind(activityId, athlete.id)
            .run();
          racesRemoved++;
          console.log(`Removed activity ${activityId} - no longer marked as race`);
        }
      }

      // Insert new races
      for (const race of races) {
        const exists = await raceExists(race.id, env);
        if (!exists) {
          await insertRace(athlete.id, race, env);
          newRacesAdded++;
        }
      }

      if (racesRemoved > 0) {
        console.log(`Removed ${racesRemoved} activities no longer marked as races`);
      }
    }

    // Determine if more data may be available
    // For full syncs: if we got maxPagesPerBatch worth of activities, there may be more
    // For incremental syncs: if we got a full batch, there may be more
    const moreDataAvailable = activities.length === (maxPagesPerBatch * 200);

    if (moreDataAvailable) {
      console.log(`More data may be available - fetched ${activities.length} activities (max was ${maxPagesPerBatch * 200})`);
    } else {
      console.log(`All data fetched - got ${activities.length} activities (less than max of ${maxPagesPerBatch * 200})`);
    }

    // Update last synced timestamp and activity count
    // For full syncs with continuation: add to the count (we're paginating)
    // For full syncs without continuation (first batch): reset the count
    // For incremental syncs: add to the count
    const isFirstBatchOfFullSync = fullSync && !continuationTimestamp;

    // Only mark as 'completed' if we're done (no more data available)
    // Otherwise keep it as 'in_progress' for the next batch
    const syncStatus = moreDataAvailable ? 'in_progress' : 'completed';

    if (isFirstBatchOfFullSync) {
      // First batch of full sync: reset the count
      await env.DB.prepare(
        `UPDATE athletes
         SET last_synced_at = ?,
             sync_status = ?,
             total_activities_count = ?,
             sync_error = NULL
         WHERE id = ?`
      )
        .bind(Math.floor(Date.now() / 1000), syncStatus, activities.length, athlete.id)
        .run();
    } else {
      // Continuation batch or incremental sync: add to the count
      await env.DB.prepare(
        `UPDATE athletes
         SET last_synced_at = ?,
             sync_status = ?,
             total_activities_count = total_activities_count + ?,
             sync_error = NULL
         WHERE id = ?`
      )
        .bind(Math.floor(Date.now() / 1000), syncStatus, activities.length, athlete.id)
        .run();
    }

    console.log(`Athlete ${athleteStravaId} sync complete: ${newRacesAdded} races added (${racesRemoved} removed). Total activities processed: ${activities.length}`);

    return {
      moreDataAvailable,
      oldestTimestamp: oldestActivityTimestamp
    };
  } catch (error) {
    // Error handling is done in the outer syncAthlete function
    throw error;
  }
}

/**
 * Queue consumer - processes athlete sync messages
 */
export async function handleSyncQueue(
  batch: MessageBatch<SyncMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await syncAthlete(
        message.body.athleteStravaId,
        env,
        message.body.isInitialSync
      );
      message.ack();
    } catch (error) {
      console.error(`Failed to process sync for athlete ${message.body.athleteStravaId}:`, error);
      message.retry();
    }
  }
}
