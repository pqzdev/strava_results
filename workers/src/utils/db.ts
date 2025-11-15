// Database utility functions

import { Env, Athlete, Race, StravaActivity } from '../types';
import { extractParkrunFeatures, predictParkrun } from './ml-client';

/**
 * Detect if an activity is a parkrun using ML model
 * Falls back to rule-based detection if ML API is unavailable
 */
async function isParkrunActivity(activity: StravaActivity): Promise<boolean> {
  try {
    // Extract features for ML prediction
    const features = extractParkrunFeatures({
      name: activity.name,
      distance: activity.distance,
      moving_time: activity.moving_time,
      elevation_gain: activity.total_elevation_gain,
      date: activity.start_date_local,
    });

    // Call ML API
    const prediction = await predictParkrun(features);

    // Use prediction if confidence is high enough (>0.7)
    if (prediction.probability > 0.7) {
      return prediction.is_parkrun;
    }

    // If low confidence, fall back to rule-based detection
    console.log(`Low ML confidence (${prediction.probability.toFixed(2)}) for activity ${activity.id}, using fallback`);
    return fallbackParkrunDetection(activity);
  } catch (error) {
    // If ML API fails, use fallback
    console.warn(`ML parkrun detection failed for activity ${activity.id}, using fallback:`, error);
    return fallbackParkrunDetection(activity);
  }
}

/**
 * Fallback rule-based parkrun detection (original logic)
 */
function fallbackParkrunDetection(activity: StravaActivity): boolean {
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
 * Fetch detailed activity from Strava to get full polyline, description, and raw response
 * WOOD-6: Now stores full API response for future feature extraction
 */
export async function fetchDetailedActivity(
  activityId: number,
  accessToken: string
): Promise<{ polyline: string | null; description: string | null; rawResponse: string | null }> {
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
      return { polyline: null, description: null, rawResponse: null };
    }

    const activity: any = await response.json();
    return {
      // Prefer full polyline over summary polyline
      polyline: activity.map?.polyline || activity.map?.summary_polyline || null,
      description: activity.description || null,
      // WOOD-6: Store full raw response for future feature extraction (includes start_latlng, end_latlng, etc.)
      rawResponse: JSON.stringify(activity),
    };
  } catch (error) {
    console.error(`Error fetching detailed activity ${activityId}:`, error);
    return { polyline: null, description: null, rawResponse: null };
  }
}

/**
 * @deprecated Use fetchDetailedActivity instead
 */
async function fetchDetailedPolyline(
  activityId: number,
  accessToken: string
): Promise<string | null> {
  const { polyline } = await fetchDetailedActivity(activityId, accessToken);
  return polyline;
}

/**
 * Insert a new race into the database with detailed polyline
 * Automatically restores event_name from persistent mapping table if available
 */
export async function insertRace(
  athleteId: number,
  activity: StravaActivity,
  env: Env,
  accessToken?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Fetch detailed activity info (polyline, description, raw response) from Strava
  let polyline = activity.map?.summary_polyline || null;
  let description = null;
  let rawResponse = null;

  // If no summary polyline and we have access token, fetch detailed activity
  // This gets both the full polyline and description for race activities
  // WOOD-6: Also stores full raw response for future feature extraction
  if (!polyline && accessToken) {
    console.log(
      `No summary polyline for activity ${activity.id}, fetching detailed activity...`
    );
    const detailed = await fetchDetailedActivity(activity.id, accessToken);

    if (detailed.polyline) {
      polyline = detailed.polyline;
      console.log(`Successfully fetched detailed polyline for activity ${activity.id}`);
    }

    if (detailed.description) {
      description = detailed.description;
      console.log(`Successfully fetched description for activity ${activity.id}`);
    }

    if (detailed.rawResponse) {
      rawResponse = detailed.rawResponse;
      console.log(`Successfully stored raw response for activity ${activity.id}`);
    }
  }

  // Look up event name and visibility from persistent mapping table (survives full syncs)
  const eventMapping = await env.DB.prepare(
    `SELECT event_name, is_hidden FROM activity_event_mappings
     WHERE strava_activity_id = ? AND athlete_id = ?`
  )
    .bind(activity.id, athleteId)
    .first<{ event_name: string | null; is_hidden: number | null }>();

  let eventName = eventMapping?.event_name || null;
  let isHidden = 0;

  if (eventName) {
    console.log(`Restored event name "${eventName}" for activity ${activity.id}`);
  }

  // Check if visibility was manually set (persisted in mapping table)
  if (eventMapping?.is_hidden !== null && eventMapping?.is_hidden !== undefined) {
    // Use the persisted value (user manually set this)
    isHidden = eventMapping.is_hidden;
    console.log(`Restored manual visibility setting for activity ${activity.id}: is_hidden=${isHidden}`);
  } else {
    // No manual setting - apply auto-detection for parkruns using ML
    const isParkrun = await isParkrunActivity(activity);
    isHidden = isParkrun ? 1 : 0;

    // Override event name for parkruns
    if (isParkrun) {
      eventName = 'parkrun';
      console.log(`ML detected parkrun activity: "${activity.name}" (ID: ${activity.id})`);
    }
  }

  await env.DB.prepare(
    `INSERT INTO races (
      athlete_id, strava_activity_id, name, distance, elapsed_time,
      moving_time, date, elevation_gain, average_heartrate, max_heartrate, polyline, event_name, is_hidden, description, raw_response, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      rawResponse, // WOOD-6: Store full raw response
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
