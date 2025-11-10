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
 */
export async function syncAthlete(athleteStravaId: number, env: Env, isInitialSync: boolean = false): Promise<void> {
  console.log(`Starting sync for athlete ${athleteStravaId} (initial: ${isInitialSync})`);

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
    const afterTimestamp = athlete.last_synced_at
      ? athlete.last_synced_at
      : Math.floor(new Date(`${new Date().getFullYear() - 1}-01-01`).getTime() / 1000);

    const { activities, rateLimits } = await fetchAthleteActivities(
      accessToken,
      afterTimestamp
    );

    // Filter for race activities
    const races = filterRaceActivities(activities);
    console.log(
      `Athlete ${athlete.strava_id}: ${races.length} races out of ${activities.length} activities`
    );

    // Insert new races
    let newRacesAdded = 0;
    for (const race of races) {
      const exists = await raceExists(race.id, env);
      if (!exists) {
        await insertRace(athlete.id, race, env);
        newRacesAdded++;
      }
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
