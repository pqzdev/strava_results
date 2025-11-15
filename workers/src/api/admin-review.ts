// Admin Review API endpoints - ML-powered activity review dashboard
import { Env } from '../types';

/**
 * Check if a user is an admin (re-exported for convenience)
 */
async function isAdmin(stravaId: number, env: Env): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT is_admin FROM athletes WHERE strava_id = ?'
  )
    .bind(stravaId)
    .first<{ is_admin: number }>();

  return result?.is_admin === 1;
}

/**
 * GET /api/admin/review - Get unassigned activities for review with ML suggestions
 */
export async function getReviewActivities(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Get all activities without an event assigned
    // Check both races.event_name and activity_event_mappings
    const result = await env.DB.prepare(
      `SELECT
        r.id,
        r.strava_activity_id,
        r.name,
        r.distance,
        r.moving_time,
        r.elapsed_time,
        r.date,
        r.elevation_gain,
        r.is_hidden,
        r.athlete_id,
        a.firstname,
        a.lastname,
        a.strava_id as athlete_strava_id,
        COALESCE(r.event_name, aem.event_name) as event_name
      FROM races r
      LEFT JOIN athletes a ON r.athlete_id = a.id
      LEFT JOIN activity_event_mappings aem ON r.strava_activity_id = aem.strava_activity_id
        AND r.athlete_id = aem.athlete_id
      WHERE COALESCE(r.event_name, aem.event_name) IS NULL
      ORDER BY r.date DESC
      LIMIT ? OFFSET ?`
    )
      .bind(limit, offset)
      .all();

    // Get total count
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as total
      FROM races r
      LEFT JOIN activity_event_mappings aem ON r.strava_activity_id = aem.strava_activity_id
        AND r.athlete_id = aem.athlete_id
      WHERE COALESCE(r.event_name, aem.event_name) IS NULL`
    ).first<{ total: number }>();

    return new Response(
      JSON.stringify({
        activities: result.results,
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
    console.error('Error fetching review activities:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch activities' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * PATCH /api/admin/activities/:id - Update activity fields
 */
export async function updateActivity(
  request: Request,
  env: Env,
  activityId: number
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      distance?: number;
      moving_time?: number;
      elapsed_time?: number;
      is_hidden?: number;
      event_name?: string | null;
    };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const bindings: any[] = [];

    if (body.distance !== undefined) {
      updates.push('manual_distance = ?');
      bindings.push(body.distance);
    }
    if (body.moving_time !== undefined) {
      updates.push('manual_time = ?');
      bindings.push(body.moving_time);
    }
    if (body.elapsed_time !== undefined) {
      updates.push('elapsed_time = ?');
      bindings.push(body.elapsed_time);
    }
    if (body.is_hidden !== undefined) {
      updates.push('is_hidden = ?');
      bindings.push(body.is_hidden);
    }
    if (body.event_name !== undefined) {
      updates.push('event_name = ?');
      bindings.push(body.event_name);
    }

    if (updates.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No fields to update' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    bindings.push(activityId);

    // Update races table
    const updateQuery = `UPDATE races SET ${updates.join(', ')} WHERE id = ?`;
    await env.DB.prepare(updateQuery)
      .bind(...bindings)
      .run();

    // If event_name was updated, also update/insert into activity_event_mappings for persistence
    if (body.event_name !== undefined) {
      const race = await env.DB.prepare(
        'SELECT strava_activity_id, athlete_id FROM races WHERE id = ?'
      )
        .bind(activityId)
        .first<{ strava_activity_id: number; athlete_id: number }>();

      if (race) {
        if (body.event_name) {
          // Insert or update mapping
          await env.DB.prepare(
            `INSERT INTO activity_event_mappings (strava_activity_id, athlete_id, event_name, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(strava_activity_id, athlete_id) DO UPDATE SET
               event_name = excluded.event_name,
               updated_at = excluded.updated_at`
          )
            .bind(race.strava_activity_id, race.athlete_id, body.event_name, Math.floor(Date.now() / 1000))
            .run();
        } else {
          // Delete mapping if event_name is null
          await env.DB.prepare(
            'DELETE FROM activity_event_mappings WHERE strava_activity_id = ? AND athlete_id = ?'
          )
            .bind(race.strava_activity_id, race.athlete_id)
            .run();
        }
      }
    }

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
    console.error('Error updating activity:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update activity' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
