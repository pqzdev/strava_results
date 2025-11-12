// API endpoint to backfill missing polylines for activities
// Fetches detailed activity data from Strava which includes full polylines

import { Env } from '../types';
import { ensureValidToken } from '../utils/strava';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

/**
 * Fetch detailed activity from Strava API
 */
async function fetchDetailedActivity(
  activityId: number,
  accessToken: string
): Promise<{ polyline?: string } | null> {
  try {
    const response = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch activity ${activityId}: ${response.status}`);
      return null;
    }

    const activity: any = await response.json();
    return {
      polyline: activity.map?.polyline || activity.map?.summary_polyline || null,
    };
  } catch (error) {
    console.error(`Error fetching activity ${activityId}:`, error);
    return null;
  }
}

/**
 * POST /api/polyline/backfill - Backfill missing polylines for all activities
 */
export async function backfillPolylines(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number; limit?: number };

    // Check if the user is an admin
    const requestingAthlete = await env.DB.prepare(
      'SELECT is_admin FROM athletes WHERE strava_id = ?'
    ).bind(body.admin_strava_id).first<{ is_admin: number }>();

    if (!requestingAthlete || requestingAthlete.is_admin !== 1) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Only admins can backfill polylines' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }
      );
    }

    const limit = body.limit || 100; // Default to 100 activities per request

    // Find activities without polylines
    const racesWithoutPolylines = await env.DB.prepare(
      `SELECT r.id, r.strava_activity_id, r.athlete_id, a.access_token, a.refresh_token, a.token_expiry
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.polyline IS NULL
       ORDER BY r.date DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    if (!racesWithoutPolylines.results || racesWithoutPolylines.results.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No activities without polylines found', updated: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }
      );
    }

    let updated = 0;
    let failed = 0;

    // Process each activity
    for (const race of racesWithoutPolylines.results as any[]) {
      try {
        // Ensure valid token
        const athlete = {
          strava_id: race.athlete_id,
          access_token: race.access_token,
          refresh_token: race.refresh_token,
          token_expiry: race.token_expiry,
        };

        const accessToken = await ensureValidToken(athlete as any, env);

        // Fetch detailed activity
        const detailedActivity = await fetchDetailedActivity(
          race.strava_activity_id,
          accessToken
        );

        if (detailedActivity?.polyline) {
          // Update the polyline in the database
          await env.DB.prepare(
            'UPDATE races SET polyline = ? WHERE id = ?'
          )
            .bind(detailedActivity.polyline, race.id)
            .run();

          updated++;
          console.log(`Updated polyline for activity ${race.strava_activity_id}`);
        } else {
          console.log(`No polyline available for activity ${race.strava_activity_id}`);
          failed++;
        }

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Error processing activity ${race.strava_activity_id}:`, error);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Backfill completed',
        processed: racesWithoutPolylines.results.length,
        updated,
        failed,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }
    );
  } catch (error) {
    console.error('Error backfilling polylines:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to backfill polylines',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
