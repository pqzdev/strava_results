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
 * @param fullSync - If true, fetches all activities from the beginning (for admin-triggered syncs)
 */
export async function syncAthlete(
  athleteStravaId: number,
  env: Env,
  isInitialSync: boolean = false,
  fullSync: boolean = false
): Promise<void> {
  console.log(`Starting sync for athlete ${athleteStravaId} (initial: ${isInitialSync}, full: ${fullSync})`);

  try {
    // Get athlete from database
    const athlete = await getAthleteByStravaId(athleteStravaId, env);
    if (!athlete) {
      console.error(`Athlete ${athleteStravaId} not found in database`);
      return;
    }

    // Set athlete status to in_progress
    await env.DB.prepare(
      `UPDATE athletes SET sync_status = 'in_progress', sync_error = NULL WHERE id = ?`
    )
      .bind(athlete.id)
      .run();

    // Ensure valid access token
    const accessToken = await ensureValidToken(athlete, env);

    // Fetch activities since last sync (or from start of previous year if never synced)
    // For full syncs, fetch from beginning of time (2009 - when Strava was founded)
    let afterTimestamp: number;
    if (fullSync) {
      afterTimestamp = Math.floor(new Date('2009-01-01').getTime() / 1000);
      console.log(`Full sync requested - fetching all activities since ${new Date('2009-01-01').toISOString()}`);
    } else {
      afterTimestamp = athlete.last_synced_at
        ? athlete.last_synced_at
        : Math.floor(new Date(`${new Date().getFullYear() - 1}-01-01`).getTime() / 1000);
    }

    const { activities, rateLimits } = await fetchAthleteActivities(
      accessToken,
      afterTimestamp
    );

    // Filter for race activities
    const races = filterRaceActivities(activities);
    console.log(
      `Athlete ${athlete.strava_id}: ${races.length} races out of ${activities.length} activities`
    );

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

    let racesRemoved = 0;

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
    let newRacesAdded = 0;
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

    // Update last synced timestamp, activity count, and mark as completed
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

    console.log(`Athlete ${athleteStravaId} sync complete: ${newRacesAdded} new races added`);
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
