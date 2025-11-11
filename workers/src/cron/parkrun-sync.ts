// Scheduled job to sync parkrun results for the club

import { Env } from '../types';
import {
  fetchLatestParkrunClubResults,
  parseTimeToSeconds,
  ParkrunResult,
} from '../utils/parkrun';

const WOODSTOCK_CLUB_ID = 19959;

/**
 * Main parkrun sync function - called by cron trigger
 */
export async function syncParkrunResults(env: Env): Promise<void> {
  console.log(`Starting parkrun sync for club ${WOODSTOCK_CLUB_ID}...`);

  const syncStartTime = Math.floor(Date.now() / 1000);
  let resultsFetched = 0;
  let newResultsAdded = 0;
  let errorsEncountered = 0;

  // Create sync log entry
  const syncLogResult = await env.DB.prepare(
    `INSERT INTO parkrun_sync_logs (sync_started_at, club_num, status)
     VALUES (?, ?, 'running')
     RETURNING id`
  )
    .bind(syncStartTime, WOODSTOCK_CLUB_ID)
    .first<{ id: number }>();

  const syncLogId = syncLogResult?.id;

  try {
    // Fetch latest parkrun results for Woodstock
    const { results, totalResults, fetchedAt } = await fetchLatestParkrunClubResults(
      WOODSTOCK_CLUB_ID
    );

    console.log(`Fetched ${totalResults} parkrun results`);
    resultsFetched = totalResults;

    // Insert new results into database
    for (const result of results) {
      try {
        await insertParkrunResult(result, env);
        newResultsAdded++;
      } catch (error) {
        // Likely a duplicate (unique constraint violation) - that's okay
        if (error instanceof Error && !error.message.includes('UNIQUE constraint')) {
          console.error('Error inserting parkrun result:', error);
          errorsEncountered++;
        }
      }
    }

    // Update sync log with completion
    const syncCompletedTime = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE parkrun_sync_logs
       SET sync_completed_at = ?,
           results_fetched = ?,
           new_results_added = ?,
           errors_encountered = ?,
           status = 'completed'
       WHERE id = ?`
    )
      .bind(
        syncCompletedTime,
        resultsFetched,
        newResultsAdded,
        errorsEncountered,
        syncLogId
      )
      .run();

    console.log('Parkrun sync completed successfully');
    console.log(
      `Stats: ${resultsFetched} results fetched, ${newResultsAdded} new results added, ${errorsEncountered} errors`
    );
  } catch (error) {
    console.error('Fatal parkrun sync error:', error);
    errorsEncountered++;

    // Update sync log with failure
    await env.DB.prepare(
      `UPDATE parkrun_sync_logs
       SET status = 'failed',
           error_message = ?,
           results_fetched = ?,
           errors_encountered = ?
       WHERE id = ?`
    )
      .bind(
        error instanceof Error ? error.message : 'Unknown error',
        resultsFetched,
        errorsEncountered,
        syncLogId
      )
      .run();

    throw error;
  }
}

/**
 * Insert a parkrun result into the database
 */
async function insertParkrunResult(result: ParkrunResult, env: Env): Promise<void> {
  const timeSeconds = parseTimeToSeconds(result.time);

  await env.DB.prepare(
    `INSERT INTO parkrun_results
     (athlete_name, parkrun_athlete_id, event_name, event_number, position, gender_position,
      time_seconds, time_string, age_grade, age_category, date, club_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(athlete_name, event_name, event_number, date) DO NOTHING`
  )
    .bind(
      result.athleteName,
      result.athleteId || null,
      result.eventName,
      result.eventNumber,
      result.position,
      result.genderPosition || null,
      timeSeconds,
      result.time,
      result.ageGrade || null,
      result.ageCategory || null,
      result.date,
      result.clubName || 'Woodstock'
    )
    .run();
}

/**
 * Check if a parkrun result exists
 */
async function parkrunResultExists(
  athleteName: string,
  eventName: string,
  eventNumber: number,
  date: string,
  env: Env
): Promise<boolean> {
  const result = await env.DB.prepare(
    `SELECT id FROM parkrun_results
     WHERE athlete_name = ? AND event_name = ? AND event_number = ? AND date = ?`
  )
    .bind(athleteName, eventName, eventNumber, date)
    .first();

  return result !== null;
}
