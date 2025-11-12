// Database utility functions

import { Env, Athlete, Race, StravaActivity } from '../types';

/**
 * Get athlete by Strava ID
 */
export async function getAthleteByStravaId(
  stravaId: number,
  env: Env
): Promise<Athlete | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM athletes WHERE strava_id = ?'
  )
    .bind(stravaId)
    .first<Athlete>();

  return result;
}

/**
 * Create or update athlete in database
 */
export async function upsertAthlete(
  stravaId: number,
  firstname: string,
  lastname: string,
  profilePhoto: string | undefined,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: number,
  env: Env
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO athletes (strava_id, firstname, lastname, profile_photo, access_token, refresh_token, token_expiry, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(strava_id) DO UPDATE SET
       firstname = excluded.firstname,
       lastname = excluded.lastname,
       profile_photo = excluded.profile_photo,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_expiry = excluded.token_expiry,
       updated_at = excluded.updated_at`
  )
    .bind(
      stravaId,
      firstname,
      lastname,
      profilePhoto,
      accessToken,
      refreshToken,
      tokenExpiry,
      now,
      now
    )
    .run();
}

/**
 * Get all athletes for syncing
 */
export async function getAllAthletes(env: Env): Promise<Athlete[]> {
  const result = await env.DB.prepare('SELECT * FROM athletes ORDER BY id').all<Athlete>();
  return result.results || [];
}

/**
 * Update athlete's last synced timestamp
 */
export async function updateLastSyncedAt(
  athleteId: number,
  env: Env
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE athletes SET last_synced_at = ? WHERE id = ?')
    .bind(now, athleteId)
    .run();
}

/**
 * Check if a race already exists by Strava activity ID
 */
export async function raceExists(
  stravaActivityId: number,
  env: Env
): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT id FROM races WHERE strava_activity_id = ?'
  )
    .bind(stravaActivityId)
    .first();

  return result !== null;
}

/**
 * Fetch detailed activity from Strava to get full polyline
 */
async function fetchDetailedPolyline(
  activityId: number,
  accessToken: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch detailed activity ${activityId}: ${response.status}`
      );
      return null;
    }

    const activity: any = await response.json();
    // Prefer full polyline over summary polyline
    return activity.map?.polyline || activity.map?.summary_polyline || null;
  } catch (error) {
    console.error(`Error fetching detailed activity ${activityId}:`, error);
    return null;
  }
}

/**
 * Insert a new race into the database with detailed polyline
 */
export async function insertRace(
  athleteId: number,
  activity: StravaActivity,
  env: Env,
  accessToken?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Try to get full polyline if we have an access token and no summary polyline
  let polyline = activity.map?.summary_polyline || null;

  // If no summary polyline and we have access token, fetch detailed activity
  if (!polyline && accessToken) {
    console.log(
      `No summary polyline for activity ${activity.id}, fetching detailed polyline...`
    );
    polyline = await fetchDetailedPolyline(activity.id, accessToken);
    if (polyline) {
      console.log(`Successfully fetched detailed polyline for activity ${activity.id}`);
    }
  }

  await env.DB.prepare(
    `INSERT INTO races (
      athlete_id, strava_activity_id, name, distance, elapsed_time,
      moving_time, date, elevation_gain, average_heartrate, max_heartrate, polyline, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      now
    )
    .run();
}

/**
 * Get recent races with athlete information
 */
export async function getRecentRaces(
  limit: number = 50,
  offset: number = 0
): Promise<any[]> {
  // This will be used by the API endpoint
  // Returns races with athlete names joined
  return [];
}

/**
 * Delete all data for an athlete (GDPR compliance)
 */
export async function deleteAthleteData(
  stravaId: number,
  env: Env
): Promise<void> {
  // First get athlete ID
  const athlete = await getAthleteByStravaId(stravaId, env);
  if (!athlete) return;

  // Delete races (cascade should handle this, but being explicit)
  await env.DB.prepare('DELETE FROM races WHERE athlete_id = ?')
    .bind(athlete.id)
    .run();

  // Delete athlete
  await env.DB.prepare('DELETE FROM athletes WHERE id = ?')
    .bind(athlete.id)
    .run();
}
