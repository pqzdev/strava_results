// Queue consumer for athlete sync requests

import { Env, StravaActivity } from '../types';
import {
  getAthleteByStravaId,
  insertRace,
  fetchDetailedActivity,
} from '../utils/db';
import {
  ensureValidToken,
  fetchAthleteActivities,
  filterRaceActivities,
} from '../utils/strava';
import { logSyncProgress } from '../utils/sync-logger';

/**
 * Detect if an activity is a parkrun based on multiple criteria:
 * 1. Name contains parkrun keywords
 * 2. Distance is ~5km (4.5-5.5km)
 * 3. Start time is 7 AM, 8 AM, or 9 AM (-2 to +7 minutes tolerance)
 */
function isParkrunActivity(activity: StravaActivity): boolean {
  // Name-based detection
  const nameLower = activity.name.toLowerCase();
  const hasKeyword = nameLower.includes('parkrun') ||
                     nameLower.includes('park run') ||
                     nameLower.includes('parkie') ||
                     nameLower.includes('parky');

  // Distance-based detection: 4500m to 5500m (5km ± 500m)
  const isCorrectDistance = activity.distance >= 4500 && activity.distance <= 5500;

  // Time-based detection: 7 AM, 8 AM, or 9 AM (-2 to +7 minutes)
  let isCorrectTime = false;
  try {
    const startDate = new Date(activity.start_date_local);
    const hours = startDate.getHours();
    const minutes = startDate.getMinutes();

    // Convert to total minutes since midnight
    const totalMinutes = hours * 60 + minutes;

    // Check if within parkrun time windows
    // 7 AM: 06:58 to 07:07 (418-427 minutes)
    // 8 AM: 07:58 to 08:07 (478-487 minutes)
    // 9 AM: 08:58 to 09:07 (538-547 minutes)
    const isParkrunTime = (
      (totalMinutes >= 418 && totalMinutes <= 427) || // 7 AM window
      (totalMinutes >= 478 && totalMinutes <= 487) || // 8 AM window
      (totalMinutes >= 538 && totalMinutes <= 547)    // 9 AM window
    );

    isCorrectTime = isParkrunTime;
  } catch (error) {
    // If date parsing fails, skip time-based detection
    console.warn(`Failed to parse date for activity ${activity.id}: ${error}`);
  }

  // Activity is a parkrun if it matches name OR (distance AND time)
  return hasKeyword || (isCorrectDistance && isCorrectTime);
}

/**
 * Optimized insert race function - batches event name lookups
 * For races (activities without polylines), fetches detailed info including description
 */
