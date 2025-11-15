/**
 * WOOD-6: Backfill raw_response for existing races
 *
 * This API endpoint fetches detailed activity data from Strava for all existing races
 * that don't have raw_response stored yet. It processes them in batches to respect
 * Strava API rate limits.
 *
 * Usage:
 *   curl -X POST https://your-worker.workers.dev/api/backfill/raw-responses
 */

import { Env } from '../types';
import { getAthleteByStravaId, fetchDetailedActivity, upsertAthlete } from '../utils/db';
import { ensureValidToken } from '../utils/strava';

interface BackfillProgress {
  total: number;
  processed: number;
  updated: number;
  failed: number;
  errors: string[];
}

/**
 * Backfill raw_response for all races that don't have it
 */
async function backfillRawResponses(
  env: Env,
  limit: number = 100
): Promise<BackfillProgress> {
  const progress: BackfillProgress = {
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Get all races without raw_response
    const races = await env.DB.prepare(
      `SELECT r.id, r.strava_activity_id, r.athlete_id, a.strava_id, a.access_token
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.raw_response IS NULL
       LIMIT ?`
    )
      .bind(limit)
      .all();

    if (!races.results || races.results.length === 0) {
      console.log('No races need backfilling');
      return progress;
    }

    progress.total = races.results.length;
    console.log(`Backfilling raw_response for ${progress.total} races...`);

    for (const race of races.results as any[]) {
      try {
        progress.processed++;

        // WOOD-6: Ensure token is valid (refresh if expired)
        const athlete = await getAthleteByStravaId(race.strava_id, env);
        if (!athlete) {
          progress.failed++;
          progress.errors.push(`Athlete not found for race ${race.strava_activity_id}`);
          continue;
        }

        const validToken = await ensureValidToken(athlete, env);

        // Fetch detailed activity from Strava with valid token
        const detailed = await fetchDetailedActivity(
          race.strava_activity_id,
          validToken
        );

        if (detailed.rawResponse) {
          // Update the race with raw_response
          await env.DB.prepare(
            `UPDATE races
             SET raw_response = ?
             WHERE id = ?`
          )
            .bind(detailed.rawResponse, race.id)
            .run();

          progress.updated++;
          console.log(
            `✓ Updated race ${race.strava_activity_id} (${progress.processed}/${progress.total})`
          );
        } else {
          progress.failed++;
          const error = `Failed to fetch activity ${race.strava_activity_id}`;
          progress.errors.push(error);
          console.error(`✗ ${error}`);
        }

        // Rate limit: ~100 requests per 15min, ~1000 per day
        // Sleep 10ms between requests to stay well under limit
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch (error) {
        progress.failed++;
        const errorMsg = `Error processing race ${race.strava_activity_id}: ${error}`;
        progress.errors.push(errorMsg);
        console.error(`✗ ${errorMsg}`);
      }
    }

    console.log(
      `Backfill complete: ${progress.updated} updated, ${progress.failed} failed`
    );

    return progress;
  } catch (error) {
    console.error('Fatal error during backfill:', error);
    throw error;
  }
}

/**
 * API handler for raw response backfill
 */
export async function handleRawResponseBackfill(
  request: Request,
  env: Env
): Promise<Response> {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Parse optional limit from request body
    let limit = 100; // Default: process 100 at a time
    try {
      const body = await request.json() as any;
      if (body.limit && typeof body.limit === 'number') {
        limit = Math.min(body.limit, 500); // Max 500 per request
      }
    } catch (e) {
      // No body or invalid JSON, use default
    }

    console.log(`Starting raw_response backfill (limit: ${limit})...`);

    const progress = await backfillRawResponses(env, limit);

    return new Response(
      JSON.stringify({
        success: true,
        progress,
        message: `Backfilled ${progress.updated} races out of ${progress.total}`,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in raw response backfill:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
