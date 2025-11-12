// Admin API endpoints
import { Env } from '../types';
import { syncAthlete } from '../queue/sync-queue';

/**
 * Check if a user is an admin
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
 * GET /api/admin/athletes - Get all athletes with admin info
 */
export async function getAdminAthletes(request: Request, env: Env): Promise<Response> {
  try {
    // Get admin_strava_id from query params
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all athletes with race count
    const result = await env.DB.prepare(
      `SELECT
        a.id,
        a.strava_id,
        a.firstname,
        a.lastname,
        a.profile_photo,
        a.is_admin,
        a.is_hidden,
        a.is_blocked,
        a.sync_status,
        a.sync_error,
        a.total_activities_count,
        a.last_synced_at,
        a.created_at,
        (SELECT COUNT(*) FROM races WHERE athlete_id = a.id) as race_count
      FROM athletes a
      ORDER BY a.lastname, a.firstname`
    ).all();

    return new Response(JSON.stringify({ athletes: result.results }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error fetching admin athletes:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch athletes' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * PATCH /api/admin/athletes/:id - Update athlete admin fields
 */
export async function updateAthlete(
  request: Request,
  env: Env,
  athleteId: number
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      is_admin?: boolean;
      is_hidden?: boolean;
      is_blocked?: boolean;
    };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const bindings: any[] = [];

    if (body.is_admin !== undefined) {
      updates.push('is_admin = ?');
      bindings.push(body.is_admin ? 1 : 0);
    }
    if (body.is_hidden !== undefined) {
      updates.push('is_hidden = ?');
      bindings.push(body.is_hidden ? 1 : 0);
    }
    if (body.is_blocked !== undefined) {
      updates.push('is_blocked = ?');
      bindings.push(body.is_blocked ? 1 : 0);
    }

    if (updates.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No fields to update' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    bindings.push(athleteId);

    await env.DB.prepare(
      `UPDATE athletes SET ${updates.join(', ')} WHERE id = ?`
    )
      .bind(...bindings)
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
    console.error('Error updating athlete:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update athlete' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * DELETE /api/admin/athletes/:id - Delete athlete and all their data
 */
export async function deleteAthlete(
  request: Request,
  env: Env,
  athleteId: number
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete all races first (foreign key constraint)
    await env.DB.prepare('DELETE FROM races WHERE athlete_id = ?')
      .bind(athleteId)
      .run();

    // Delete the athlete
    await env.DB.prepare('DELETE FROM athletes WHERE id = ?')
      .bind(athleteId)
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
    console.error('Error deleting athlete:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete athlete' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/admin/athletes/:id/sync - Trigger manual sync for athlete
 */
export async function triggerAthleteSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  athleteId: number
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get athlete strava_id
    const athlete = await env.DB.prepare(
      'SELECT strava_id FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ strava_id: number }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if already syncing
    const currentStatus = await env.DB.prepare(
      'SELECT sync_status FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ sync_status: string }>();

    // If already in_progress, cancel it by resetting to completed first
    if (currentStatus?.sync_status === 'in_progress') {
      console.log(`Athlete ${athlete.strava_id} already syncing - cancelling previous sync`);
      await env.DB.prepare(
        "UPDATE athletes SET sync_status = 'completed', sync_error = 'Cancelled by user' WHERE id = ?"
      )
        .bind(athleteId)
        .run();
    }

    // Update status to in_progress for the new sync
    await env.DB.prepare(
      "UPDATE athletes SET sync_status = 'in_progress', sync_error = NULL WHERE id = ?"
    )
      .bind(athleteId)
      .run();

    // Trigger FULL sync in background (not incremental)
    // This will fetch all activities from scratch and is useful for fixing issues
    ctx.waitUntil(
      (async () => {
        try {
          console.log(`Admin triggering FULL REFRESH for athlete ${athlete.strava_id} (ID: ${athleteId})`);
          await syncAthlete(athlete.strava_id, env, true, false, ctx);
          console.log(`Admin sync completed successfully for athlete ${athlete.strava_id}`);
        } catch (error) {
          console.error(`Admin sync failed for athlete ${athlete.strava_id}:`, error);
          // Ensure status is updated to error
          try {
            await env.DB.prepare(
              "UPDATE athletes SET sync_status = 'error', sync_error = ? WHERE id = ?"
            )
              .bind(error instanceof Error ? error.message : String(error), athleteId)
              .run();
          } catch (dbError) {
            console.error(`Failed to update error status for athlete ${athleteId}:`, dbError);
          }
        }
      })()
    );

    return new Response(
      JSON.stringify({ success: true, message: 'Sync triggered' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error triggering sync:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to trigger sync' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/admin/reset-stuck-syncs - Reset all athletes stuck in "in_progress"
 */
export async function resetStuckSyncs(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Reset all stuck syncs
    const result = await env.DB.prepare(
      `UPDATE athletes
       SET sync_status = 'completed',
           sync_error = 'Reset from stuck state'
       WHERE sync_status = 'in_progress'`
    ).run();

    return new Response(
      JSON.stringify({
        success: true,
        message: `Reset ${result.meta.changes} stuck athlete(s)`
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
    console.error('Error resetting stuck syncs:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to reset stuck syncs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
