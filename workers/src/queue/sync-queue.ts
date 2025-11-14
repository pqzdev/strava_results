// Queue consumer for athlete sync requests

import { Env } from '../types';
import {
  getAthleteByStravaId,
  insertRace,
  fetchDetailedActivity,
} from '../utils/db';
import {
  ensureValidToken,
  fetchAthleteActivities,
  filterRaceActivities,
  type StravaActivity,
} from '../utils/strava';
import { logSyncProgress } from '../utils/sync-logger';

/**
 * Optimized insert race function for full syncs - skips polyline fetching to avoid API rate limits
 * For races (activities without polylines), fetches detailed info including description
 */
async function insertRaceOptimized(
  athleteId: number,
  activity: StravaActivity,
  env: Env,
  eventName: string | null,
  accessToken?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Use summary polyline from activity list
  let polyline = activity.map?.summary_polyline || null;
  let description = null;

  // If no summary polyline and we have access token, fetch detailed activity
  // This gets both the full polyline and description for race activities
  if (!polyline && accessToken) {
    const detailed = await fetchDetailedActivity(activity.id, accessToken);

    if (detailed.polyline) {
      polyline = detailed.polyline;
    }

    if (detailed.description) {
      description = detailed.description;
    }
  }

  // Auto-hide parkrun races
  const nameLower = activity.name.toLowerCase();
  const isParkrun = nameLower.includes('parkrun') ||
                    nameLower.includes('park run') ||
                    nameLower.includes('parkie') ||
                    nameLower.includes('parky');
  const isHidden = isParkrun ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO races (
      athlete_id, strava_activity_id, name, distance, elapsed_time,
      moving_time, date, elevation_gain, average_heartrate, max_heartrate, polyline, event_name, is_hidden, description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      description,
      now
    )
    .run();
}

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
 * @param sessionId - Optional session ID for logging sync progress
 */
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false,
  ctx?: ExecutionContext,
  continuationTimestamp?: number,
  sessionId?: string
): Promise<void> {
  console.log(`Starting sync for athlete ${athleteStravaId} (initial: ${isInitialSync}, full: ${fullSync}, continuation: ${continuationTimestamp || 'none'}, session: ${sessionId || 'none'})`);

  try {
    let currentTimestamp = continuationTimestamp;
    let batchNumber = 1;

    // Get athlete for logging
    const athlete = await getAthleteByStravaId(athleteStravaId, env);
    if (!athlete) {
      throw new Error(`Athlete ${athleteStravaId} not found`);
    }

    // Log sync start
    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `${fullSync ? 'Full' : 'Incremental'} sync started`,
        { athleteStravaId, fullSync, isInitialSync }
      );
    }

    // Loop until all data is fetched (keeps worker alive, avoiding waitUntil 30s limit)
    while (true) {
      console.log(`Fetching batch ${batchNumber} for athlete ${athleteStravaId}${currentTimestamp ? ` (before: ${currentTimestamp})` : ''}`);

      if (sessionId) {
        await logSyncProgress(env, athlete.id, sessionId, 'info',
          `Fetching batch ${batchNumber}`,
          { batchNumber, currentTimestamp }
        );
      }

      const result = await syncAthleteInternal(athleteStravaId, env, isInitialSync, fullSync, currentTimestamp, sessionId);

      if (!result.moreDataAvailable) {
        console.log(`All data fetched for athlete ${athleteStravaId} after ${batchNumber} batch(es)`);
        if (sessionId) {
          await logSyncProgress(env, athlete.id, sessionId, 'success',
            `Sync completed successfully after ${batchNumber} batch(es)`,
            { totalBatches: batchNumber }
          );
        }
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
  continuationTimestamp?: number,
  sessionId?: string
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

    // For full syncs, save event names to persistent table before deletion
    // Only do this on the FIRST batch of a full sync (not on continuation batches)
    if (fullSync && !continuationTimestamp && athlete.last_synced_at !== null) {
      console.log(`Full sync (first batch) - saving event name mappings to persistent table before deletion`);

      // Migrate any event names from races table to persistent mapping table
      await env.DB.prepare(
        `INSERT OR IGNORE INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, updated_at)
         SELECT strava_activity_id, athlete_id, event_name, strftime('%s', 'now')
         FROM races
         WHERE athlete_id = ? AND event_name IS NOT NULL`
      )
        .bind(athlete.id)
        .run();

      const mappingCount = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM activity_event_mappings WHERE athlete_id = ?`
      )
        .bind(athlete.id)
        .first<{ count: number }>();

      console.log(`Saved ${Number(mappingCount?.count) || 0} event name mappings to persistent table`);

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

    // Limit ALL syncs to 1 page (200 activities) per batch to avoid timeouts
    // Full syncs will trigger follow-up batches automatically via waitUntil
    const maxPagesPerBatch = 1;

    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `Calling Strava API to fetch activities`,
        { maxPages: maxPagesPerBatch, perPage: 200, afterTimestamp, beforeTimestamp }
      );
    }

    const { activities } = await fetchAthleteActivities(
      accessToken,
      afterTimestamp,
      beforeTimestamp,
      200,                  // perPage (max allowed by Strava)
      maxPagesPerBatch      // maxPages per batch (always limited to avoid timeout)
    );

    console.log(`Fetched ${activities.length} total activities for athlete ${athlete.strava_id}`);

    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `Fetched ${activities.length} activities from Strava API`,
        { activitiesCount: activities.length }
      );
    }

    // Check if sync was cancelled after fetching activities
    if (await isSyncCancelled()) {
      console.log(`Sync cancelled for athlete ${athleteStravaId} after fetching activities`);
      if (sessionId) {
        await logSyncProgress(env, athlete.id, sessionId, 'warning',
          `Sync was cancelled by user`
        );
      }
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

    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `Found ${races.length} race activities out of ${activities.length} total activities`,
        { racesCount: races.length, activitiesCount: activities.length }
      );
    }

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
    // Event names are automatically restored from the persistent mapping table
    if (fullSync) {
      console.log(`Full sync - attempting to insert ${races.length} races`);

      // OPTIMIZED: Batch fetch event names for all races at once
      let eventMappings = new Map<number, string>();
      if (races.length > 0) {
        const raceIds = races.map(r => r.id);
        const placeholders = raceIds.map(() => '?').join(',');
        const mappings = await env.DB.prepare(
          `SELECT strava_activity_id, event_name FROM activity_event_mappings
           WHERE strava_activity_id IN (${placeholders}) AND athlete_id = ?`
        )
          .bind(...raceIds, athlete.id)
          .all<{ strava_activity_id: number; event_name: string }>();

        for (const mapping of mappings.results || []) {
          eventMappings.set(mapping.strava_activity_id, mapping.event_name);
        }
      }

      // OPTIMIZED: Insert races without fetching polylines (too many API calls)
      // Polylines are available in the summary data from activities list
      // For races without polylines, detailed info including description is fetched
      for (const race of races) {
        try {
          await insertRaceOptimized(athlete.id, race, env, eventMappings.get(race.id) || null, accessToken);
          newRacesAdded++;
          console.log(`Inserted race: ${race.name} (ID: ${race.id})`);
        } catch (error) {
          console.error(`Failed to insert race ${race.id}:`, error);
        }
      }
    } else {
      // For incremental syncs, handle race additions and removals intelligently
      // Get all activity IDs that are currently races from the sync
      const raceActivityIds = new Set(races.map(r => r.id));

      // Get all activity IDs from fetched activities
      const fetchedActivityIds = new Set(activities.map(a => a.id));

      // OPTIMIZED: Only query for existing races within the current batch window
      // This prevents "Too many subrequests" errors for athletes with thousands of activities
      if (fetchedActivityIds.size > 0) {
        const activityIdsList = Array.from(fetchedActivityIds);
        const placeholders = activityIdsList.map(() => '?').join(',');

        const existingRaces = await env.DB.prepare(
          `SELECT strava_activity_id FROM races
           WHERE athlete_id = ? AND strava_activity_id IN (${placeholders})`
        )
          .bind(athlete.id, ...activityIdsList)
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
      }

      // OPTIMIZED: Batch check for existing races and event mappings to reduce DB queries
      if (races.length > 0) {
        const raceIdsList = races.map(r => r.id);
        const placeholders = raceIdsList.map(() => '?').join(',');

        // Batch fetch existing races
        const existingRaceIds = await env.DB.prepare(
          `SELECT strava_activity_id FROM races WHERE strava_activity_id IN (${placeholders})`
        )
          .bind(...raceIdsList)
          .all<{ strava_activity_id: number }>();

        const existingIdsSet = new Set(existingRaceIds.results?.map(r => r.strava_activity_id) || []);

        // Batch fetch event names
        const eventMappings = new Map<number, string>();
        const mappings = await env.DB.prepare(
          `SELECT strava_activity_id, event_name FROM activity_event_mappings
           WHERE strava_activity_id IN (${placeholders}) AND athlete_id = ?`
        )
          .bind(...raceIdsList, athlete.id)
          .all<{ strava_activity_id: number; event_name: string }>();

        for (const mapping of mappings.results || []) {
          eventMappings.set(mapping.strava_activity_id, mapping.event_name);
        }

        // Insert only the races that don't exist (using optimized insert)
        for (const race of races) {
          if (!existingIdsSet.has(race.id)) {
            await insertRaceOptimized(athlete.id, race, env, eventMappings.get(race.id) || null, accessToken);
            newRacesAdded++;
          }
        }
      }

      if (racesRemoved > 0) {
        console.log(`Removed ${racesRemoved} activities no longer marked as races`);
      }
    }

    // Determine if more data may be available
    // If we got a full page (200 activities), there may be more to fetch
    const moreDataAvailable = activities.length === 200;

    if (moreDataAvailable) {
      console.log(`More data may be available - fetched ${activities.length} activities (max was ${maxPagesPerBatch * 200})`);
    } else {
      console.log(`All data fetched - got ${activities.length} activities (less than max of ${maxPagesPerBatch * 200})`);
    }

    // Log batch completion summary
    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `Batch complete: ${newRacesAdded} races added${racesRemoved > 0 ? `, ${racesRemoved} removed` : ''}. ${moreDataAvailable ? 'More data available' : 'All data fetched'}`,
        { newRacesAdded, racesRemoved, activitiesProcessed: activities.length, moreDataAvailable }
      );
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
