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
 */
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false
): Promise<void> {
  console.log(`Starting sync for athlete ${athleteStravaId} (initial: ${isInitialSync}, full: ${fullSync})`);

  // Wrap entire sync in a timeout to prevent hanging
  const timeoutMs = 25000; // 25 seconds - leave buffer before Cloudflare's 30s limit
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Sync timeout - operation took too long')), timeoutMs);
  });

  try {
    await Promise.race([
      syncAthleteInternal(athleteStravaId, env, isInitialSync, fullSync),
      timeoutPromise
    ]);
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
 * Internal sync implementation (wrapped by timeout in syncAthlete)
 */
async function syncAthleteInternal(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean,
  fullSync: boolean
): Promise<void> {
  try {
    // Get athlete from database
    const athlete = await getAthleteByStravaId(athleteStravaId, env);
    if (!athlete) {
      console.error(`Athlete ${athleteStravaId} not found in database`);
      throw new Error(`Athlete ${athleteStravaId} not found in database`);
    }

    // For full sync, delete all existing races first for a true refresh
    if (fullSync) {
      console.log(`Full sync - deleting all existing races for athlete ${athleteStravaId}`);
      const deleteResult = await env.DB.prepare(
        `DELETE FROM races WHERE athlete_id = ?`
      )
        .bind(athlete.id)
        .run();
      console.log(`Deleted ${deleteResult.meta.changes} existing races`);
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

    // Ensure valid access token
    const accessToken = await ensureValidToken(athlete, env);

    // Fetch activities
    // For full syncs, fetch from start of previous year but in smaller batches to avoid timeouts
    // For incremental syncs, fetch from last_synced_at or start of previous year
    let afterTimestamp: number;
    let allActivities: any[] = [];

    if (fullSync) {
      // For full syncs, fetch from start of previous year (up to 24 months of data)
      // This ensures we catch all racing activity for the current and previous year
      const currentYear = new Date().getFullYear();
      const startOfPreviousYear = new Date(`${currentYear - 1}-01-01`);
      afterTimestamp = Math.floor(startOfPreviousYear.getTime() / 1000);

      console.log(`Full sync requested - fetching activities from ${startOfPreviousYear.toISOString()}`);

      // Fetch in batches to avoid timeouts - limit to 200 activities per request
      const { activities } = await fetchAthleteActivities(
        accessToken,
        afterTimestamp,
        200  // Limit to 200 activities per request to avoid timeouts
      );
      allActivities = activities;

      // If we hit the limit, log a warning but continue with what we have
      if (activities.length === 200) {
        console.warn(`Hit activity limit of 200 - may not have all activities. Consider running sync multiple times.`);
      }
    } else {
      afterTimestamp = athlete.last_synced_at
        ? athlete.last_synced_at
        : Math.floor(new Date(`${new Date().getFullYear() - 1}-01-01`).getTime() / 1000);

      const { activities, rateLimits } = await fetchAthleteActivities(
        accessToken,
        afterTimestamp
      );
      allActivities = activities;
    }

    const activities = allActivities;

    console.log(`Fetched ${activities.length} total activities for athlete ${athlete.strava_id}`);

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
