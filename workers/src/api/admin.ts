// Admin API endpoints
import { Env } from '../types';
import { syncAthlete, getSyncQueueStatus, stopSync } from '../queue/sync-queue';
import { getSyncLogs } from '../utils/sync-logger';
import { initiateBatchedSync } from '../queue/batch-processor';
import { getSessionSummary, getSessionBatches, cancelSession } from '../utils/batch-manager';

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

    // Get all athletes with race count and batched sync progress
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
        a.sync_session_id,
        a.total_activities_count,
        a.last_synced_at,
        a.created_at,
        COALESCE(COUNT(DISTINCT r.id), 0) as race_count
      FROM athletes a
      LEFT JOIN races r ON r.athlete_id = a.id
      GROUP BY a.id
      ORDER BY a.lastname, a.firstname`
    ).all();

    // For athletes with active sync sessions, get batch progress
    const athletesWithProgress = [];
    for (const athlete of result.results) {
      const athleteData: any = { ...athlete };

      if (athlete.sync_session_id && athlete.sync_status === 'in_progress') {
        // Get batch summary for this session
        const batchSummary = await env.DB.prepare(
          `SELECT
            COUNT(*) as total_batches,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_batches,
            SUM(CASE WHEN status = 'completed' THEN activities_fetched ELSE 0 END) as total_activities,
            SUM(CASE WHEN status = 'completed' THEN races_added ELSE 0 END) as total_races_added,
            MAX(CASE WHEN status = 'processing' THEN batch_number ELSE NULL END) as current_batch
          FROM sync_batches
          WHERE sync_session_id = ?`
        )
          .bind(athlete.sync_session_id)
          .first();

        if (batchSummary) {
          athleteData.batch_progress = {
            total_batches: batchSummary.total_batches || 0,
            completed_batches: batchSummary.completed_batches || 0,
            total_activities: batchSummary.total_activities || 0,
            total_races_added: batchSummary.total_races_added || 0,
            current_batch: batchSummary.current_batch,
          };
        }
      }

      athletesWithProgress.push(athleteData);
    }

    return new Response(JSON.stringify({ athletes: athletesWithProgress }), {
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

    // Generate unique session ID for tracking this sync
    const sessionId = `sync-${athleteId}-${Date.now()}`;

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
          console.log(`Admin triggering FULL REFRESH for athlete ${athlete.strava_id} (ID: ${athleteId}, session: ${sessionId})`);
          await syncAthlete(athlete.strava_id, env, false, true, ctx, undefined, sessionId);
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
      JSON.stringify({ success: true, message: 'Sync triggered', session_id: sessionId }),
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
 * POST /api/admin/athletes/:id/sync/stop - Stop an in-progress sync
 */
export async function stopAthleteSync(
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

    // Check current status
    const athlete = await env.DB.prepare(
      'SELECT sync_status FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ sync_status: string }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (athlete.sync_status !== 'in_progress') {
      return new Response(
        JSON.stringify({ error: 'No sync in progress for this athlete' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stop the sync by setting status back to completed
    await env.DB.prepare(
      "UPDATE athletes SET sync_status = 'completed', sync_error = 'Stopped by admin' WHERE id = ?"
    )
      .bind(athleteId)
      .run();

    return new Response(
      JSON.stringify({ success: true, message: 'Sync stopped' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error stopping sync:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to stop sync' }),
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

/**
 * GET /api/admin/sync-logs - Get sync logs for a session
 */
export async function getAdminSyncLogs(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'session_id parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const logs = await getSyncLogs(env, sessionId);

    return new Response(
      JSON.stringify({ logs }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching sync logs:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch sync logs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET /api/admin/check - Check if user is an admin
 */
export async function checkAdmin(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const stravaId = parseInt(url.searchParams.get('strava_id') || '0');

    if (!stravaId) {
      return new Response(
        JSON.stringify({ is_admin: false }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const adminStatus = await isAdmin(stravaId, env);

    return new Response(
      JSON.stringify({ is_admin: adminStatus }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error checking admin status:', error);
    return new Response(
      JSON.stringify({ is_admin: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET /api/admin/sync-status - Get sync queue status (includes both legacy queue and batched syncs)
 */
export async function getAdminSyncStatus(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Get legacy queue status
    const queueStatus = await getSyncQueueStatus(env);

    // Get batched sync sessions (WOOD-8)
    const batchedSyncs = await env.DB.prepare(`
      SELECT
        a.id as athlete_id,
        a.strava_id,
        a.firstname,
        a.lastname,
        a.sync_session_id,
        sb.batch_type,
        COUNT(*) as total_batches,
        SUM(CASE WHEN sb.status = 'completed' THEN 1 ELSE 0 END) as completed_batches,
        SUM(CASE WHEN sb.status = 'completed' THEN sb.activities_fetched ELSE 0 END) as activities_synced,
        MIN(sb.created_at) as started_at
      FROM athletes a
      JOIN sync_batches sb ON a.sync_session_id = sb.sync_session_id
      WHERE a.sync_status = 'in_progress'
        AND a.sync_session_id IS NOT NULL
      GROUP BY a.id, a.strava_id, a.firstname, a.lastname, a.sync_session_id, sb.batch_type
      ORDER BY MIN(sb.created_at) DESC
    `).all();

    // Combine batched syncs into the active list
    const batchedActive = (batchedSyncs.results || []).map((sync: any) => ({
      id: `batch-${sync.sync_session_id}`,
      athlete_id: sync.athlete_id,
      strava_id: sync.strava_id,
      first_name: sync.firstname,
      last_name: sync.lastname,
      job_type: `batched_${sync.batch_type}`,
      status: 'processing',
      started_at: sync.started_at * 1000,
      activities_synced: sync.activities_synced,
      total_activities_expected: null,
      error_message: null,
      created_at: sync.started_at * 1000,
      completed_at: null,
    }));

    // Merge with legacy queue status
    const combinedStatus = {
      active: [...queueStatus.active, ...batchedActive],
      pending: queueStatus.pending,
      recent: queueStatus.recent,
    };

    return new Response(
      JSON.stringify(combinedStatus),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error getting sync status:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get sync status' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * POST /api/admin/sync/stop - Stop a stalled sync
 */
export async function stopSyncJob(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const body = await request.json() as { sync_id: number };

    if (!body.sync_id) {
      return new Response(
        JSON.stringify({ error: 'sync_id is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const stopped = await stopSync(body.sync_id, env);

    if (!stopped) {
      return new Response(
        JSON.stringify({ error: 'Sync not found or already completed' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ message: 'Sync stopped successfully', sync_id: body.sync_id }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error stopping sync:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to stop sync' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * WOOD-8: POST /api/admin/athletes/:id/batched-sync - Trigger batched sync for athlete
 * Uses new batched sync architecture for handling large activity datasets
 */
export async function triggerBatchedAthleteSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  athleteId: number
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number; full_sync?: boolean };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get athlete
    const athlete = await env.DB.prepare(
      'SELECT strava_id, firstname, lastname FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ strava_id: number; firstname: string; lastname: string }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Cancel any existing in-progress sync
    const currentStatus = await env.DB.prepare(
      'SELECT sync_status, sync_session_id FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ sync_status: string; sync_session_id: string }>();

    if (currentStatus?.sync_status === 'in_progress' && currentStatus.sync_session_id) {
      console.log(`[WOOD-8] Cancelling existing sync session ${currentStatus.sync_session_id}`);
      await cancelSession(currentStatus.sync_session_id, env);
    }

    // Initiate new two-phase batched sync (discovery + enrichment)
    const fullSync = body.full_sync !== false; // Default to full sync
    const sessionId = await initiateDiscoverySync(athleteId, fullSync, env);

    console.log(`[WOOD-8] Initiated ${fullSync ? 'FULL' : 'incremental'} discovery sync for ${athlete.firstname} ${athlete.lastname} (session: ${sessionId})`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `${fullSync ? 'Full' : 'Incremental'} batched sync initiated`,
        session_id: sessionId,
        athlete: {
          id: athleteId,
          strava_id: athlete.strava_id,
          name: `${athlete.firstname} ${athlete.lastname}`,
        }
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
    console.error('[WOOD-8] Error triggering batched sync:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    console.error('[WOOD-8] Error details:', errorDetails);

    return new Response(
      JSON.stringify({
        error: 'Failed to trigger batched sync',
        details: errorMessage,
        hint: 'Check if migration 0023 has been applied to the database'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * WOOD-8: GET /api/admin/batched-sync/:sessionId/progress - Get batch progress
 */
export async function getBatchedSyncProgress(
  request: Request,
  env: Env,
  sessionId: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get session summary and batches
    const summary = await getSessionSummary(sessionId, env);
    const batches = await getSessionBatches(sessionId, env);

    return new Response(
      JSON.stringify({
        session_id: sessionId,
        summary,
        batches,
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
    console.error('[WOOD-8] Error fetching batch progress:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch batch progress' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * WOOD-8: Initiate discovery sync (Phase 1 of two-phase sync)
 * Creates first discovery batch to find races
 */
async function initiateDiscoverySync(
  athleteId: number,
  fullSync: boolean,
  env: Env
): Promise<string> {
  const sessionId = `discovery_${Date.now()}_${athleteId}`;
  const now = Math.floor(Date.now() / 1000);

  // Update athlete status
  await env.DB.prepare(
    `UPDATE athletes
     SET sync_status = 'in_progress',
         sync_error = NULL,
         sync_session_id = ?,
         current_batch_number = 1,
         total_batches_expected = NULL
     WHERE id = ?`
  )
    .bind(sessionId, athleteId)
    .run();

  // Create first discovery batch
  // For full sync: no after_timestamp, start from oldest
  // For incremental: use last_synced_at as after_timestamp
  const athlete = await env.DB.prepare(
    `SELECT last_synced_at FROM athletes WHERE id = ?`
  )
    .bind(athleteId)
    .first<{ last_synced_at: number | null }>();

  const afterTimestamp = fullSync ? undefined : (athlete?.last_synced_at || undefined);

  await env.DB.prepare(
    `INSERT INTO sync_batches (
      athlete_id, sync_session_id, batch_number,
      before_timestamp, after_timestamp, status, batch_type
    ) VALUES (?, ?, ?, ?, ?, 'pending', 'discovery')`
  )
    .bind(
      athleteId,
      sessionId,
      1,
      null, // Will be set during pagination
      afterTimestamp || null
    )
    .run();

  console.log(`[WOOD-8] Created discovery session ${sessionId} for athlete ${athleteId}`);

  return sessionId;
}
