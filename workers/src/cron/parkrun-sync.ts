// Scheduled job to sync parkrun results for the club

import { Env } from '../types';
import {
  fetchParkrunClubResults,
  parseTimeToSeconds,
  ParkrunResult,
  getSaturdaysInRange,
} from '../utils/parkrun';

const WOODSTOCK_CLUB_ID = 19959;
const BATCH_SIZE = 10; // Insert to DB every 10 dates
const MAX_FIBONACCI_WAIT = 34; // Maximum wait time in seconds

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate Fibonacci sequence up to max value
 */
function getFibonacciSequence(maxValue: number): number[] {
  const fib = [1, 1];
  while (true) {
    const next = fib[fib.length - 1] + fib[fib.length - 2];
    if (next > maxValue) break;
    fib.push(next);
  }
  return fib;
}

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
    // Get date range - last 52 weeks (1 year of Saturdays)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (52 * 7)); // 52 weeks ago

    const saturdays = getSaturdaysInRange(
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    console.log(`Fetching results for ${saturdays.length} Saturdays from ${saturdays[0]} to ${saturdays[saturdays.length - 1]}`);

    // Fibonacci sequence for backoff
    const fibonacciWaits = getFibonacciSequence(MAX_FIBONACCI_WAIT);

    // Batch collection
    let resultsBatch: ParkrunResult[] = [];
    let datesProcessed = 0;

    // Process each Saturday
    for (const date of saturdays) {
      let consecutiveEmptyResults = 0;
      let shouldContinue = true;

      while (shouldContinue) {
        try {
          console.log(`Fetching results for ${date}...`);
          const { results } = await fetchParkrunClubResults(WOODSTOCK_CLUB_ID, date);

          if (results.length === 0) {
            consecutiveEmptyResults++;

            // Check if we've exhausted all Fibonacci waits
            if (consecutiveEmptyResults > fibonacciWaits.length) {
              console.log(`No results for ${date} after ${fibonacciWaits.length} retries, moving on`);
              shouldContinue = false;
              break;
            }

            // Apply Fibonacci backoff
            const waitSeconds = fibonacciWaits[consecutiveEmptyResults - 1];
            console.log(`0 results for ${date}, waiting ${waitSeconds}s before retry (attempt ${consecutiveEmptyResults})`);
            await sleep(waitSeconds * 1000);
          } else {
            console.log(`Found ${results.length} results for ${date}`);
            resultsFetched += results.length;
            resultsBatch.push(...results);
            consecutiveEmptyResults = 0;
            shouldContinue = false;
          }
        } catch (error) {
          console.error(`Error fetching results for ${date}:`, error);
          errorsEncountered++;
          shouldContinue = false;
        }
      }

      datesProcessed++;

      // Insert batch to database every BATCH_SIZE dates
      if (datesProcessed % BATCH_SIZE === 0 && resultsBatch.length > 0) {
        console.log(`Inserting batch of ${resultsBatch.length} results to database...`);
        const inserted = await insertResultsBatch(resultsBatch, env);
        newResultsAdded += inserted;
        resultsBatch = []; // Clear batch
      }
    }

    // Insert any remaining results
    if (resultsBatch.length > 0) {
      console.log(`Inserting final batch of ${resultsBatch.length} results to database...`);
      const inserted = await insertResultsBatch(resultsBatch, env);
      newResultsAdded += inserted;
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
 * Insert a batch of results into the database
 * Returns the number of new results added
 */
async function insertResultsBatch(results: ParkrunResult[], env: Env): Promise<number> {
  let newResultsAdded = 0;

  for (const result of results) {
    try {
      await insertParkrunResult(result, env);
      newResultsAdded++;
    } catch (error) {
      // Likely a duplicate (unique constraint violation) - that's okay
      if (error instanceof Error && !error.message.includes('UNIQUE constraint')) {
        console.error('Error inserting parkrun result:', error);
      }
    }
  }

  return newResultsAdded;
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
