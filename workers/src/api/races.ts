// API endpoints for fetching race data

import { Env } from '../types';

/**
 * GET /api/races - Get recent races with filtering
 */
export async function getRaces(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const athleteName = url.searchParams.get('athlete');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const minDistance = parseFloat(url.searchParams.get('min_distance') || '0');
  const maxDistance = parseFloat(url.searchParams.get('max_distance') || '999999');

  try {
    // Build query with filters
    let query = `
      SELECT
        r.id,
        r.strava_activity_id,
        r.name,
        r.distance,
        r.elapsed_time,
        r.moving_time,
        r.manual_time,
        r.date,
        r.elevation_gain,
        r.average_heartrate,
        r.max_heartrate,
        r.athlete_id,
        a.firstname,
        a.lastname,
        a.profile_photo,
        a.strava_id
      FROM races r
      JOIN athletes a ON r.athlete_id = a.id
      WHERE 1=1
    `;

    const bindings: any[] = [];

    if (athleteName) {
      query += ` AND (a.firstname LIKE ? OR a.lastname LIKE ?)`;
      bindings.push(`%${athleteName}%`, `%${athleteName}%`);
    }

    if (dateFrom) {
      query += ` AND r.date >= ?`;
      bindings.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND r.date <= ?`;
      bindings.push(dateTo);
    }

    if (minDistance > 0) {
      query += ` AND r.distance >= ?`;
      bindings.push(minDistance);
    }

    if (maxDistance < 999999) {
      query += ` AND r.distance <= ?`;
      bindings.push(maxDistance);
    }

    query += ` ORDER BY r.date DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...bindings).all();

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM races r
      JOIN athletes a ON r.athlete_id = a.id
      WHERE 1=1
    `;
    const countBindings: any[] = [];

    if (athleteName) {
      countQuery += ` AND (a.firstname LIKE ? OR a.lastname LIKE ?)`;
      countBindings.push(`%${athleteName}%`, `%${athleteName}%`);
    }
    if (dateFrom) {
      countQuery += ` AND r.date >= ?`;
      countBindings.push(dateFrom);
    }
    if (dateTo) {
      countQuery += ` AND r.date <= ?`;
      countBindings.push(dateTo);
    }
    if (minDistance > 0) {
      countQuery += ` AND r.distance >= ?`;
      countBindings.push(minDistance);
    }
    if (maxDistance < 999999) {
      countQuery += ` AND r.distance <= ?`;
      countBindings.push(maxDistance);
    }

    const countResult = await env.DB.prepare(countQuery)
      .bind(...countBindings)
      .first<{ total: number }>();

    return new Response(
      JSON.stringify({
        races: result.results,
        pagination: {
          total: countResult?.total || 0,
          limit,
          offset,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching races:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch races',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * GET /api/stats - Get aggregate statistics
 */
export async function getStats(env: Env): Promise<Response> {
  try {
    // Get various statistics
    const athleteCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM athletes'
    ).first<{ count: number }>();

    const raceCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM races'
    ).first<{ count: number }>();

    const totalDistance = await env.DB.prepare(
      'SELECT SUM(distance) as total FROM races'
    ).first<{ total: number }>();

    const recentRaces = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM races
       WHERE date >= date('now', '-30 days')`
    ).first<{ count: number }>();

    const lastSync = await env.DB.prepare(
      `SELECT sync_completed_at, new_races_added
       FROM sync_logs
       WHERE status = 'completed'
       ORDER BY sync_completed_at DESC
       LIMIT 1`
    ).first<{ sync_completed_at: number; new_races_added: number }>();

    return new Response(
      JSON.stringify({
        athletes: athleteCount?.count || 0,
        total_races: raceCount?.count || 0,
        total_distance_km: Math.round((totalDistance?.total || 0) / 1000),
        races_last_30_days: recentRaces?.count || 0,
        last_sync: lastSync
          ? {
              timestamp: lastSync.sync_completed_at,
              new_races: lastSync.new_races_added,
            }
          : null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching stats:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch statistics' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * PATCH /api/races/:id/time - Update manual time for a race
 */
export async function updateRaceTime(
  request: Request,
  env: Env,
  raceId: number
): Promise<Response> {
  try {
    const body = await request.json() as { manual_time: number | null; athlete_strava_id: number };

    // Verify the athlete owns this race
    const race = await env.DB.prepare(
      `SELECT r.athlete_id, a.strava_id
       FROM races r
       JOIN athletes a ON r.athlete_id = a.id
       WHERE r.id = ?`
    )
      .bind(raceId)
      .first<{ athlete_id: number; strava_id: number }>();

    if (!race) {
      return new Response(
        JSON.stringify({ error: 'Race not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Verify athlete owns this race
    if (race.strava_id !== body.athlete_strava_id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: You can only edit your own race times' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Update manual_time
    await env.DB.prepare(
      `UPDATE races SET manual_time = ? WHERE id = ?`
    )
      .bind(body.manual_time, raceId)
      .run();

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating race time:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update race time' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * GET /api/athletes - Get list of connected athletes
 */
export async function getAthletes(env: Env): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      `SELECT
        strava_id,
        firstname,
        lastname,
        profile_photo,
        created_at,
        last_synced_at,
        (SELECT COUNT(*) FROM races WHERE athlete_id = athletes.id) as race_count
      FROM athletes
      ORDER BY lastname, firstname`
    ).all();

    return new Response(JSON.stringify({ athletes: result.results }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error fetching athletes:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch athletes' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
