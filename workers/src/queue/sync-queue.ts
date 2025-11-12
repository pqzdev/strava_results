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
 */
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false,
  ctx?: ExecutionContext
): Promise<void> {
  console.log(`Starting sync for athlete ${athleteStravaId} (initial: ${isInitialSync}, full: ${fullSync})`);

  try {
    const moreDataAvailable = await syncAthleteInternal(athleteStravaId, env, isInitialSync, fullSync);

    // If more data is available and we have an execution context, trigger another batch
    // For full syncs, continue with fullSync=true; for incremental, use fullSync=false
    if (moreDataAvailable && ctx) {
      console.log(`More activities available for athlete ${athleteStravaId}, scheduling follow-up sync (fullSync: ${fullSync})`);

      // Schedule another sync in the background
      ctx.waitUntil(
        (async () => {
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log(`Starting follow-up sync for athlete ${athleteStravaId}`);
          await syncAthlete(athleteStravaId, env, false, fullSync, ctx);
        })()
      );
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
 * @returns true if more data may be available (hit maxPages limit), false otherwise
 */
async function syncAthleteInternal(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean,
  fullSync: boolean
): Promise<boolean> {
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

    // For full sync, delete all existing races first for a true refresh
    // But only do this on the FIRST batch of a full sync
    if (fullSync && athlete.last_synced_at !== null) {
      console.log(`Full sync - deleting all existing races for athlete ${athleteStravaId}`);
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
      return false;
    }

    // Ensure valid access token
    const accessToken = await ensureValidToken(athlete, env);

    // Fetch activities in batches (limit to 5 pages = 1000 activities per batch)
    // For full syncs: afterTimestamp will be null/undefined (fetch from beginning)
    // For incremental syncs: afterTimestamp will be last_synced_at
    const afterTimestamp = fullSync ? undefined : athlete.last_synced_at;

    console.log(`Fetching activities (fullSync: ${fullSync}, afterTimestamp: ${afterTimestamp || 'none'})`);

    const { activities } = await fetchAthleteActivities(
      accessToken,
      afterTimestamp,
      undefined,  // no before timestamp
      200,        // perPage
      5           // maxPages - limit to prevent timeout
    );

    console.log(`Fetched ${activities.length} total activities for athlete ${athlete.strava_id}`);

    // Check if sync was cancelled after fetching activities
    if (await isSyncCancelled()) {
      console.log(`Sync cancelled for athlete ${athleteStravaId} after fetching activities`);
      return false;
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

    // Update last synced timestamp, activity count, and mark as completed
    // For full syncs, reset the activity count; for incremental syncs, add to it
    if (fullSync) {
      await env.DB.prepare(
        `UPDATE athletes
         SET last_synced_at = ?,
             sync_status = 'completed',
             total_activities_count = ?,
             sync_error = NULL
         WHERE id = ?`
      )
        .bind(Math.floor(Date.now() / 1000), activities.length, athlete.id)
        .run();
    } else {
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
    }

    console.log(`Athlete ${athleteStravaId} sync complete: ${newRacesAdded} races added (${racesRemoved} removed). Total activities processed: ${activities.length}`);

    // If we got exactly maxPages worth of activities (1000), there may be more
    // Return true to indicate more batches may be needed (works for both full and incremental syncs)
    return activities.length === 1000;
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
