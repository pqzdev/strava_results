// WOOD-8: Batch activity processing utilities
// Handles efficient batch insertion and processing of race activities

import { Env, StravaActivity } from '../types';
import { fetchDetailedActivity } from '../utils/db';
import { extractParkrunFeatures, predictParkrun } from '../utils/ml-client';

/**
 * WOOD-8: Process activities in batch for efficiency
 */
export async function processActivitiesBatch(
  athleteId: number,
  races: StravaActivity[],
  allActivities: StravaActivity[],
  env: Env,
  accessToken: string,
  isFullSync: boolean
): Promise<{ racesAdded: number; racesRemoved: number }> {
  let racesAdded = 0;
  let racesRemoved = 0;

  // Batch fetch event mappings for all races at once
  const eventMappings = await fetchEventMappings(races, athleteId, env);

  if (isFullSync) {
    // Full sync: just insert all races
    for (const race of races) {
      const mapping = eventMappings.get(race.id);
      await insertRaceOptimized(
        athleteId,
        race,
        env,
        mapping?.event_name || null,
        mapping?.is_hidden,
        accessToken
      );
      racesAdded++;
    }
  } else {
    // Incremental sync: handle additions and removals
    const raceActivityIds = new Set(races.map(r => r.id));
    const fetchedActivityIds = new Set(allActivities.map(a => a.id));

    // Check for races to remove (activities that are no longer races)
    if (fetchedActivityIds.size > 0) {
      const activityIdsList = Array.from(fetchedActivityIds);
      const placeholders = activityIdsList.map(() => '?').join(',');

      const existingRaces = await env.DB.prepare(
        `SELECT strava_activity_id FROM races
         WHERE athlete_id = ? AND strava_activity_id IN (${placeholders})`
      )
        .bind(athleteId, ...activityIdsList)
        .all<{ strava_activity_id: number }>();

      for (const existingRace of existingRaces.results || []) {
        if (!raceActivityIds.has(existingRace.strava_activity_id)) {
          await env.DB.prepare(
            `DELETE FROM races WHERE strava_activity_id = ? AND athlete_id = ?`
          )
            .bind(existingRace.strava_activity_id, athleteId)
            .run();
          racesRemoved++;
        }
      }
    }

    // Check for new races to add
    if (races.length > 0) {
      const raceIdsList = races.map(r => r.id);
      const placeholders = raceIdsList.map(() => '?').join(',');

      const existingRaceIds = await env.DB.prepare(
        `SELECT strava_activity_id FROM races WHERE strava_activity_id IN (${placeholders})`
      )
        .bind(...raceIdsList)
        .all<{ strava_activity_id: number }>();

      const existingIdsSet = new Set(existingRaceIds.results?.map(r => r.strava_activity_id) || []);

      for (const race of races) {
        if (!existingIdsSet.has(race.id)) {
          const mapping = eventMappings.get(race.id);
          await insertRaceOptimized(
            athleteId,
            race,
            env,
            mapping?.event_name || null,
            mapping?.is_hidden,
            accessToken
          );
          racesAdded++;
        }
      }
    }
  }

  return { racesAdded, racesRemoved };
}

/**
 * WOOD-8: Batch fetch event mappings for races
 */
async function fetchEventMappings(
  races: StravaActivity[],
  athleteId: number,
  env: Env
): Promise<Map<number, { event_name: string | null; is_hidden: number | null }>> {
  const eventMappings = new Map<number, { event_name: string | null; is_hidden: number | null }>();

  if (races.length === 0) {
    return eventMappings;
  }

  const raceIds = races.map(r => r.id);
  const placeholders = raceIds.map(() => '?').join(',');

  const mappings = await env.DB.prepare(
    `SELECT strava_activity_id, event_name, is_hidden FROM activity_event_mappings
     WHERE strava_activity_id IN (${placeholders}) AND athlete_id = ?`
  )
    .bind(...raceIds, athleteId)
    .all<{ strava_activity_id: number; event_name: string | null; is_hidden: number | null }>();

  for (const mapping of mappings.results || []) {
    eventMappings.set(mapping.strava_activity_id, {
      event_name: mapping.event_name,
      is_hidden: mapping.is_hidden,
    });
  }

  return eventMappings;
}

/**
 * WOOD-8: Optimized race insertion (imported from sync-queue.ts)
 */
export async function insertRaceOptimized(
  athleteId: number,
  activity: StravaActivity,
  env: Env,
  eventName: string | null,
  persistedIsHidden: number | null | undefined,
  accessToken?: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Use summary polyline from activity list
  let polyline = activity.map?.summary_polyline || null;
  let description = activity.description || null;
  let rawResponse = null;

  // Only fetch detailed activity if no polyline available
  if (!polyline && accessToken) {
    const detailed = await fetchDetailedActivity(activity.id, accessToken);

    if (detailed.polyline) {
      polyline = detailed.polyline;
    }

    if (detailed.description) {
      description = detailed.description;
    }

    if (detailed.rawResponse) {
      rawResponse = detailed.rawResponse;
    }
  }

  let isHidden = 0;

  // Check if visibility was manually set
  if (persistedIsHidden !== null && persistedIsHidden !== undefined) {
    isHidden = persistedIsHidden;
  } else {
    // WOOD-8: Temporarily disable ML to reduce subrequests
    // Use fallback detection only to avoid HTTP calls to ML API
    const isParkrun = fallbackParkrunDetection(activity);
    isHidden = isParkrun ? 1 : 0;

    if (isParkrun) {
      eventName = 'parkrun';
    }
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO races (
      athlete_id, strava_activity_id, name, distance, elapsed_time,
      moving_time, date, elevation_gain, average_heartrate, max_heartrate,
      polyline, event_name, is_hidden, description, raw_response, created_at
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
      rawResponse,
      now
    )
    .run();
}

/**
 * Detect if an activity is a parkrun using ML model
 * Falls back to rule-based detection if ML API is unavailable
 */
async function isParkrunActivity(activity: StravaActivity): Promise<boolean> {
  try {
    const features = extractParkrunFeatures({
      name: activity.name,
      distance: activity.distance,
      moving_time: activity.moving_time,
      elevation_gain: activity.total_elevation_gain,
      date: activity.start_date_local,
    });

    const prediction = await predictParkrun(features);

    if (prediction.probability > 0.7) {
      return prediction.is_parkrun;
    }

    return fallbackParkrunDetection(activity);
  } catch (error) {
    return fallbackParkrunDetection(activity);
  }
}

/**
 * Fallback rule-based parkrun detection
 */
function fallbackParkrunDetection(activity: StravaActivity): boolean {
  const nameLower = activity.name.toLowerCase();
  const hasKeyword = nameLower.includes('parkrun') ||
                     nameLower.includes('park run') ||
                     nameLower.includes('parkie') ||
                     nameLower.includes('parky');

  const isCorrectDistance = activity.distance >= 4500 && activity.distance <= 5500;

  let isCorrectTime = false;
  try {
    const startDate = new Date(activity.start_date_local);
    const hours = startDate.getHours();
    const minutes = startDate.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const isParkrunTime = (
      (totalMinutes >= 418 && totalMinutes <= 427) || // 7 AM
      (totalMinutes >= 478 && totalMinutes <= 487) || // 8 AM
      (totalMinutes >= 538 && totalMinutes <= 547)    // 9 AM
    );

    isCorrectTime = isParkrunTime;
  } catch (error) {
    // Skip time-based detection if date parsing fails
  }

  return hasKeyword || (isCorrectDistance && isCorrectTime);
}