async function insertRaceOptimized(
  athleteId: number,
  activity: StravaActivity,
  env: Env,
  eventName: string | null,
  persistedIsHidden: number | null | undefined,
  accessToken?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Use summary polyline from activity list (avoid excessive API calls during sync)
  // Descriptions and detailed polylines can be backfilled later via separate process
  let polyline = activity.map?.summary_polyline || null;
  let description = activity.description || null; // Use description from list API if available

  // Only fetch detailed activity if absolutely no polyline available
  // This avoids hitting subrequest limits during large syncs
  if (!polyline && accessToken) {
    const detailed = await fetchDetailedActivity(activity.id, accessToken);

    if (detailed.polyline) {
      polyline = detailed.polyline;
      console.log(`Fetched detailed polyline for activity ${activity.id}`);
    }

    // Get description if we had to fetch detailed activity anyway
    if (detailed.description) {
      description = detailed.description;
    }
  }

  let isHidden = 0;

  // Check if visibility was manually set (persisted in mapping table)
  if (persistedIsHidden !== null && persistedIsHidden !== undefined) {
    // Use the persisted value (user manually set this)
    isHidden = persistedIsHidden;
    console.log(`Restored manual visibility setting for activity ${activity.id}: is_hidden=${isHidden}`);
  } else {
    // No manual setting - apply auto-detection for parkruns
    const isParkrun = isParkrunActivity(activity);
    isHidden = isParkrun ? 1 : 0;

    // Override event name for parkruns
    if (isParkrun) {
      eventName = 'parkrun';
      console.log(`Detected parkrun activity: "${activity.name}" (ID: ${activity.id})`);
    }
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO races (
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

      // Migrate any event names and visibility settings from races table to persistent mapping table
      await env.DB.prepare(
        `INSERT OR IGNORE INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, is_hidden, updated_at)
         SELECT strava_activity_id, athlete_id, event_name, is_hidden, strftime('%s', 'now')
         FROM races
         WHERE athlete_id = ? AND (event_name IS NOT NULL OR is_hidden = 1)`
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

    console.log(`[v2-run-filter] Fetched ${activities.length} total activities for athlete ${athlete.strava_id}`);

    // Filter to only Run activities before processing
    const runActivities = activities.filter(a => a.type === 'Run');
    console.log(`${runActivities.length} out of ${activities.length} activities are runs`);

    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `[v2] Fetched ${runActivities.length} running activities from Strava API (${activities.length} total)`,
        { runActivitiesCount: runActivities.length, totalActivitiesCount: activities.length }
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

    // Calculate the oldest activity timestamp for pagination (use ALL activities for pagination, not just runs)
    // Activities are returned newest first, so the last activity is the oldest
    let oldestActivityTimestamp: number | undefined;
    if (activities.length > 0) {
      const oldestActivity = activities[activities.length - 1];
      // Convert ISO date string to Unix timestamp
      oldestActivityTimestamp = Math.floor(new Date(oldestActivity.start_date).getTime() / 1000);
      console.log(`Oldest activity in batch: ${oldestActivity.name} (${oldestActivity.start_date}, timestamp: ${oldestActivityTimestamp})`);
    }

    // Filter for race activities (from run activities only)
    const races = filterRaceActivities(runActivities);
    console.log(
      `Athlete ${athlete.strava_id}: Found ${races.length} races out of ${runActivities.length} runs`
    );

    if (sessionId) {
      await logSyncProgress(env, athlete.id, sessionId, 'info',
        `[v2] Found ${races.length} race activities out of ${runActivities.length} runs`,
        { racesCount: races.length, runActivitiesCount: runActivities.length }
      );
    }

    // Debug logging to understand what's being found
    if (runActivities.length > 0 && races.length === 0) {
      console.log(`No races found. Sample activities:`, JSON.stringify(runActivities.slice(0, 3).map(a => ({
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

      // OPTIMIZED: Batch fetch event names and visibility settings for all races at once
      let eventMappings = new Map<number, { event_name: string | null; is_hidden: number | null }>();
      if (races.length > 0) {
        const raceIds = races.map(r => r.id);
        const placeholders = raceIds.map(() => '?').join(',');
        const mappings = await env.DB.prepare(
          `SELECT strava_activity_id, event_name, is_hidden FROM activity_event_mappings
           WHERE strava_activity_id IN (${placeholders}) AND athlete_id = ?`
        )
          .bind(...raceIds, athlete.id)
          .all<{ strava_activity_id: number; event_name: string | null; is_hidden: number | null }>();

        for (const mapping of mappings.results || []) {
          eventMappings.set(mapping.strava_activity_id, {
            event_name: mapping.event_name,
            is_hidden: mapping.is_hidden
          });
        }
      }

      // OPTIMIZED: Insert races with batch event name and visibility lookups
      // Still fetches detailed polylines for races that need them
      for (const race of races) {
        try {
          const mapping = eventMappings.get(race.id);
          await insertRaceOptimized(
            athlete.id,
            race,
            env,
            mapping?.event_name || null,
            mapping?.is_hidden,
            accessToken
          );
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

        // Batch fetch event names and visibility settings
        const eventMappings = new Map<number, { event_name: string | null; is_hidden: number | null }>();
        const mappings = await env.DB.prepare(
          `SELECT strava_activity_id, event_name, is_hidden FROM activity_event_mappings
           WHERE strava_activity_id IN (${placeholders}) AND athlete_id = ?`
        )
          .bind(...raceIdsList, athlete.id)
          .all<{ strava_activity_id: number; event_name: string | null; is_hidden: number | null }>();

        for (const mapping of mappings.results || []) {
          eventMappings.set(mapping.strava_activity_id, {
            event_name: mapping.event_name,
            is_hidden: mapping.is_hidden
          });
        }

        // Insert only the races that don't exist (using optimized insert)
        for (const race of races) {
          if (!existingIdsSet.has(race.id)) {
            const mapping = eventMappings.get(race.id);
            await insertRaceOptimized(
              athlete.id,
              race,
              env,
              mapping?.event_name || null,
              mapping?.is_hidden,
              accessToken
            );
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

/**
 * Get sync queue status - both active/processing and recent completed/failed
 */
export async function getSyncQueueStatus(env: Env) {
  // Get active/processing syncs
  const activeResult = await env.DB.prepare(`
    SELECT
      sq.id,
      sq.athlete_id,
      sq.job_type,
      sq.status,
      sq.created_at,
      sq.started_at,
      sq.completed_at,
      sq.error_message,
      sq.activities_synced,
      sq.total_activities_expected,
      a.strava_id,
      a.first_name,
      a.last_name
    FROM sync_queue sq
    LEFT JOIN athletes a ON sq.athlete_id = a.id
    WHERE sq.status IN ('pending', 'processing')
    ORDER BY sq.created_at DESC
  `).all();

  // Get last 10 completed/failed syncs
  const recentResult = await env.DB.prepare(`
    SELECT
      sq.id,
      sq.athlete_id,
      sq.job_type,
      sq.status,
      sq.created_at,
      sq.started_at,
      sq.completed_at,
      sq.error_message,
      sq.activities_synced,
      sq.total_activities_expected,
      a.strava_id,
      a.first_name,
      a.last_name
    FROM sync_queue sq
    LEFT JOIN athletes a ON sq.athlete_id = a.id
    WHERE sq.status IN ('completed', 'failed')
    ORDER BY sq.completed_at DESC
    LIMIT 10
  `).all();

  return {
    active: activeResult.results || [],
    recent: recentResult.results || []
  };
}

/**
 * Stop a stalled sync by marking it as failed
 */
export async function stopSync(syncId: number, env: Env) {
  const result = await env.DB.prepare(`
    UPDATE sync_queue
    SET status = 'failed',
        error_message = 'Manually stopped by admin',
        completed_at = ?
    WHERE id = ? AND status IN ('pending', 'processing')
  `).bind(Date.now(), syncId).run();

  return result.meta.changes > 0;
}
